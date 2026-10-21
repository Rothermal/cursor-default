import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameState } from '../../types'
import { supabase } from '../supabase'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../authIdentity'
import { assertBaseballTournamentAssociation } from './aggregateTransport'

export interface BaseballTournamentOption { id: string; name: string; team_id: string }
export async function loadBaseballTeamTournaments(teamId: string, current: () => void, signal?: AbortSignal, client: SupabaseClient | null = supabase): Promise<BaseballTournamentOption[]> {
  if (!client) throw Error('Supabase is not configured.')
  const rows: BaseballTournamentOption[] = []
  for (let offset = 0; ; offset += 200) {
    current()
    let query = client.from('tournaments').select('id,name,team_id').eq('team_id', teamId).order('id').range(offset, offset + 199)
    if (signal) query = query.abortSignal(signal)
    const response = await query
    current()
    if (response.error || !Array.isArray(response.data)) throw Error('Team tournaments could not load.')
    for (const row of response.data) {
      assertBaseballTournamentAssociation({ cloudScope: 'team', teamId, tournamentId: row.id }, { id: row.id, teamId: row.team_id })
      rows.push(row)
    }
    if (response.data.length < 200) return rows
  }
}

/** Optional creator-owned metadata; callers must not gate event uploads on this attachment. */
export async function syncBaseballTournamentAssociation(state: GameState, gameId: string, userId: string, current: () => void, client: SupabaseClient | null = supabase): Promise<void> {
  const id = state.gameInfo?.tournamentId
  if (!id) return
  const identity = captureAuthIdentity(userId)
  const callerCurrent = current
  current = () => { callerCurrent(); if (!identity || !isCurrentAuthIdentity(identity)) throw Error('The Baseball tournament account changed.') }
  current()
  const setup = state.sportGameState?.sportId === 'baseball' ? state.sportGameState.setup : null
  if (!setup?.sourceTeamId) throw Error('Personal Baseball games cannot attach a tournament.')
  if (!client) throw Error('Supabase is not configured.')
  const read = async () => {
    current()
    const response = await client.from('games').select('id,team_id,created_by,status,sport_id,tournament_id').eq('id', gameId).single()
    current()
    if (response.error || !response.data || response.data.id !== gameId || response.data.sport_id !== 'baseball' || response.data.team_id !== setup.sourceTeamId) throw Error('Baseball tournament game binding is unavailable.')
    return response.data
  }
  const game = await read()
  if (game.tournament_id === id) return
  if (game.tournament_id !== null) throw Error('This Baseball game already belongs to another tournament.')
  if (game.created_by !== userId || game.status === 'final') throw Error('Only the creator can attach this tournament before finalization.')
  current()
  const tournament = await client.from('tournaments').select('id,name,team_id').eq('id', id).eq('team_id', setup.sourceTeamId).single()
  current()
  if (tournament.error || !tournament.data) throw Error('The selected Baseball tournament is unavailable for this team.')
  const association = { id: tournament.data.id, teamId: tournament.data.team_id }
  assertBaseballTournamentAssociation({ cloudScope: 'team', teamId: setup.sourceTeamId, tournamentId: id }, association)
  current()
  const response = await client.from('games').update({ tournament_id: id, tournament_name: tournament.data.name })
    .eq('id', gameId).eq('created_by', userId).eq('team_id', setup.sourceTeamId).neq('status', 'final').is('tournament_id', null).select('id,tournament_id')
  current()
  if (response.error || !Array.isArray(response.data) || response.data.length !== 1 || response.data[0].tournament_id !== id) throw Error('The Baseball tournament attachment was not saved. Retry sync.')
  const saved = await read()
  assertBaseballTournamentAssociation({ cloudScope: 'team', teamId: saved.team_id, tournamentId: saved.tournament_id }, association)
}

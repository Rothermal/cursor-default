import type { SupabaseClient } from '@supabase/supabase-js'
import { sports } from '../../config/sports'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../authIdentity'
import { playerDisplayName } from '../display'
import { isPlainObject } from '../gameEvents/envelope'
import { supabase } from '../supabase'
import { BaseballFeatureError } from './featureClient'
import type { BaseballAggregateLoadScope, BaseballAggregateRosterPlayer } from './aggregateTypes'

export const BASEBALL_LEGACY_STATS = sports.find(sport => sport.id === 'baseball')!.categories.flatMap(category => category.actions)
const allowed = new Set(BASEBALL_LEGACY_STATS.map(stat => stat.id))
const PAGE = 200
function legacyReadError(error: { code?: string; message?: string } | null, message: string): Error {
  return error && (['42501','PGRST301'].includes(error.code ?? '') || /jwt|app_access_|authentication|not authorized/i.test(error.message ?? ''))
    ? new BaseballFeatureError('access_denied', 'Legacy Baseball history access changed. Sign in or refresh access before retrying.', error) : Error(message)
}
export interface BaseballLegacyPlayer { playerId: string; displayName: string; number: string | null; stats: Record<string, number>; games: number }
export interface BaseballLegacyGame {
  id: string; game_date: string; opponent_name: string; team_id: string | null; season_id: string | null
  tournament_id: string | null; sport_id: string | null; status: string
  home_team_player_id: string | null; opp_team_player_id: string | null
  teams: { name: string; seasons: { sport: string; name: string } } | null
}
export interface BaseballLegacyResult {
  players: BaseballLegacyPlayer[]
  games: Array<{ game: BaseballLegacyGame; players: BaseballLegacyPlayer[] }>
  reviewOnly: BaseballLegacyGame[]
  exclusions: Array<{ gameId: string; message: string }>
  quality: 'complete' | 'partial'
}

export function baseballLegacyProvenance(game: BaseballLegacyGame): 'baseball' | 'ambiguous' | 'excluded' {
  if (game.status !== 'final') return 'excluded'
  if (game.team_id && game.teams?.seasons.sport !== 'baseball') return 'excluded'
  if (game.sport_id !== null) return game.sport_id === 'baseball' ? 'baseball' : 'excluded'
  if (game.team_id) return game.teams?.seasons.sport === 'baseball' ? 'baseball' : 'excluded'
  return game.season_id === null && game.tournament_id === null ? 'ambiguous' : 'excluded'
}

export function parseBaseballLegacyGame(value: unknown): BaseballLegacyGame | null {
  if (!isPlainObject(value) || typeof value.id !== 'string' || typeof value.game_date !== 'string'
    || typeof value.opponent_name !== 'string' || typeof value.status !== 'string') return null
  for (const key of ['team_id','season_id','tournament_id','sport_id','home_team_player_id','opp_team_player_id']) {
    if (value[key] !== null && typeof value[key] !== 'string') return null
  }
  if (value.teams !== null && (!isPlainObject(value.teams) || typeof value.teams.name !== 'string'
    || !isPlainObject(value.teams.seasons) || typeof value.teams.seasons.sport !== 'string' || typeof value.teams.seasons.name !== 'string')) return null
  return value as unknown as BaseballLegacyGame
}

/** Every source read runs as the caller; no season/career RPC can bypass provenance. */
export async function loadBaseballLegacyAggregates(scope: BaseballAggregateLoadScope, options: {
  userId: string; signal?: AbortSignal; activeRoster?: readonly BaseballAggregateRosterPlayer[]; client?: SupabaseClient
}): Promise<BaseballLegacyResult> {
  const identity = captureAuthIdentity(options.userId)
  const client = options.client ?? supabase
  const current = () => {
    if (!identity || !isCurrentAuthIdentity(identity)) throw new BaseballFeatureError('stale_account', 'The Baseball account changed.')
    if (options.signal?.aborted) throw new BaseballFeatureError('aborted', 'The history read was cancelled.')
  }
  current()
  if (!client) throw new BaseballFeatureError('not_configured', 'Supabase is not configured.')
  const signal = options.signal ?? new AbortController().signal
  const result: BaseballLegacyResult = { players: [], games: [], reviewOnly: [], exclusions: [], quality: 'complete' }
  const totals = new Map<string, BaseballLegacyPlayer>()
  const playerScope = scope.type === 'player' || scope.type === 'career' ? scope : null
  for (const row of options.activeRoster ?? []) {
    const matches = scope.type === 'team' ? row.teamId === scope.id : scope.type === 'season' ? row.seasonId === scope.id
      : scope.type === 'tournament' ? row.teamId === scope.teamId && row.tournamentId === scope.id
        : 'playerId' in scope && row.playerId === scope.playerId && (!scope.teamId || row.teamId === scope.teamId) && (!scope.seasonId || row.seasonId === scope.seasonId)
    if (matches) totals.set(row.playerId, { ...row, games: 0, stats: {} })
  }
  for (let offset = 0; ; offset += PAGE) {
    current()
    let query = client.from('games').select('id,game_date,opponent_name,team_id,season_id,tournament_id,sport_id,status,home_team_player_id,opp_team_player_id,teams(name,seasons(sport,name))')
      .eq('status', 'final').order('id').range(offset, offset + PAGE - 1)
    if (scope.type === 'team') query = query.eq('team_id', scope.id)
    if (scope.type === 'season') query = query.eq('season_id', scope.id)
    if (scope.type === 'tournament') query = query.eq('tournament_id', scope.id).eq('team_id', scope.teamId)
    if (playerScope?.teamId) query = query.eq('team_id', playerScope.teamId)
    if (playerScope?.seasonId) query = query.eq('season_id', playerScope.seasonId)
    const page = await query.abortSignal(signal)
    current()
    if (page.error || !Array.isArray(page.data)) throw new BaseballFeatureError('transport', 'Legacy game history could not load.', page.error)
    const games: BaseballLegacyGame[] = []
    for (const value of page.data) {
      const game = parseBaseballLegacyGame(value)
      if (game) games.push(game)
      else result.exclusions.push({ gameId: typeof value?.id === 'string' ? value.id : 'unknown', message: 'Invalid legacy game metadata.' })
    }
    if (!page.data.length) break
    // Setup SELECT has the same can_read_game policy as games. Any setup, any sport,
    // excludes event authority; a failed absence proof fails the entire read closed.
    const eventIds = new Set<string>()
    for (let start = 0; ; start += PAGE) {
      current()
      const setups = await client.from('game_event_setup_snapshots').select('game_id').in('game_id', games.map(game => game.id))
        .order('game_id').range(start, start + PAGE - 1).abortSignal(signal)
      current()
      if (setups.error || !Array.isArray(setups.data)) throw new BaseballFeatureError('transport', 'Legacy event-authority checks could not load.', setups.error)
      for (const row of setups.data) eventIds.add(row.game_id)
      if (setups.data.length < PAGE) break
    }
    for (const game of games) {
      current()
      if (eventIds.has(game.id)) continue
      const provenance = baseballLegacyProvenance(game)
      if (provenance === 'excluded') continue
      if (provenance === 'ambiguous' && !playerScope) { result.reviewOnly.push(game); continue }
      try {
        const lines: Array<{ player_id: string; stat_id: string; value: number }> = []
        const seen = new Set<string>()
        for (let start = 0; ; start += PAGE) {
          current()
          const response = await client.rpc('get_game_stats_resolved', { p_game_id: game.id }).order('player_id').order('stat_id')
            .range(start, start + PAGE - 1).abortSignal(signal)
          current()
          if (response.error || !Array.isArray(response.data)) throw legacyReadError(response.error, 'Resolved legacy counters could not load.')
          for (const row of response.data) {
            if (!isPlainObject(row) || typeof row.player_id !== 'string' || typeof row.stat_id !== 'string') throw Error('Invalid legacy counter identity.')
            if (!allowed.has(row.stat_id)) continue
            const key = `${row.player_id}:${row.stat_id}`
            if (seen.has(key)) throw Error('Duplicate resolved legacy counter.')
            seen.add(key)
            if (typeof row.value !== 'number' || !Number.isSafeInteger(row.value) || row.value < 0) throw Error('Invalid resolved legacy counter.')
            lines.push({ player_id: row.player_id, stat_id: row.stat_id, value: row.value })
          }
          if (response.data.length < PAGE) break
        }
        if (provenance === 'ambiguous') {
          if (lines.some(row => row.player_id === playerScope!.playerId && row.player_id !== game.home_team_player_id && row.player_id !== game.opp_team_player_id)) result.reviewOnly.push(game)
          continue
        }
        const ids = [...new Set(lines.filter(row => allowed.has(row.stat_id)
          && row.player_id !== game.home_team_player_id && row.player_id !== game.opp_team_player_id
          && (!playerScope || row.player_id === playerScope.playerId)).map(row => row.player_id))]
        const identities = new Map<string, { id: string; first_name: string; last_name: string | null; nickname: string | null }>()
        for (let start = 0; start < ids.length; start += PAGE) {
          current()
          const response = await client.from('players').select('id,first_name,last_name,nickname').in('id', ids.slice(start, start + PAGE))
            .eq('is_team_placeholder', false).order('id').range(0, PAGE - 1).abortSignal(signal)
          current()
          if (response.error || !Array.isArray(response.data)) throw legacyReadError(response.error, 'Legacy player identities could not load.')
          for (const row of response.data) identities.set(row.id, row)
        }
        const byPlayer = new Map<string, BaseballLegacyPlayer>()
        for (const row of lines) {
          if (!ids.includes(row.player_id) || !identities.has(row.player_id) || !allowed.has(row.stat_id)) continue
          const value = row.value
          const player = byPlayer.get(row.player_id) ?? { playerId: row.player_id, displayName: playerDisplayName(identities.get(row.player_id)!), number: null, games: 1, stats: {} }
          player.stats[row.stat_id] = (player.stats[row.stat_id] ?? 0) + value
          byPlayer.set(row.player_id, player)
        }
        if (playerScope && !byPlayer.has(playerScope.playerId)) continue
        const players = [...byPlayer.values()]
        result.games.push({ game, players })
        for (const row of players) {
          const total = totals.get(row.playerId) ?? { ...row, games: 0, stats: {} }
          total.games += 1
          for (const [id, value] of Object.entries(row.stats)) total.stats[id] = (total.stats[id] ?? 0) + value
          totals.set(row.playerId, total)
        }
      } catch (error) {
        current()
        if (error instanceof BaseballFeatureError && error.code === 'access_denied') throw error
        result.exclusions.push({ gameId: game.id, message: error instanceof Error ? error.message : 'Unreadable legacy game.' })
      }
    }
    if (page.data.length < PAGE) break
  }
  current()
  result.players = [...totals.values()]
  result.quality = result.exclusions.length ? 'partial' : 'complete'
  return result
}

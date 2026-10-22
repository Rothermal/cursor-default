import type { SupabaseClient } from '@supabase/supabase-js'
import { playerDisplayName } from '../display'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../authIdentity'
import { supabase } from '../supabase'
import { loadBaseballCloudShell } from './cloudSync'
import { createBaseballPersonalIdentityClient, type BaseballPersonalLinkReview } from './personalIdentity'
import { createBaseballUuid } from './id'
import type { BaseballLinkIntentStore, BaseballPersonalLinkIntent } from './personalLinkIntents'

export interface BaseballMyPlayer { id: string; displayName: string }
export async function loadBaseballMyPlayers(userId: string, current: () => void, signal?: AbortSignal, client: SupabaseClient | null = supabase): Promise<BaseballMyPlayer[]> {
  if (!client) throw Error('Supabase is not configured.')
  const identity = captureAuthIdentity(userId)
  const assertCurrent = () => { current(); if (!identity || !isCurrentAuthIdentity(identity)) throw Error('The player-link account changed.') }
  const pool = new Map<string, BaseballMyPlayer>()
  for (let offset = 0; ; offset += 200) {
    assertCurrent()
    let query = client.from('players').select('id,first_name,last_name,nickname').eq('created_by', userId).eq('is_team_placeholder', false).order('id').range(offset, offset + 199)
    if (signal) query = query.abortSignal(signal)
    const response = await query
    assertCurrent()
    if (response.error || !Array.isArray(response.data)) throw Error('My Players could not load.')
    for (const row of response.data) pool.set(row.id, { id: row.id, displayName: playerDisplayName(row) })
    if (response.data.length < 200) break
  }
  const guardedIds = new Set<string>()
  for (let offset = 0; ; offset += 200) {
    assertCurrent()
    let query = client.from('player_guardians').select('player_id').eq('user_id', userId).order('player_id').range(offset, offset + 199)
    if (signal) query = query.abortSignal(signal)
    const response = await query
    assertCurrent()
    if (response.error || !Array.isArray(response.data)) throw Error('Guardian player links could not load.')
    for (const row of response.data) if (!pool.has(row.player_id)) guardedIds.add(row.player_id)
    if (response.data.length < 200) break
  }
  const ids = [...guardedIds]
  for (let start = 0; start < ids.length; start += 200) {
    assertCurrent()
    let query = client.from('players').select('id,first_name,last_name,nickname').in('id', ids.slice(start, start + 200)).eq('is_team_placeholder', false).order('id').range(0, 199)
    if (signal) query = query.abortSignal(signal)
    const response = await query
    assertCurrent()
    if (response.error || !Array.isArray(response.data)) throw Error('Guardian players could not load.')
    for (const row of response.data) pool.set(row.id, { id: row.id, displayName: playerDisplayName(row) })
  }
  return [...pool.values()].sort((a,b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id))
}

export async function loadBaseballPersonalLinkSheet(gameId: string, userId: string, current: () => void, signal?: AbortSignal) {
  current()
  const shell = await loadBaseballCloudShell(gameId)
  current()
  const setup = shell.state.sportGameState?.sportId === 'baseball' ? shell.state.sportGameState.setup : null
  if (!setup || setup.sourceTeamId || setup.sourceSeasonId || shell.game.team_id || shell.game.season_id || shell.game.created_by !== userId) throw Error('Only the creator can review personal Baseball player links.')
  const participants = setup.participants.map(player => ({ id: player.id, displayName: player.displayName }))
  const review = await createBaseballPersonalIdentityClient(userId, { signal }).review(gameId, participants.map(player => player.id))
  current()
  const players = await loadBaseballMyPlayers(userId, current, signal)
  current()
  return { participants, review, players }
}

/** Persist one immutable reviewed operation before dispatch. Retry never changes its payload. */
export function prepareBaseballPersonalLinkIntent(input: {
  userId: string; localGameId: string; participantId: string; targetPlayerId: string; review: BaseballPersonalLinkReview
  participantIds: string[]; reason: string
}, store: BaseballLinkIntentStore): BaseballPersonalLinkIntent {
  if (input.review.participantSourceMap[input.participantId] && input.review.participantSourceMap[input.participantId] !== input.targetPlayerId) throw Error('An existing player-history link cannot be replaced.')
  if (Object.entries(input.review.participantSourceMap).some(([id, player]) => id !== input.participantId && player === input.targetPlayerId)) throw Error('This player is already linked to another participant.')
  const previous = store.read(input.userId, input.localGameId, input.participantId)
  const intent: BaseballPersonalLinkIntent = { version: 1, userId: input.userId, localGameId: input.localGameId, participantId: input.participantId,
    targetPlayerId: input.targetPlayerId, operationId: createBaseballUuid(), revision: (previous?.revision ?? 0) + 1,
    reviewed: { gameId: input.review.gameId, expectedMapFingerprint: input.review.mapFingerprint, expectedPublicationId: input.review.activePublicationId,
      reason: input.reason, participantIds: [...input.participantIds] } }
  store.save(intent, previous?.revision ?? null)
  return intent
}

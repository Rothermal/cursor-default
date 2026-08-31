import type { GameState } from '../../types'
import { isGameEventEnvelope, isPlainObject } from '../gameEvents/envelope'
import { supabase } from '../supabase'
import { reopenBasketballMatch } from './commands'
import type { BasketballReopenMode } from './types'

export interface BasketballReopenHandoff {
  publicationId: string
  primaryRecorderId: string
  reason: string
  mode: BasketballReopenMode
  reopenedAt: string
}

export type ApplyBasketballReopenHandoffResult =
  | { ok: true; state: GameState; changed: boolean }
  | { ok: false; state: GameState; reason: string }

export async function loadBasketballReopenHandoff(
  gameId: string
): Promise<BasketballReopenHandoff | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('get_basketball_reopen_handoff_v1', {
    p_game_id: gameId,
  })
  if (error) throw new Error(`Basketball reopen handoff could not load: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) return null
  if (data.length !== 1 || !isPlainObject(data[0])) {
    throw new Error('Basketball reopen handoff response is invalid.')
  }
  const row = data[0]
  const handoff: BasketballReopenHandoff = {
    publicationId: requiredString(row.publication_id, 'publication id'),
    primaryRecorderId: requiredString(row.primary_recorded_by, 'primary recorder'),
    reason: requiredString(row.reason, 'reopen reason'),
    mode: reopenMode(row.mode),
    reopenedAt: requiredTimestamp(row.reopened_at, 'reopen time'),
  }
  return handoff
}

export function applyBasketballReopenHandoff(
  state: GameState,
  userId: string,
  gameId: string,
  handoff: BasketballReopenHandoff
): ApplyBasketballReopenHandoffResult {
  if (state.cloudSync.gameId !== gameId) {
    return { ok: false, state, reason: 'The local Basketball binding does not match this game.' }
  }
  if (!userId || handoff.primaryRecorderId !== userId) {
    return { ok: false, state, reason: 'Only the prior recorder can resume this Basketball stream.' }
  }
  if (state.sportGameState?.sportId !== 'basketball' || !state.eventStream) {
    return { ok: false, state, reason: 'The local Basketball event stream is unavailable.' }
  }

  const cloudStateChanged = state.cloudSync.gameStatus !== 'in_progress' ||
    state.cloudSync.status !== 'idle' || state.cloudSync.lastError !== null
  const cloudReopenedState: GameState = cloudStateChanged
    ? {
        ...state,
        cloudSync: {
          ...state.cloudSync,
          gameStatus: 'in_progress',
          status: 'idle',
          lastError: null,
        },
      }
    : state
  if (hasAppliedHandoff(cloudReopenedState, handoff)) {
    return { ok: true, state: cloudReopenedState, changed: cloudStateChanged }
  }

  const result = reopenBasketballMatch(cloudReopenedState, {
    recorderUserId: userId,
    occurredAt: handoff.reopenedAt,
    reason: handoff.reason,
    mode: handoff.mode,
  })
  if (!result.ok) return { ok: false, state, reason: result.message }
  return { ok: true, state: result.state, changed: true }
}

function hasAppliedHandoff(state: GameState, handoff: BasketballReopenHandoff): boolean {
  return state.eventStream?.events.some(raw => {
    if (!isGameEventEnvelope(raw) || raw.deletedAt !== null) return false
    return raw.eventType === 'basketball.match_reopened' &&
      raw.recorderUserId === handoff.primaryRecorderId &&
      raw.occurredAt === handoff.reopenedAt &&
      raw.payload.reason === handoff.reason &&
      raw.payload.mode === handoff.mode
  }) ?? false
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`)
  return value
}

function requiredTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`Invalid ${label}.`)
  return timestamp
}

function reopenMode(value: unknown): BasketballReopenMode {
  if (value !== 'correct_records' && value !== 'resume_game') {
    throw new Error('Invalid Basketball reopen mode.')
  }
  return value
}

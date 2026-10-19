import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { reopenBaseballGame } from './commands'

/**
 * What a manager's cloud reopen hands to the matching parked game on this device. Baseball has no
 * server handoff read (plan Q5: one reopen kind), so it comes straight from the reopen result
 * and the publication it invalidated.
 */
export interface BaseballReopenHandoff {
  sportId: 'baseball'
  publicationId: string
  primaryRecorderId: string
  reason: string
  reopenedAt: string
}

export type ApplyBaseballReopenHandoffResult =
  | { ok: true; state: GameState; changed: boolean }
  | { ok: false; state: GameState; reason: string }

/**
 * Marks the local binding in progress again and, when this account recorded the published stream
 * and its local copy is final, abandoned or suspended, appends `baseball.game_reopened` with the
 * manager's reason so the recorder can correct or continue. Applying it twice changes nothing.
 */
export function applyBaseballReopenHandoff(
  state: GameState,
  userId: string,
  gameId: string,
  handoff: BaseballReopenHandoff
): ApplyBaseballReopenHandoffResult {
  if (handoff.sportId !== 'baseball' || !handoff.publicationId.trim() ||
    !handoff.primaryRecorderId.trim() || handoff.reason.trim().length < 3 ||
    !Number.isFinite(Date.parse(handoff.reopenedAt))) {
    return { ok: false, state, reason: 'The Baseball reopen handoff is invalid.' }
  }
  if (state.cloudSync.gameId !== gameId) {
    return { ok: false, state, reason: 'The local Baseball binding does not match this game.' }
  }
  if (state.sportGameState?.sportId !== 'baseball' || !state.eventStream) {
    return { ok: false, state, reason: 'The local Baseball event stream is unavailable.' }
  }

  const cloudStateChanged = state.cloudSync.gameStatus !== 'in_progress' ||
    state.cloudSync.status !== 'idle' || state.cloudSync.lastError !== null
  const reopenedBinding: GameState = cloudStateChanged
    ? { ...state, cloudSync: { ...state.cloudSync, gameStatus: 'in_progress', status: 'idle', lastError: null } }
    : state

  const status = state.sportGameState.projection.status
  const terminal = status === 'final' || status === 'abandoned' || status === 'suspended'
  if (!userId || handoff.primaryRecorderId !== userId || !terminal) {
    return { ok: true, state: reopenedBinding, changed: cloudStateChanged }
  }
  if (state.eventStream.events.some(event => !isGameEventEnvelope(event) || event.recorderUserId !== userId)) {
    return { ok: false, state, reason: 'The local Baseball stream belongs to another recorder or needs recovery.' }
  }

  const result = reopenBaseballGame(reopenedBinding, handoff.reason, {
    recorderUserId: userId,
    occurredAt: laterTime(handoff.reopenedAt, lastOccurredAt(state)),
  })
  if (!result.ok) return { ok: false, state, reason: result.message }
  return { ok: true, state: result.state, changed: true }
}

/** The local stream never moves backwards in time, even when this device's clock ran ahead. */
function lastOccurredAt(state: GameState): string | null {
  let latest: string | null = null
  for (const event of state.eventStream?.events ?? []) {
    if (!isGameEventEnvelope(event)) continue
    if (latest === null || Date.parse(event.occurredAt) > Date.parse(latest)) latest = event.occurredAt
  }
  return latest
}

function laterTime(a: string, b: string | null): string {
  return b !== null && Date.parse(b) > Date.parse(a) ? b : a
}

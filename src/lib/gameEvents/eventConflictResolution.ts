import type { GameState } from '../../types'
import { applyGameEventConflictResolution } from './cloudConflicts'
import type { EventCloudTransportAdapter } from './cloudTransport'
import { isGameEventEnvelope } from './envelope'

export type EventConflictResolutionResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string }

export function resolveEventConflictInState(
  state: GameState,
  eventId: string,
  resolution: 'local' | 'remote',
  adapter: EventCloudTransportAdapter,
  now: string
): EventConflictResolutionResult {
  if (state.sportGameState?.sportId !== adapter.sportId) {
    return { ok: false, reason: 'This game does not support event conflict recovery.' }
  }
  const conflict = state.cloudSync.eventConflicts?.find(item => item.eventId === eventId)
  if (!conflict || !state.eventStream) {
    return { ok: false, reason: 'That event conflict is no longer available.' }
  }
  if (
    conflict.localEvent.sportId !== adapter.sportId ||
    conflict.remoteEvent.sportId !== adapter.sportId ||
    !state.eventStream.events.some(
      event => isGameEventEnvelope(event) && event.id === eventId
    )
  ) {
    return { ok: false, reason: 'That event conflict is invalid for this game.' }
  }

  const applied = applyGameEventConflictResolution(
    state.eventStream,
    conflict,
    resolution,
    now,
    adapter.remoteConflictRevisionPolicy
  )
  const remainingConflicts = (state.cloudSync.eventConflicts ?? []).filter(
    item => item.eventId !== eventId
  )
  const candidate: GameState = {
    ...state,
    eventStream: applied.eventStream,
    cloudSync: {
      ...state.cloudSync,
      eventSyncBase: {
        ...(state.cloudSync.eventSyncBase ?? {}),
        [eventId]: applied.syncBase,
      },
      eventConflicts: remainingConflicts,
      pendingEventConflictResolutions: [
        ...(state.cloudSync.pendingEventConflictResolutions ?? []),
        applied.pending,
      ],
      status: remainingConflicts.length > 0 ? 'error' : 'idle',
      lastError:
        remainingConflicts.length > 0
          ? 'Review competing event revisions before syncing.'
          : null,
    },
  }
  const rebuilt = adapter.rebuild(candidate)
  if (!rebuilt.inspection.complete) {
    return {
      ok: false,
      reason: rebuilt.inspection.diagnostics[0]?.message ?? 'That resolution is not valid.',
    }
  }
  return { ok: true, state: rebuilt.state }
}

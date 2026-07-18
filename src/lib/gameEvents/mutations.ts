import type { GameState } from '../../types'
import { cloneEvent, isGameEventEnvelope } from './envelope'
import { rebuildGameEventProjection, type GameEventProjectorRegistry } from './projection'
import type { GameEventRegistry } from './registry'
import { createGameEventStream } from './stream'
import type {
  GameEvent,
  GameEventEditableFields,
  GameEventMutationErrorCode,
  GameEventMutationResult,
} from './types'

function failed(
  state: GameState,
  code: GameEventMutationErrorCode,
  message: string
): GameEventMutationResult {
  return { ok: false, state, error: { code, message } }
}

function hasLegacyAggregateActivity(state: GameState): boolean {
  return (
    state.actionLog.length > 0 ||
    state.shotChart.length > 0 ||
    state.opponentScore !== 0 ||
    (state.homeTeamScore !== null && state.homeTeamScore !== 0) ||
    state.homeScoreAdjustment !== 0 ||
    state.players.some(player => Object.values(player.stats).some(value => value !== 0))
  )
}

export function initializeGameEventStream<TEvent extends GameEvent>(
  state: GameState,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  if (state.eventStream) return rebuildAsSuccess(state, registry, projectors)
  if (hasLegacyAggregateActivity(state)) {
    return failed(
      state,
      'legacy_activity_present',
      'An event stream cannot be initialized after aggregate tracking has begun.'
    )
  }
  return rebuildAsSuccess({ ...state, eventStream: createGameEventStream() }, registry, projectors)
}

export function addGameEvent<TEvent extends GameEvent>(
  state: GameState,
  event: GameEvent,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  if (!state.eventStream) {
    return failed(state, 'stream_not_initialized', 'Initialize the event stream before adding events.')
  }
  if (
    !isGameEventEnvelope(event) ||
    event.revision !== 1 ||
    event.deletedAt !== null ||
    !registry.inspect(event).ok
  ) {
    return failed(state, 'invalid_event', 'The event is not valid for the installed registry.')
  }
  if (state.sport?.id !== event.sportId) {
    return failed(state, 'sport_mismatch', 'The event sport does not match the active game.')
  }
  if (state.eventStream.events.some(raw => isGameEventEnvelope(raw) && raw.id === event.id)) {
    return failed(state, 'duplicate_event_id', 'An event with this id already exists.')
  }
  return rebuildAsSuccess(
    {
      ...state,
      eventStream: {
        ...state.eventStream,
        events: [...state.eventStream.events, cloneEvent(event)],
      },
    },
    registry,
    projectors
  )
}

export function updateGameEvent<TEvent extends GameEvent>(
  state: GameState,
  eventId: string,
  changes: Partial<GameEventEditableFields>,
  now: string,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  return reviseEvent(state, eventId, registry, projectors, event => {
    if (event.deletedAt) return { error: 'already_deleted' as const }
    return {
      event: {
        ...event,
        ...changes,
        id: event.id,
        sportId: event.sportId,
        eventType: event.eventType,
        recorderUserId: event.recorderUserId,
        sequence: event.sequence,
        createdAt: event.createdAt,
        revision: event.revision + 1,
        updatedAt: now,
        deletedAt: null,
      },
    }
  })
}

export function deleteGameEvent<TEvent extends GameEvent>(
  state: GameState,
  eventId: string,
  now: string,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  return reviseEvent(state, eventId, registry, projectors, event => {
    if (event.deletedAt) return { error: 'already_deleted' as const }
    return {
      event: { ...event, revision: event.revision + 1, updatedAt: now, deletedAt: now },
    }
  })
}

export function restoreGameEvent<TEvent extends GameEvent>(
  state: GameState,
  eventId: string,
  now: string,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  return reviseEvent(state, eventId, registry, projectors, event => {
    if (!event.deletedAt) return { error: 'not_deleted' as const }
    return {
      event: { ...event, revision: event.revision + 1, updatedAt: now, deletedAt: null },
    }
  })
}

type RevisionOutcome =
  | { event: GameEvent }
  | { error: 'already_deleted' | 'not_deleted' }

function reviseEvent<TEvent extends GameEvent>(
  state: GameState,
  eventId: string,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>,
  revise: (event: GameEvent) => RevisionOutcome
): GameEventMutationResult {
  if (!state.eventStream) {
    return failed(state, 'stream_not_initialized', 'Initialize the event stream before editing events.')
  }
  const index = state.eventStream.events.findIndex(
    raw => isGameEventEnvelope(raw) && raw.id === eventId
  )
  if (index < 0) return failed(state, 'event_not_found', 'The event was not found.')

  const inspected = registry.inspect(state.eventStream.events[index])
  if (!inspected.ok) {
    return failed(state, 'invalid_event', 'A quarantined event cannot be edited by the typed mutation API.')
  }
  const outcome = revise(inspected.event)
  if ('error' in outcome) {
    return failed(
      state,
      outcome.error,
      outcome.error === 'already_deleted' ? 'The event is already deleted.' : 'The event is not deleted.'
    )
  }
  if (!isGameEventEnvelope(outcome.event) || !registry.inspect(outcome.event).ok) {
    return failed(state, 'invalid_event', 'The event update failed validation.')
  }

  const events = [...state.eventStream.events]
  events[index] = cloneEvent(outcome.event)
  return rebuildAsSuccess(
    { ...state, eventStream: { ...state.eventStream, events } },
    registry,
    projectors
  )
}

function rebuildAsSuccess<TEvent extends GameEvent>(
  state: GameState,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  const rebuilt = rebuildGameEventProjection(state, registry, projectors)
  return { ok: true, state: rebuilt.state, inspection: rebuilt.inspection }
}

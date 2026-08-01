import type { GameState } from '../../types'
import { cloneEvent, isGameEventEnvelope } from './envelope'
import { rebuildGameEventProjection, type GameEventProjectorRegistry } from './projection'
import type { GameEventRegistry } from './registry'
import { createGameEventStream } from './stream'
import type {
  GameEvent,
  GameEventEditableFields,
  GameEventMutation,
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
  const projector = state.sport ? projectors.get(state.sport.id) : undefined
  if (!state.sport || !projector) {
    return failed(
      state,
      'unsupported_event_sport',
      'The active sport does not have an installed event projector.'
    )
  }
  if (
    projector.requiresSportGameState &&
    state.sportGameState?.sportId !== state.sport.id
  ) {
    return failed(
      state,
      'sport_setup_required',
      'Configure the sport-specific game setup before initializing its event stream.'
    )
  }
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
  return appendAndRequireComplete(
    state,
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

export function addGameEvents<TEvent extends GameEvent>(
  state: GameState,
  events: GameEvent[],
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  if (!state.eventStream) {
    return failed(state, 'stream_not_initialized', 'Initialize the event stream before adding events.')
  }
  if (events.length === 0) {
    return failed(state, 'invalid_event', 'At least one event is required.')
  }

  const existingIds = new Set(
    state.eventStream.events
      .filter(isGameEventEnvelope)
      .map(event => event.id)
  )
  const batchIds = new Set<string>()
  for (const event of events) {
    if (
      !isGameEventEnvelope(event) ||
      event.revision !== 1 ||
      event.deletedAt !== null ||
      !registry.inspect(event).ok
    ) {
      return failed(state, 'invalid_event', 'Every event in the batch must be valid.')
    }
    if (state.sport?.id !== event.sportId) {
      return failed(state, 'sport_mismatch', 'Every event must match the active game sport.')
    }
    if (existingIds.has(event.id) || batchIds.has(event.id)) {
      return failed(state, 'duplicate_event_id', 'Every event in the batch must have a unique id.')
    }
    batchIds.add(event.id)
  }

  return appendAndRequireComplete(
    state,
    {
      ...state,
      eventStream: {
        ...state.eventStream,
        events: [...state.eventStream.events, ...events.map(cloneEvent)],
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
  return reviseEvent(state, eventId, registry, projectors, 'runtime', event => {
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
  return reviseEvent(state, eventId, registry, projectors, 'stored', event => {
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
  return reviseEvent(state, eventId, registry, projectors, 'stored', event => {
    if (!event.deletedAt) return { error: 'not_deleted' as const }
    return {
      event: { ...event, revision: event.revision + 1, updatedAt: now, deletedAt: null },
    }
  })
}

export function applyGameEventMutations<TEvent extends GameEvent>(
  state: GameState,
  mutations: readonly GameEventMutation[],
  now: string,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  // Atomic batches use append-strict semantics: unlike the single-event revision helpers, their
  // final projection must be complete. A one-item batch is therefore not always interchangeable.
  if (!state.eventStream) {
    return failed(state, 'stream_not_initialized', 'Initialize the event stream before editing events.')
  }
  if (mutations.length === 0) {
    return failed(state, 'empty_mutation_batch', 'At least one event mutation is required.')
  }

  const events = [...state.eventStream.events]
  const targetedIds = new Set<string>()

  for (const mutation of mutations) {
    if (targetedIds.has(mutation.eventId)) {
      return failed(
        state,
        'duplicate_mutation_target',
        'An event may be revised only once in an atomic mutation.'
      )
    }
    targetedIds.add(mutation.eventId)

    const index = state.eventStream.events.findIndex(
      raw => isGameEventEnvelope(raw) && raw.id === mutation.eventId
    )
    if (index < 0) return failed(state, 'event_not_found', 'The event was not found.')

    const stored = state.eventStream.events[index]
    const inspected = registry.inspect(stored)
    if (!inspected.ok) {
      return failed(
        state,
        'invalid_event',
        'A quarantined event cannot be edited by the typed mutation API.'
      )
    }
    if (state.sport?.id !== inspected.event.sportId) {
      return failed(state, 'sport_mismatch', 'The event sport does not match the active game.')
    }

    const outcome = applyMutationToEvent(stored, inspected.event, mutation, now)
    if ('error' in outcome) {
      return failed(
        state,
        outcome.error,
        outcome.error === 'already_deleted'
          ? 'The event is already deleted.'
          : 'The event is not deleted.'
      )
    }
    if (!isGameEventEnvelope(outcome.event) || !registry.inspect(outcome.event).ok) {
      return failed(state, 'invalid_event', 'The event update failed validation.')
    }
    events[index] = cloneEvent(outcome.event)
  }

  const candidate = {
    ...state,
    eventStream: { ...state.eventStream, events },
  }
  const rebuilt = rebuildGameEventProjection(candidate, registry, projectors)
  if (!rebuilt.inspection.complete) {
    return failed(
      state,
      'incomplete_projection',
      'The event mutations would create invalid or incomplete match history.'
    )
  }
  return { ok: true, state: rebuilt.state, inspection: rebuilt.inspection }
}

function applyMutationToEvent(
  stored: unknown,
  runtime: GameEvent,
  mutation: GameEventMutation,
  now: string
): RevisionOutcome {
  if (mutation.type === 'update') {
    if (runtime.deletedAt) return { error: 'already_deleted' }
    return {
      event: {
        ...runtime,
        ...mutation.changes,
        id: runtime.id,
        sportId: runtime.sportId,
        eventType: runtime.eventType,
        recorderUserId: runtime.recorderUserId,
        sequence: runtime.sequence,
        createdAt: runtime.createdAt,
        revision: runtime.revision + 1,
        updatedAt: now,
        deletedAt: null,
      },
    }
  }

  if (!isGameEventEnvelope(stored)) return { error: 'not_deleted' }
  if (mutation.type === 'delete') {
    if (stored.deletedAt) return { error: 'already_deleted' }
    return {
      event: { ...stored, revision: stored.revision + 1, updatedAt: now, deletedAt: now },
    }
  }

  if (!stored.deletedAt) return { error: 'not_deleted' }
  return {
    event: { ...stored, revision: stored.revision + 1, updatedAt: now, deletedAt: null },
  }
}

type RevisionOutcome =
  | { event: GameEvent }
  | { error: 'already_deleted' | 'not_deleted' }

function reviseEvent<TEvent extends GameEvent>(
  state: GameState,
  eventId: string,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>,
  sourceMode: 'runtime' | 'stored',
  revise: (event: GameEvent) => RevisionOutcome
): GameEventMutationResult {
  if (!state.eventStream) {
    return failed(state, 'stream_not_initialized', 'Initialize the event stream before editing events.')
  }
  const index = state.eventStream.events.findIndex(
    raw => isGameEventEnvelope(raw) && raw.id === eventId
  )
  if (index < 0) return failed(state, 'event_not_found', 'The event was not found.')

  const stored = state.eventStream.events[index]
  const inspected = registry.inspect(stored)
  if (!inspected.ok) {
    return failed(state, 'invalid_event', 'A quarantined event cannot be edited by the typed mutation API.')
  }
  const source = sourceMode === 'stored' && isGameEventEnvelope(stored) ? stored : inspected.event
  const outcome = revise(source)
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

function appendAndRequireComplete<TEvent extends GameEvent>(
  originalState: GameState,
  appendedState: GameState,
  registry: GameEventRegistry<TEvent>,
  projectors: GameEventProjectorRegistry<TEvent>
): GameEventMutationResult {
  const rebuilt = rebuildGameEventProjection(appendedState, registry, projectors)
  if (!rebuilt.inspection.complete) {
    return failed(
      originalState,
      'incomplete_projection',
      'The event append would create invalid or incomplete match history.'
    )
  }
  return { ok: true, state: rebuilt.state, inspection: rebuilt.inspection }
}

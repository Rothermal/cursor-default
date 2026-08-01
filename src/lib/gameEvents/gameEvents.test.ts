import { describe, expect, it } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  addGameEvent,
  addGameEvents,
  applyGameEventMutations,
  deleteGameEvent,
  initializeGameEventStream,
  restoreGameEvent,
  updateGameEvent,
} from './mutations'
import { GameEventProjectorRegistry } from './projection'
import { GameEventRegistry, type GameEventDefinition } from './registry'
import { compareGameEvents, inspectGameEventStream, normalizeGameEventStream } from './stream'
import type { GameEvent, JsonObject } from './types'

interface FixturePayload extends JsonObject {
  value: number
}

type FixtureEvent = GameEvent<FixturePayload, 'fixture_score', 'soccer'>

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'G',
}

const definition: GameEventDefinition<FixtureEvent> = {
  sportId: 'soccer',
  eventType: 'fixture_score',
  currentSchemaVersion: 2,
  migrations: {
    1: event => ({
      ...event,
      schemaVersion: 2,
      payload: { value: Number(event.payload.amount ?? 0) },
    }),
  },
  validate: event => {
    if (event.schemaVersion !== 2 || typeof event.payload.value !== 'number') {
      return { ok: false, message: 'Fixture score requires a numeric value.' }
    }
    return { ok: true, event: event as FixtureEvent }
  },
}

const registry = new GameEventRegistry<FixtureEvent>([definition])
const projectors = new GameEventProjectorRegistry<FixtureEvent>([
  {
    sportId: 'soccer',
    project: (state, events) => {
      const tracked = events
        .filter(event => event.teamSide === 'tracked')
        .reduce((total, event) => total + event.payload.value, 0)
      const opponent = events
        .filter(event => event.teamSide === 'opponent')
        .reduce((total, event) => total + event.payload.value, 0)
      return {
        playerStatsById: Object.fromEntries(
          state.players.map(player => [player.id, { fixture_scores: tracked }])
        ),
        homeTeamScore: tracked,
        opponentScore: opponent,
        shotChart: [],
      }
    },
  },
])

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createInitialState(),
    sport: soccer,
    players: [{ id: 'player-1', name: 'One', number: '1', stats: {} }],
    activePlayerId: 'player-1',
    ...overrides,
  }
}

function event(
  id: string,
  overrides: Partial<FixtureEvent> = {}
): FixtureEvent {
  return {
    id,
    sportId: 'soccer',
    eventType: 'fixture_score',
    schemaVersion: 2,
    recorderUserId: 'user-1',
    sequence: 1,
    period: { id: 'regulation-1', order: 1 },
    elapsedMs: 1_000,
    occurredAt: '2026-07-17T12:00:00.000Z',
    teamSide: 'tracked',
    location: null,
    actors: [{ kind: 'player', role: 'scorer', playerId: 'player-1' }],
    payload: { value: 1 },
    revision: 1,
    createdAt: '2026-07-17T12:00:00.000Z',
    updatedAt: '2026-07-17T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('game event registry and stream inspection', () => {
  it('migrates a fixture event for runtime use without rewriting raw storage', () => {
    const raw = event('10000000-0000-4000-8000-000000000001', {
      schemaVersion: 1,
      payload: { amount: 3 } as unknown as FixturePayload,
    })
    const stream = { version: 1, events: [raw] }

    const inspected = inspectGameEventStream(stream, registry)

    expect(inspected.complete).toBe(true)
    expect(inspected.activeEvents[0].schemaVersion).toBe(2)
    expect(inspected.activeEvents[0].payload.value).toBe(3)
    expect((stream.events[0] as FixtureEvent).schemaVersion).toBe(1)
  })

  it('preserves and quarantines malformed, unknown, and future events', () => {
    const unknown = { ...event('10000000-0000-4000-8000-000000000002'), eventType: 'future' }
    const future = event('10000000-0000-4000-8000-000000000003', { schemaVersion: 9 })
    const malformed = { id: 'preserve-me', payload: { anything: true } }
    const stream = { version: 1, events: [unknown, future, malformed] }

    const inspected = inspectGameEventStream(stream, registry)

    expect(inspected.complete).toBe(false)
    expect(inspected.diagnostics.map(item => item.code)).toEqual([
      'unknown_event_type',
      'unsupported_schema_version',
      'invalid_envelope',
    ])
    expect(stream.events).toEqual([unknown, future, malformed])
  })

  it('orders by segment, elapsed time, sequence, then id and separates tombstones', () => {
    const events = [
      event('10000000-0000-4000-8000-000000000004', { sequence: 3, elapsedMs: 500 }),
      event('10000000-0000-4000-8000-000000000003', { sequence: 2, elapsedMs: 500 }),
      event('10000000-0000-4000-8000-000000000002', { sequence: 1, elapsedMs: 900 }),
      event('10000000-0000-4000-8000-000000000001', {
        period: { id: 'regulation-2', order: 2 },
        deletedAt: '2026-07-17T12:01:00.000Z',
        updatedAt: '2026-07-17T12:01:00.000Z',
      }),
    ]

    const inspected = inspectGameEventStream({ version: 1, events }, registry)

    expect(inspected.activeEvents.map(item => item.id)).toEqual([
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000002',
    ])
    expect(inspected.deletedEvents).toHaveLength(1)
    expect([...events].sort(compareGameEvents)).toHaveLength(4)
  })

  it('normalizes missing legacy streams to null while preserving future containers', () => {
    expect(normalizeGameEventStream(undefined)).toBeNull()
    expect(normalizeGameEventStream({ version: 2, events: [{ future: true }] })).toEqual({
      version: 2,
      events: [{ future: true }],
    })
  })

  it('requires event definitions to opt into the neutral team side', () => {
    const neutral = event('10000000-0000-4000-8000-000000000005', {
      teamSide: 'neutral',
    })

    expect(registry.inspect(neutral)).toMatchObject({
      ok: false,
      diagnostic: { code: 'validation_failed' },
    })

    const neutralRegistry = new GameEventRegistry<FixtureEvent>([{
      ...definition,
      allowedTeamSides: ['tracked', 'opponent', 'neutral'],
    }])
    expect(neutralRegistry.inspect(neutral)).toMatchObject({ ok: true })
  })
})

describe('game event mutations and projections', () => {
  it('requires explicit initialization and rejects legacy aggregate activity', () => {
    const pending = event('20000000-0000-4000-8000-000000000001')
    expect(addGameEvent(state(), pending, registry, projectors)).toMatchObject({
      ok: false,
      error: { code: 'stream_not_initialized' },
    })
    expect(
      initializeGameEventStream(state({ opponentScore: 1 }), registry, projectors)
    ).toMatchObject({ ok: false, error: { code: 'legacy_activity_present' } })
    expect(initializeGameEventStream(state(), registry, projectors)).toMatchObject({
      ok: true,
      state: { eventStream: { version: 1, events: [] } },
    })
  })

  it('fully rebuilds projections through add, edit, tombstone, and restore', () => {
    const initialized = initializeGameEventStream(state(), registry, projectors)
    if (!initialized.ok) throw new Error('fixture initialization failed')
    const added = addGameEvent(
      initialized.state,
      event('20000000-0000-4000-8000-000000000002'),
      registry,
      projectors
    )
    if (!added.ok) throw new Error('fixture add failed')
    expect(added.state.homeTeamScore).toBe(1)
    expect(added.state.players[0].stats.fixture_scores).toBe(1)
    expect(added.state.actionLog).toEqual([])

    const edited = updateGameEvent(
      added.state,
      '20000000-0000-4000-8000-000000000002',
      { payload: { value: 2 } },
      '2026-07-17T12:02:00.000Z',
      registry,
      projectors
    )
    if (!edited.ok) throw new Error('fixture edit failed')
    expect(edited.state.homeTeamScore).toBe(2)
    expect((edited.state.eventStream?.events[0] as FixtureEvent).revision).toBe(2)

    const deleted = deleteGameEvent(
      edited.state,
      '20000000-0000-4000-8000-000000000002',
      '2026-07-17T12:03:00.000Z',
      registry,
      projectors
    )
    if (!deleted.ok) throw new Error('fixture delete failed')
    expect(deleted.state.homeTeamScore).toBe(0)
    expect((deleted.state.eventStream?.events[0] as FixtureEvent).revision).toBe(3)

    const restored = restoreGameEvent(
      deleted.state,
      '20000000-0000-4000-8000-000000000002',
      '2026-07-17T12:04:00.000Z',
      registry,
      projectors
    )
    if (!restored.ok) throw new Error('fixture restore failed')
    expect(restored.state.homeTeamScore).toBe(2)
    expect((restored.state.eventStream?.events[0] as FixtureEvent).revision).toBe(4)
  })

  it('keeps raw schema on tombstone/restore but upgrades an explicit content edit', () => {
    const initialized = initializeGameEventStream(state(), registry, projectors)
    if (!initialized.ok) throw new Error('fixture initialization failed')
    const legacy = event('20000000-0000-4000-8000-000000000003', {
      schemaVersion: 1,
      payload: { amount: 3 } as unknown as FixturePayload,
    })
    const added = addGameEvent(initialized.state, legacy, registry, projectors)
    if (!added.ok) throw new Error('legacy fixture add failed')

    const deleted = deleteGameEvent(
      added.state,
      legacy.id,
      '2026-07-17T12:05:00.000Z',
      registry,
      projectors
    )
    if (!deleted.ok) throw new Error('legacy fixture delete failed')
    const deletedRaw = deleted.state.eventStream?.events[0] as FixtureEvent
    expect(deletedRaw.schemaVersion).toBe(1)
    expect(deletedRaw.payload).toEqual({ amount: 3 })

    const restored = restoreGameEvent(
      deleted.state,
      legacy.id,
      '2026-07-17T12:06:00.000Z',
      registry,
      projectors
    )
    if (!restored.ok) throw new Error('legacy fixture restore failed')
    const restoredRaw = restored.state.eventStream?.events[0] as FixtureEvent
    expect(restoredRaw.schemaVersion).toBe(1)
    expect(restoredRaw.payload).toEqual({ amount: 3 })

    const edited = updateGameEvent(
      restored.state,
      legacy.id,
      { payload: { value: 4 } },
      '2026-07-17T12:07:00.000Z',
      registry,
      projectors
    )
    if (!edited.ok) throw new Error('legacy fixture edit failed')
    const editedRaw = edited.state.eventStream?.events[0] as FixtureEvent
    expect(editedRaw.schemaVersion).toBe(2)
    expect(editedRaw.payload).toEqual({ value: 4 })
  })

  it('applies mixed event revisions atomically and rebuilds once', () => {
    let projectionCalls = 0
    const countingProjectors = new GameEventProjectorRegistry<FixtureEvent>([{
      sportId: 'soccer',
      project: (current, events) => {
        projectionCalls += 1
        const total = events.reduce((sum, item) => sum + item.payload.value, 0)
        return {
          playerStatsById: Object.fromEntries(
            current.players.map(player => [player.id, { fixture_scores: total }])
          ),
          homeTeamScore: total,
          opponentScore: 0,
          shotChart: [],
        }
      },
    }])
    const initialized = initializeGameEventStream(state(), registry, countingProjectors)
    if (!initialized.ok) throw new Error('fixture initialization failed')
    const ids = [
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
    ]
    const added = addGameEvents(
      initialized.state,
      ids.map((id, index) => event(id, { sequence: index, payload: { value: index + 1 } })),
      registry,
      countingProjectors
    )
    if (!added.ok) throw new Error('fixture batch add failed')
    const deleted = deleteGameEvent(
      added.state,
      ids[2],
      '2026-07-17T12:08:00.000Z',
      registry,
      countingProjectors
    )
    if (!deleted.ok) throw new Error('fixture setup delete failed')
    projectionCalls = 0

    const result = applyGameEventMutations(
      deleted.state,
      [
        { type: 'update', eventId: ids[0], changes: { payload: { value: 4 } } },
        { type: 'delete', eventId: ids[1] },
        { type: 'restore', eventId: ids[2] },
      ],
      '2026-07-17T12:09:00.000Z',
      registry,
      countingProjectors
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(projectionCalls).toBe(1)
    expect(result.state.homeTeamScore).toBe(7)
    const revised = result.state.eventStream?.events as FixtureEvent[]
    expect(revised.map(item => item.revision)).toEqual([2, 2, 3])
    expect(revised.map(item => item.updatedAt)).toEqual([
      '2026-07-17T12:09:00.000Z',
      '2026-07-17T12:09:00.000Z',
      '2026-07-17T12:09:00.000Z',
    ])
    expect(revised.map(item => item.deletedAt)).toEqual([
      null,
      '2026-07-17T12:09:00.000Z',
      null,
    ])
  })

  it('preserves raw schemas for batch tombstone and restore while updates migrate', () => {
    const initialized = initializeGameEventStream(state(), registry, projectors)
    if (!initialized.ok) throw new Error('fixture initialization failed')
    const first = event('31000000-0000-4000-8000-000000000001', {
      schemaVersion: 1,
      payload: { amount: 2 } as unknown as FixturePayload,
    })
    const second = event('31000000-0000-4000-8000-000000000002', {
      schemaVersion: 1,
      sequence: 2,
      payload: { amount: 3 } as unknown as FixturePayload,
    })
    const added = addGameEvents(initialized.state, [first, second], registry, projectors)
    if (!added.ok) throw new Error('legacy fixture batch add failed')

    const revised = applyGameEventMutations(
      added.state,
      [
        { type: 'update', eventId: first.id, changes: { payload: { value: 4 } } },
        { type: 'delete', eventId: second.id },
      ],
      '2026-07-17T12:10:00.000Z',
      registry,
      projectors
    )
    if (!revised.ok) throw new Error(revised.error.message)
    const raw = revised.state.eventStream?.events as FixtureEvent[]
    expect(raw[0]).toMatchObject({ schemaVersion: 2, payload: { value: 4 } })
    expect(raw[1]).toMatchObject({
      schemaVersion: 1,
      payload: { amount: 3 },
      deletedAt: '2026-07-17T12:10:00.000Z',
    })

    const restored = applyGameEventMutations(
      revised.state,
      [{ type: 'restore', eventId: second.id }],
      '2026-07-17T12:11:00.000Z',
      registry,
      projectors
    )
    if (!restored.ok) throw new Error(restored.error.message)
    expect(restored.state.eventStream?.events[1]).toMatchObject({
      schemaVersion: 1,
      payload: { amount: 3 },
      deletedAt: null,
    })
  })

  it('validates only the final atomic candidate and rolls back incomplete projections', () => {
    let projectionCalls = 0
    const semanticProjectors = new GameEventProjectorRegistry<FixtureEvent>([{
      sportId: 'soccer',
      project: (current, events) => {
        projectionCalls += 1
        const total = events.reduce((sum, item) => sum + item.payload.value, 0)
        const projection = {
          playerStatsById: Object.fromEntries(
            current.players.map(player => [player.id, { fixture_scores: total }])
          ),
          homeTeamScore: total,
          opponentScore: 0,
          shotChart: [],
        }
        return total % 2 === 0
          ? projection
          : {
              projection,
              diagnostics: [{
                code: 'semantic_validation_failed' as const,
                message: 'Fixture totals must be even.',
                eventId: null,
              }],
            }
      },
    }])
    const initialized = initializeGameEventStream(state(), registry, semanticProjectors)
    if (!initialized.ok) throw new Error('fixture initialization failed')
    const firstId = '32000000-0000-4000-8000-000000000001'
    const secondId = '32000000-0000-4000-8000-000000000002'
    const added = addGameEvents(
      initialized.state,
      [event(firstId), event(secondId, { sequence: 2 })],
      registry,
      semanticProjectors
    )
    if (!added.ok) throw new Error('semantic fixture add failed')
    projectionCalls = 0

    const coherent = applyGameEventMutations(
      added.state,
      [
        { type: 'update', eventId: firstId, changes: { payload: { value: 2 } } },
        { type: 'update', eventId: secondId, changes: { payload: { value: 2 } } },
      ],
      '2026-07-17T12:12:00.000Z',
      registry,
      semanticProjectors
    )
    expect(coherent.ok).toBe(true)
    expect(projectionCalls).toBe(1)
    if (!coherent.ok) throw new Error(coherent.error.message)

    projectionCalls = 0
    const incomplete = applyGameEventMutations(
      coherent.state,
      [{ type: 'update', eventId: firstId, changes: { payload: { value: 3 } } }],
      '2026-07-17T12:13:00.000Z',
      registry,
      semanticProjectors
    )
    expect(incomplete).toMatchObject({
      ok: false,
      error: { code: 'incomplete_projection' },
    })
    expect(incomplete.state).toBe(coherent.state)
    expect(projectionCalls).toBe(1)
  })

  it('rejects invalid atomic mutation batches without changing state', () => {
    const initialized = initializeGameEventStream(state(), registry, projectors)
    if (!initialized.ok) throw new Error('fixture initialization failed')
    const id = '33000000-0000-4000-8000-000000000001'
    const added = addGameEvent(initialized.state, event(id), registry, projectors)
    if (!added.ok) throw new Error('fixture add failed')
    const now = '2026-07-17T12:14:00.000Z'
    const mismatchedState = { ...added.state, sport: { ...soccer, id: 'basketball' } }
    const cases = [
      applyGameEventMutations(added.state, [], now, registry, projectors),
      applyGameEventMutations(added.state, [
        { type: 'update', eventId: id, changes: { payload: { value: 2 } } },
        { type: 'delete', eventId: id },
      ], now, registry, projectors),
      applyGameEventMutations(added.state, [
        { type: 'delete', eventId: '33000000-0000-4000-8000-000000000099' },
      ], now, registry, projectors),
      applyGameEventMutations(added.state, [
        { type: 'restore', eventId: id },
      ], now, registry, projectors),
      applyGameEventMutations(added.state, [
        { type: 'update', eventId: id, changes: { teamSide: 'neutral' } },
      ], now, registry, projectors),
      applyGameEventMutations(
        mismatchedState,
        [{ type: 'update', eventId: id, changes: { payload: { value: 2 } } }],
        now,
        registry,
        projectors
      ),
    ]

    expect(cases.map(result => result.ok ? null : result.error.code)).toEqual([
      'empty_mutation_batch',
      'duplicate_mutation_target',
      'event_not_found',
      'not_deleted',
      'invalid_event',
      'sport_mismatch',
    ])
    cases.slice(0, 5).forEach(result => expect(result.state).toBe(added.state))
    expect(cases[5].state).toBe(mismatchedState)

    const deleted = deleteGameEvent(added.state, id, now, registry, projectors)
    if (!deleted.ok) throw new Error('fixture setup delete failed')
    const alreadyDeleted = applyGameEventMutations(
      deleted.state,
      [{ type: 'delete', eventId: id }],
      '2026-07-17T12:15:00.000Z',
      registry,
      projectors
    )
    expect(alreadyDeleted).toMatchObject({
      ok: false,
      error: { code: 'already_deleted' },
    })
    expect(alreadyDeleted.state).toBe(deleted.state)

    const legacyState = state()
    const uninitialized = applyGameEventMutations(
      legacyState,
      [{ type: 'delete', eventId: id }],
      now,
      registry,
      projectors
    )
    expect(uninitialized).toMatchObject({
      ok: false,
      error: { code: 'stream_not_initialized' },
    })
    expect(uninitialized.state).toBe(legacyState)
  })

  it('keeps reducer initialization closed until production soccer setup exists', () => {
    const initialized = gameReducer(state(), { type: 'INITIALIZE_EVENT_STREAM' })
    expect(initialized.eventStream).toBeNull()
    expect(gameReducer(state({ opponentScore: 1 }), { type: 'INITIALIZE_EVENT_STREAM' }).eventStream).toBeNull()
  })
})

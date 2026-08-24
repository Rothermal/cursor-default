import { describe, expect, it } from 'vitest'
import type { GameEventSyncConflict } from '../../types'
import type { GameEvent, GameEventStream } from '../gameEvents/types'
import {
  applyGameEventConflictResolution,
  gameEventSyncBase,
  gameEventSyncConflictFromRow,
  mergeSameRecorderEventStreams,
} from './cloudConflicts'

function event(id: string, revision = 1, value = 'base', sequence = 0): GameEvent {
  return {
    id,
    sportId: 'soccer',
    eventType: 'soccer.test',
    schemaVersion: 1,
    recorderUserId: 'user-1',
    sequence,
    period: { id: 'regulation-1', order: 1 },
    elapsedMs: 1000,
    occurredAt: '2026-07-22T12:00:00.000Z',
    teamSide: 'tracked',
    location: null,
    actors: [],
    payload: { value },
    revision,
    createdAt: '2026-07-22T12:00:00.000Z',
    updatedAt: `2026-07-22T12:00:0${revision}.000Z`,
    deletedAt: null,
  }
}

function stream(...events: GameEvent[]): GameEventStream {
  return { version: 1, events }
}

describe('same-recorder cloud event recovery', () => {
  it('merges unrelated local and remote events without conflict', () => {
    const result = mergeSameRecorderEventStreams(
      stream(event('10000000-0000-4000-8000-000000000001')),
      stream(event('10000000-0000-4000-8000-000000000002', 1, 'remote', 1)),
      {}
    )
    expect(result.conflicts).toEqual([])
    expect(result.eventStream.events).toHaveLength(2)
  })

  it('adopts the side changed since the common event base', () => {
    const original = event('10000000-0000-4000-8000-000000000001')
    const remote = event(original.id, 2, 'remote')
    const remoteResult = mergeSameRecorderEventStreams(
      stream(original),
      stream(remote),
      gameEventSyncBase(stream(original))
    )
    expect(remoteResult.conflicts).toEqual([])
    expect(remoteResult.eventStream.events[0]).toMatchObject({ revision: 2, payload: { value: 'remote' } })

    const local = event(original.id, 2, 'local')
    const localResult = mergeSameRecorderEventStreams(
      stream(local),
      stream(original),
      gameEventSyncBase(stream(original))
    )
    expect(localResult.conflicts).toEqual([])
    expect(localResult.eventStream.events[0]).toMatchObject({ revision: 2, payload: { value: 'local' } })
  })

  it('preserves the local copy and reports when both sides changed the same event', () => {
    const original = event('10000000-0000-4000-8000-000000000001')
    const local = event(original.id, 2, 'local')
    const remote = event(original.id, 2, 'remote')
    const result = mergeSameRecorderEventStreams(
      stream(local),
      stream(remote),
      gameEventSyncBase(stream(original))
    )
    expect(result.eventStream.events[0]).toMatchObject({ payload: { value: 'local' } })
    expect(result.conflicts).toHaveLength(1)
  })

  it('treats divergent copies with no known base conservatively as a conflict', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const result = mergeSameRecorderEventStreams(
      stream(event(id, 2, 'local')),
      stream(event(id, 3, 'remote')),
      {}
    )
    expect(result.conflicts).toHaveLength(1)
  })

  it('turns a local choice into a revision above both copies and bases it on cloud', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const conflict: GameEventSyncConflict = {
      conflictId: '20000000-0000-4000-8000-000000000001',
      eventId: id,
      localEvent: event(id, 2, 'local'),
      remoteEvent: event(id, 3, 'remote'),
      detectedAt: '2026-07-22T12:01:00.000Z',
    }
    const result = applyGameEventConflictResolution(
      stream(conflict.localEvent),
      conflict,
      'local',
      '2026-07-22T12:02:00.000Z'
    )
    expect(result.eventStream.events[0]).toMatchObject({ revision: 4, payload: { value: 'local' } })
    expect(result.pending).toMatchObject({ conflictId: conflict.conflictId, resolution: 'local' })
    expect(result.syncBase.revision).toBe(3)
  })

  it('adopts the cloud copy without manufacturing a revision', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const conflict: GameEventSyncConflict = {
      conflictId: '20000000-0000-4000-8000-000000000001',
      eventId: id,
      localEvent: event(id, 2, 'local'),
      remoteEvent: event(id, 3, 'remote'),
      detectedAt: '2026-07-22T12:01:00.000Z',
    }
    const result = applyGameEventConflictResolution(
      stream(conflict.localEvent),
      conflict,
      'remote',
      '2026-07-22T12:02:00.000Z'
    )
    expect(result.eventStream.events[0]).toEqual(conflict.remoteEvent)
  })

  it('can advance a cloud choice for sports that require a new winning revision', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const conflict: GameEventSyncConflict = {
      conflictId: '20000000-0000-4000-8000-000000000001',
      eventId: id,
      localEvent: event(id, 4, 'local'),
      remoteEvent: event(id, 3, 'remote'),
      detectedAt: '2026-07-22T12:01:00.000Z',
    }
    const result = applyGameEventConflictResolution(
      stream(conflict.localEvent),
      conflict,
      'remote',
      '2026-07-22T12:02:00.000Z',
      'advance'
    )

    expect(result.eventStream.events[0]).toMatchObject({
      revision: 5,
      updatedAt: '2026-07-22T12:02:00.000Z',
      payload: { value: 'remote' },
    })
  })
})

describe('gameEventSyncConflictFromRow', () => {
  const eventId = '10000000-0000-4000-8000-000000000001'
  const conflictId = '20000000-0000-4000-8000-000000000001'
  const detectedAt = '2026-07-22T12:01:00.000Z'

  function conflictRow(overrides: Record<string, unknown> = {}) {
    return {
      id: conflictId,
      event_id: eventId,
      detected_at: detectedAt,
      local_event: event(eventId, 2, 'local'),
      remote_event: event(eventId, 3, 'remote'),
      ...overrides,
    }
  }

  it('parses a strict same-sport conflict row', () => {
    expect(gameEventSyncConflictFromRow(conflictRow(), 'soccer')).toEqual({
      conflictId,
      eventId,
      localEvent: event(eventId, 2, 'local'),
      remoteEvent: event(eventId, 3, 'remote'),
      detectedAt,
    })
  })

  it('rejects malformed rows and sport or id mismatches fail closed', () => {
    expect(gameEventSyncConflictFromRow(null)).toBeNull()
    expect(gameEventSyncConflictFromRow({ ...conflictRow(), id: 12 })).toBeNull()
    expect(gameEventSyncConflictFromRow({
      ...conflictRow(),
      local_event: event('30000000-0000-4000-8000-000000000001', 2, 'local'),
    })).toBeNull()
    expect(gameEventSyncConflictFromRow({
      ...conflictRow(),
      remote_event: {
        ...event(eventId, 3, 'remote'),
        sportId: 'basketball',
      },
    })).toBeNull()
    expect(gameEventSyncConflictFromRow(conflictRow(), 'basketball')).toBeNull()
  })
})

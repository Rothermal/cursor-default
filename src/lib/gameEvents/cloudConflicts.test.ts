import { describe, expect, it } from 'vitest'
import {
  gameEventSyncFingerprint,
  isTimestampOnlyConflict,
  mergeSameRecorderEventStreams,
} from './cloudConflicts'
import { canonicalGameEventStreamForFingerprint } from './stream'
import { settledEventSyncBase } from './eventConflictResolution'
import type { GameEvent, GameEventStream } from './types'

function event(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    id: 'ce19928b-a4e6-4f94-86d6-7ea452a35861',
    sportId: 'basketball',
    eventType: 'basketball.period_ended',
    schemaVersion: 1,
    recorderUserId: 'user-1',
    sequence: 87,
    period: { id: 'regulation-4', order: 4 },
    elapsedMs: null,
    occurredAt: '2026-11-07T17:49:45.110Z',
    teamSide: 'neutral',
    location: null,
    actors: [],
    payload: { periodId: 'regulation-4' },
    revision: 1,
    createdAt: '2026-11-07T17:49:45.110Z',
    updatedAt: '2026-11-07T17:49:45.110Z',
    deletedAt: null,
    ...overrides,
  }
}

const stream = (...events: GameEvent[]): GameEventStream => ({ version: 1, events })

describe('same-recorder merge', () => {
  it('treats cloud timestamp spelling as the same instant', () => {
    const local = event()
    const remote = event({
      occurredAt: '2026-11-07T17:49:45.11+00:00',
      createdAt: '2026-11-07T17:49:45.11+00:00',
      updatedAt: '2026-11-07T17:49:45.11+00:00',
    })
    expect(gameEventSyncFingerprint(remote)).toBe(gameEventSyncFingerprint(local))
    // No sync base (an edit landed mid-sync): identical events must not conflict.
    const merge = mergeSameRecorderEventStreams(stream(local), stream(remote), {})
    expect(merge.conflicts).toEqual([])
    expect(merge.eventStream.events[0]).toEqual(local)
  })

  it('matches a sync base saved with the cloud spelling before the upgrade', () => {
    const cloudSpelled = event({
      occurredAt: '2026-11-07T17:49:45.11+00:00',
      createdAt: '2026-11-07T17:49:45.11+00:00',
      updatedAt: '2026-11-07T17:49:45.11+00:00',
    })
    // The pre-upgrade fingerprint kept timestamps exactly as stored.
    const legacyFingerprint = JSON.stringify(
      canonicalGameEventStreamForFingerprint(stream(cloudSpelled))!.events[0]
    )
    const remoteEdit = event({
      revision: 2,
      updatedAt: '2026-11-07T17:55:00+00:00',
      payload: { periodId: 'regulation-4', note: 'edited elsewhere' },
    })
    const merge = mergeSameRecorderEventStreams(stream(cloudSpelled), stream(remoteEdit), {
      [cloudSpelled.id]: { revision: 1, fingerprint: legacyFingerprint },
    })
    expect(merge.conflicts).toEqual([])
    expect(merge.eventStream.events[0]).toMatchObject({ revision: 2, payload: { note: 'edited elsewhere' } })
  })

  it('reviews divergent edits even when one device is further ahead', () => {
    const shared = event()
    const local = event({ revision: 3, payload: { periodId: 'regulation-4', moved: true } })
    const remote = event({ revision: 2, payload: { periodId: 'regulation-4', note: 'corrected' } })
    for (const base of [{}, { [shared.id]: { revision: 1, fingerprint: gameEventSyncFingerprint(shared) } }]) {
      expect(mergeSameRecorderEventStreams(stream(local), stream(remote), base).conflicts).toHaveLength(1)
    }
  })

  it('recognizes a stored conflict that differs only in timestamp spelling', () => {
    const local = event()
    expect(isTimestampOnlyConflict({
      localEvent: local,
      remoteEvent: event({ updatedAt: '2026-11-07T17:49:45.11+00:00' }),
    })).toBe(true)
    expect(isTimestampOnlyConflict({
      localEvent: local,
      remoteEvent: event({ payload: { periodId: 'regulation-4', note: 'b' } }),
    })).toBe(false)
  })
})

describe('sync base after an upload', () => {
  const withBase = (base: Record<string, { revision: number; fingerprint: string }>) =>
    ({ cloudSync: { eventSyncBase: base } }) as never

  it('keeps the uploaded copies as the base when the game changed mid-upload', () => {
    const latest = withBase({ old: { revision: 1, fingerprint: 'old' } })
    const synced = withBase({ old: { revision: 1, fingerprint: 'old' }, uploaded: { revision: 1, fingerprint: 'up' } })
    expect(settledEventSyncBase(latest, synced, false, true)).toEqual({
      old: { revision: 1, fingerprint: 'old' },
      uploaded: { revision: 1, fingerprint: 'up' },
    })
  })

  it('keeps the device base when a conflict was resolved mid-upload', () => {
    const latest = withBase({ resolved: { revision: 2, fingerprint: 'remote' } })
    const synced = withBase({ resolved: { revision: 1, fingerprint: 'local' } })
    expect(settledEventSyncBase(latest, synced, false, false)).toEqual({
      resolved: { revision: 2, fingerprint: 'remote' },
    })
    expect(settledEventSyncBase(latest, null, false, true)).toEqual({
      resolved: { revision: 2, fingerprint: 'remote' },
    })
  })
})

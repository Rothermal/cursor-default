import { describe, expect, it } from 'vitest'
import {
  canKeepLocalWithoutReview,
  gameEventSyncFingerprint,
  mergeSameRecorderEventStreams,
  preferLocalMergeConflicts,
} from './cloudConflicts'
import { canonicalGameEventStreamForFingerprint } from './stream'
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

  it('keeps local without review only for the same event or its own unconfirmed upload', () => {
    const base = event()
    expect(canKeepLocalWithoutReview(base, event({ updatedAt: '2026-11-07T17:49:45.11+00:00' }), true)).toBe(true)
    // No confirmed base: the cloud copy is this device's own earlier upload.
    expect(canKeepLocalWithoutReview(event({ revision: 2, payload: { note: 'a' } }), base, false)).toBe(true)
    expect(canKeepLocalWithoutReview(event({ payload: { note: 'a' } }), base, false)).toBe(false)
    expect(canKeepLocalWithoutReview(base, event({ revision: 2, payload: { note: 'b' } }), false)).toBe(false)
  })

  it('reviews divergent edits from a shared base even when this device is further ahead', () => {
    const shared = event()
    const local = event({ revision: 3, payload: { periodId: 'regulation-4', moved: true } })
    const remote = event({ revision: 2, payload: { periodId: 'regulation-4', note: 'corrected' } })
    const merge = mergeSameRecorderEventStreams(stream(local), stream(remote), {
      [shared.id]: { revision: 1, fingerprint: gameEventSyncFingerprint(shared) },
    })
    expect(merge.conflicts).toHaveLength(1)
    expect(merge.conflicts[0].hasBase).toBe(true)
    expect(canKeepLocalWithoutReview(local, remote, true)).toBe(false)
  })

  it('keeps the local event above both revisions for a sole recorder', () => {
    const local = event({ revision: 2, payload: { periodId: 'regulation-4', note: 'local' } })
    const remote = event({ revision: 3, payload: { periodId: 'regulation-4', note: 'remote' } })
    const merge = mergeSameRecorderEventStreams(stream(local), stream(remote), {})
    expect(merge.conflicts).toHaveLength(1)
    const [kept] = preferLocalMergeConflicts(merge, '2026-11-07T18:00:00.000Z').events as GameEvent[]
    expect(kept).toMatchObject({
      revision: 4,
      updatedAt: '2026-11-07T18:00:00.000Z',
      payload: { note: 'local' },
    })
  })
})

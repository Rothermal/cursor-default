import { describe, expect, it } from 'vitest'
import type { GameEventSyncBaseEntry, GameState } from '../../types'
import {
  gameEventSyncBase,
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
  const gameState = (events: GameEvent[], base: Record<string, GameEventSyncBaseEntry> = {}) =>
    ({ eventStream: stream(...events), cloudSync: { eventSyncBase: base } }) as unknown as GameState
  const y1 = event({ id: '20000000-0000-4000-8000-000000000001', sequence: 1 })
  const y2 = event({ ...y1, revision: 2, updatedAt: '2026-11-07T17:55:00.000Z', payload: { periodId: 'regulation-4', note: 'device B' } })
  const x1 = event({ id: '20000000-0000-4000-8000-000000000002', sequence: 2 })
  const x2 = event({ ...x1, revision: 2, updatedAt: '2026-11-07T17:56:00.000Z', payload: { periodId: 'regulation-4', note: 'edited mid-upload' } })
  const z1 = event({ id: '20000000-0000-4000-8000-000000000003', sequence: 3 })

  it('adopts the uploaded copy as base but pulls a cloud edit again after an overlapping upload', () => {
    // Device A syncs Y (base r1) and new X while device B already uploaded Y r2.
    const snapshot = gameState([y1, x1], gameEventSyncBase(stream(y1)))
    const merge = mergeSameRecorderEventStreams(snapshot.eventStream!, stream(y2), snapshot.cloudSync.eventSyncBase!)
    expect(merge.conflicts).toEqual([])
    const synced = gameState(merge.eventStream.events as GameEvent[], gameEventSyncBase(merge.eventStream))
    // During the upload A edits X and records Z, so it keeps its own state.
    const latest = gameState([y1, x2, z1], snapshot.cloudSync.eventSyncBase)
    const base = settledEventSyncBase({
      latestState: latest, snapshotState: snapshot, syncedState: synced,
      localUnchanged: false, recoveryUnchanged: true,
    })
    expect(base[y1.id].revision).toBe(1)
    expect(base[x1.id].revision).toBe(1)

    const next = mergeSameRecorderEventStreams(latest.eventStream!, stream(y2, x1), base)
    expect(next.conflicts).toEqual([])
    const byId = new Map((next.eventStream.events as GameEvent[]).map(item => [item.id, item]))
    expect(byId.get(y1.id)).toMatchObject({ revision: 2, payload: { note: 'device B' } })
    expect(byId.get(x1.id)).toMatchObject({ revision: 2, payload: { note: 'edited mid-upload' } })
  })

  it('keeps the device base when a conflict was resolved mid-upload or no synced state exists', () => {
    const latest = gameState([y1], { [y1.id]: { revision: 2, fingerprint: 'remote' } })
    const synced = gameState([y1], gameEventSyncBase(stream(y1)))
    for (const syncedState of [synced, null]) {
      expect(settledEventSyncBase({
        latestState: latest, snapshotState: synced, syncedState,
        localUnchanged: false, recoveryUnchanged: syncedState === null,
      })).toEqual({ [y1.id]: { revision: 2, fingerprint: 'remote' } })
    }
  })
})

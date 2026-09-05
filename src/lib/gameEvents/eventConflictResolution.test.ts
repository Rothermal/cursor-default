import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GameEventSyncConflict, GameState } from '../../types'
import { sports } from '../../config/sports'
import { createInitialState } from '../gameReducer'
import type { EventCloudTransportAdapter } from './cloudTransport'
import type { GameEvent } from './types'
import {
  eventConflictRecoveryFingerprint,
  resolveEventConflictInState,
} from './eventConflictResolution'

function event(revision: number): GameEvent {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    sportId: 'soccer',
    eventType: 'soccer.test',
    schemaVersion: 1,
    recorderUserId: 'user-1',
    sequence: 0,
    period: { id: 'regulation-1', order: 1 },
    elapsedMs: 1000,
    occurredAt: '2026-09-05T12:00:00.000Z',
    teamSide: 'tracked',
    location: null,
    actors: [],
    payload: {},
    revision,
    createdAt: '2026-09-05T12:00:00.000Z',
    updatedAt: `2026-09-05T12:00:0${revision}.000Z`,
    deletedAt: null,
  }
}

function state(): GameState {
  const initial = createInitialState()
  return {
    ...initial,
    sport: sports.find(item => item.id === 'soccer')!,
    cloudSync: {
      ...initial.cloudSync,
      eventSyncBase: {
        [event(1).id]: { revision: 1, fingerprint: 'base-1' },
      },
    },
  }
}

describe('event conflict recovery fingerprint', () => {
  it('guards both post-await GameContext paths with recovery metadata', () => {
    const context = readFileSync(
      resolve(process.cwd(), 'src/context/GameContext.tsx'),
      'utf8'
    ).replace(/\r\n/g, '\n')

    expect(context).toContain(
      'const snapshotRecoveryFingerprint = eventConflictRecoveryFingerprint(snapshot)'
    )
    expect(
      context.match(
        /eventConflictRecoveryFingerprint\(latestState\) === snapshotRecoveryFingerprint/g
      )
    ).toHaveLength(2)
  })

  it('ignores ordinary sync status but detects conflict recovery changes', () => {
    const source = state()
    const statusOnly: GameState = {
      ...source,
      cloudSync: { ...source.cloudSync, status: 'syncing' },
    }
    expect(eventConflictRecoveryFingerprint(statusOnly)).toBe(
      eventConflictRecoveryFingerprint(source)
    )

    const conflict: GameEventSyncConflict = {
      conflictId: '20000000-0000-4000-8000-000000000001',
      eventId: event(1).id,
      localEvent: event(2),
      remoteEvent: event(3),
      detectedAt: '2026-09-05T12:01:00.000Z',
    }
    const withConflict: GameState = {
      ...source,
      cloudSync: { ...source.cloudSync, eventConflicts: [conflict] },
    }
    expect(eventConflictRecoveryFingerprint(withConflict)).not.toBe(
      eventConflictRecoveryFingerprint(source)
    )

    const withPending: GameState = {
      ...source,
      cloudSync: {
        ...source.cloudSync,
        pendingEventConflictResolutions: [{
          conflictId: conflict.conflictId,
          eventId: conflict.eventId,
          resolution: 'local',
        }],
      },
    }
    expect(eventConflictRecoveryFingerprint(withPending)).not.toBe(
      eventConflictRecoveryFingerprint(source)
    )
  })

  it('replaces an earlier pending choice for the same durable conflict', () => {
    const source = state()
    const conflict: GameEventSyncConflict = {
      conflictId: '20000000-0000-4000-8000-000000000001',
      eventId: event(1).id,
      localEvent: event(2),
      remoteEvent: event(3),
      detectedAt: '2026-09-05T12:01:00.000Z',
    }
    source.eventStream = { version: 1, events: [conflict.localEvent] }
    source.sportGameState = { sportId: 'soccer' } as never
    source.cloudSync.eventConflicts = [conflict]
    source.cloudSync.pendingEventConflictResolutions = [{
      conflictId: conflict.conflictId,
      eventId: conflict.eventId,
      resolution: 'local',
    }]
    const adapter = {
      sportId: 'soccer',
      remoteConflictRevisionPolicy: 'preserve',
      rebuild: (candidate: GameState) => ({
        state: candidate,
        inspection: {
          complete: true,
          activeEvents: [],
          deletedEvents: [],
          diagnostics: [],
        },
      }),
    } as unknown as EventCloudTransportAdapter

    const result = resolveEventConflictInState(
      source,
      conflict.eventId,
      'remote',
      adapter,
      '2026-09-05T12:02:00.000Z'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.cloudSync.pendingEventConflictResolutions).toEqual([{
      conflictId: conflict.conflictId,
      eventId: conflict.eventId,
      resolution: 'remote',
    }])
  })
})

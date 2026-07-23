import { describe, expect, it } from 'vitest'
import type { CloudSyncState } from '../types'
import { createInitialState, gameReducer } from './gameReducer'
import { activeCloudSyncStateAction, mergeCloudSyncState } from './cloudSyncState'

function base(overrides: Partial<CloudSyncState> = {}): CloudSyncState {
  return {
    seasonId: 'season-1',
    teamId: 'team-a',
    gameId: 'game-1',
    gameStatus: 'in_progress',
    playerIdMap: { local1: 'remote1' },
    status: 'synced',
    lastSyncedAt: '2026-07-10T00:00:00.000Z',
    lastError: null,
    lastSyncedGameFingerprint: '{"ok":true}',
    shotChartHydrationDroppedRows: 2,
    ...overrides,
  }
}

describe('mergeCloudSyncState', () => {
  it('hydrates a recovered active payload instead of applying metadata only', () => {
    const current = createInitialState()
    const recovered = {
      ...current,
      notes: 'remote merge adopted',
      cloudSync: {
        ...current.cloudSync,
        status: 'error' as const,
        lastError: 'Review competing event revisions before syncing.',
        eventConflicts: [{ eventId: 'event-1' } as never],
      },
    }

    const action = activeCloudSyncStateAction(
      recovered,
      { status: 'error', lastError: recovered.cloudSync.lastError },
      true
    )
    const next = gameReducer(current, action)

    expect(action.type).toBe('HYDRATE_STATE')
    expect(next.notes).toBe('remote merge adopted')
    expect(next.cloudSync.eventConflicts).toHaveLength(1)
  })

  it('keeps metadata-only updates for sync paths without a recovered payload', () => {
    const current = createInitialState()
    const action = activeCloudSyncStateAction(
      current,
      { status: 'syncing', lastError: null },
      false
    )

    expect(action).toEqual({
      type: 'SET_CLOUD_SYNC_STATE',
      cloudSync: { status: 'syncing', lastError: null },
    })
  })

  it('clears game binding when teamId changes without a new gameId', () => {
    const next = mergeCloudSyncState(base(), {
      teamId: 'team-b',
      seasonId: 'season-2',
    })

    expect(next.teamId).toBe('team-b')
    expect(next.seasonId).toBe('season-2')
    expect(next.gameId).toBeNull()
    expect(next.gameStatus).toBeNull()
    expect(next.playerIdMap).toEqual({})
    expect(next.lastSyncedAt).toBeNull()
    expect(next.lastSyncedGameFingerprint).toBeNull()
    expect(next.shotChartHydrationDroppedRows).toBe(0)
  })

  it('preserves game binding when teamId is unchanged', () => {
    const prev = base()
    const next = mergeCloudSyncState(prev, {
      teamId: 'team-a',
      seasonId: 'season-1',
    })

    expect(next.gameId).toBe('game-1')
    expect(next.playerIdMap).toEqual({ local1: 'remote1' })
    expect(next.lastSyncedGameFingerprint).toBe('{"ok":true}')
  })

  it('allows sync to rebind teamId and gameId in one patch', () => {
    const next = mergeCloudSyncState(base({ teamId: null, gameId: null }), {
      teamId: 'team-a',
      gameId: 'game-new',
      gameStatus: 'in_progress',
      playerIdMap: { p1: 'p1' },
      lastSyncedAt: '2026-07-10T01:00:00.000Z',
      lastSyncedGameFingerprint: '{"synced":true}',
      status: 'synced',
    })

    expect(next.teamId).toBe('team-a')
    expect(next.gameId).toBe('game-new')
    expect(next.playerIdMap).toEqual({ p1: 'p1' })
    expect(next.lastSyncedGameFingerprint).toBe('{"synced":true}')
  })

  it('does not clear when patch omits teamId', () => {
    const next = mergeCloudSyncState(base(), {
      status: 'error',
      lastError: 'network',
    })

    expect(next.gameId).toBe('game-1')
    expect(next.teamId).toBe('team-a')
    expect(next.status).toBe('error')
  })
})

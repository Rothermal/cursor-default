import { describe, expect, it } from 'vitest'
import type { GameState } from '../types'
import {
  buildGameSyncFingerprint,
  currentPeriodForCloudHydrate,
  localSyncedGameIdForHydrate,
  shouldDeferCloudResumeHydration,
  withLastSyncedGameFingerprint,
} from './gameSyncFingerprint'

const sport = {
  id: 'basketball',
  name: 'Basketball',
  icon: '🏀',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: '',
}

function baseState(over: Partial<GameState> = {}): GameState {
  return {
    sport,
    gameInfo: { teamName: 'A', opponentName: 'B', tournamentName: '', tournamentId: null, date: '2026-01-01' },
    players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 2 } }],
    activePlayerId: 'p1',
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: {
      seasonId: 's1',
      teamId: 't1',
      gameId: 'g1',
      gameStatus: 'in_progress',
      playerIdMap: { p1: 'p1' },
      status: 'synced',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
      lastSyncedGameFingerprint: null,
      shotChartHydrationDroppedRows: 0,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    ...over,
  }
}

describe('gameSyncFingerprint', () => {
  it('withLastSyncedGameFingerprint stores canonical fingerprint', () => {
    const s = baseState()
    const next = withLastSyncedGameFingerprint(s)
    expect(next.cloudSync.lastSyncedGameFingerprint).toBe(buildGameSyncFingerprint(s))
  })

  it('shouldDeferCloudResumeHydration when fingerprint differs from last synced', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const edited = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 5 } }],
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldDeferCloudResumeHydration(edited, false)).toBe(true)
  })

  it('does not defer when fingerprint matches last synced', () => {
    const s0 = baseState()
    const fp = buildGameSyncFingerprint(s0)
    const s = baseState({
      cloudSync: { ...s0.cloudSync, lastSyncedGameFingerprint: fp },
    })
    expect(shouldDeferCloudResumeHydration(s, false)).toBe(false)
  })

  it('defers when durable pending flag is set', () => {
    const s = baseState({
      cloudSync: { ...baseState().cloudSync, lastSyncedGameFingerprint: buildGameSyncFingerprint(baseState()) },
    })
    expect(shouldDeferCloudResumeHydration(s, true)).toBe(true)
  })

  it('defers when lastSyncedGameFingerprint is unknown (null)', () => {
    expect(shouldDeferCloudResumeHydration(baseState(), false)).toBe(true)
  })

  it('defers when there is no cloud game id yet', () => {
    const s = baseState({
      cloudSync: { ...baseState().cloudSync, gameId: null, lastSyncedGameFingerprint: 'x' },
    })
    expect(shouldDeferCloudResumeHydration(s, false)).toBe(true)
  })

  it('defers when current period changed since last sync', () => {
    const synced = withLastSyncedGameFingerprint(baseState({ currentPeriod: 1 }))
    const advanced = baseState({
      currentPeriod: 2,
      cloudSync: { ...synced.cloudSync },
    })
    expect(shouldDeferCloudResumeHydration(advanced, false)).toBe(true)
  })

  it('currentPeriodForCloudHydrate preserves period for same game id', () => {
    const local = baseState({ currentPeriod: 3 })
    expect(currentPeriodForCloudHydrate(local, 'g1')).toBe(3)
    expect(currentPeriodForCloudHydrate(local, 'other')).toBe(1)
  })

  it('localSyncedGameIdForHydrate returns game id when fingerprint matches', () => {
    const synced = withLastSyncedGameFingerprint(baseState())
    expect(localSyncedGameIdForHydrate(synced)).toBe('g1')
  })

  it('localSyncedGameIdForHydrate returns null when local edits are unsynced', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const edited = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 9 } }],
      cloudSync: { ...baseState().cloudSync, lastSyncedGameFingerprint: syncedFp },
    })
    expect(localSyncedGameIdForHydrate(edited)).toBeNull()
  })

  it('localSyncedGameIdForHydrate returns null without cloud game id', () => {
    const s = baseState({
      cloudSync: { ...baseState().cloudSync, gameId: null },
    })
    expect(localSyncedGameIdForHydrate(withLastSyncedGameFingerprint(s))).toBeNull()
  })
})

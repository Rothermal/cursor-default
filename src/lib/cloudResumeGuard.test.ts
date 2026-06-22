import { describe, expect, it } from 'vitest'
import type { GameState } from '../types'
import { hasUnsyncedLocalGameChanges } from './cloudResumeGuard'
import { buildGameSyncFingerprint, withLastSyncedGameFingerprint } from './gameSyncFingerprint'

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

describe('hasUnsyncedLocalGameChanges', () => {
  it('is false when local matches last synced fingerprint', () => {
    const s0 = baseState()
    const synced = withLastSyncedGameFingerprint(s0)
    expect(hasUnsyncedLocalGameChanges(synced)).toBe(false)
  })

  it('is true when stats changed after last sync', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const edited = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 5 } }],
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(hasUnsyncedLocalGameChanges(edited)).toBe(true)
  })
})

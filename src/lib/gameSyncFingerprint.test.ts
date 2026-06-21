import { describe, expect, it } from 'vitest'
import { buildSyncFingerprint, hasDirtyLocalSinceSync } from './gameSyncFingerprint'
import type { GameState } from '../types'

function baseState(): GameState {
  return {
    sport: {
      id: 'basketball',
      name: 'Basketball',
      icon: '🏀',
      theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
      categories: [],
      scoreLabel: 'PTS',
    },
    gameInfo: {
      teamName: 'Home',
      opponentName: 'Away',
      tournamentName: '',
      tournamentId: null,
      date: '2026-01-01',
    },
    players: [{ id: 'p1', name: 'Player One', number: '1', stats: { pts: 2 } }],
    activePlayerId: 'p1',
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: {
      seasonId: null,
      teamId: null,
      gameId: 'game-1',
      gameStatus: 'in_progress',
      playerIdMap: {},
      status: 'synced',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
      shotChartHydrationDroppedRows: 0,
      lastSyncedFingerprint: null,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
  }
}

describe('buildSyncFingerprint', () => {
  it('changes when player stats change', () => {
    const before = buildSyncFingerprint(baseState())
    const after = buildSyncFingerprint({
      ...baseState(),
      players: [{ id: 'p1', name: 'Player One', number: '1', stats: { pts: 5 } }],
    })
    expect(before).not.toBe(after)
  })
})

describe('hasDirtyLocalSinceSync', () => {
  it('returns false when no fingerprint is stored', () => {
    expect(hasDirtyLocalSinceSync(baseState())).toBe(false)
  })

  it('returns false when local state matches last synced fingerprint', () => {
    const state = baseState()
    state.cloudSync.lastSyncedFingerprint = buildSyncFingerprint(state)
    expect(hasDirtyLocalSinceSync(state)).toBe(false)
  })

  it('returns true when stats changed after last sync', () => {
    const synced = baseState()
    synced.cloudSync.lastSyncedFingerprint = buildSyncFingerprint(synced)
    const dirty = {
      ...synced,
      players: [{ id: 'p1', name: 'Player One', number: '1', stats: { pts: 9 } }],
    }
    expect(hasDirtyLocalSinceSync(dirty)).toBe(true)
  })
})

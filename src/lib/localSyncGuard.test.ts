import { describe, expect, it } from 'vitest'
import { hasUnsyncedLocalProgress } from './localSyncGuard'
import type { GameState } from '../types'

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    sport: { id: 'basketball' } as GameState['sport'],
    gameInfo: {
      teamName: 'Home',
      opponentName: 'Away',
      tournamentName: '',
      tournamentId: null,
      date: '2026-01-01',
    },
    players: [],
    activePlayerId: null,
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
      lastSyncedAt: '2026-01-01T12:00:00.000Z',
      lastError: null,
      shotChartHydrationDroppedRows: 0,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    ...overrides,
  }
}

describe('hasUnsyncedLocalProgress', () => {
  it('returns true when game has never received a cloud game id', () => {
    const state = baseState({
      cloudSync: { ...baseState().cloudSync, gameId: null },
    })
    expect(hasUnsyncedLocalProgress(state, false)).toBe(true)
  })

  it('returns true when durable pending sync flag is set', () => {
    expect(hasUnsyncedLocalProgress(baseState(), true)).toBe(true)
  })

  it('returns true when action log has entries newer than lastSyncedAt', () => {
    const state = baseState({
      actionLog: [
        {
          id: 'a1',
          timestamp: Date.parse('2026-01-01T12:05:00.000Z'),
          type: 'increment',
          playerId: 'p1',
          statId: '2pt',
          previousValue: 0,
        },
      ],
    })
    expect(hasUnsyncedLocalProgress(state, false)).toBe(true)
  })

  it('returns false when local matches last sync timestamp', () => {
    const state = baseState({
      actionLog: [
        {
          id: 'a1',
          timestamp: Date.parse('2026-01-01T11:59:00.000Z'),
          type: 'increment',
          playerId: 'p1',
          statId: '2pt',
          previousValue: 0,
        },
      ],
    })
    expect(hasUnsyncedLocalProgress(state, false)).toBe(false)
  })
})

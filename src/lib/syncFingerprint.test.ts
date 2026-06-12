import { describe, expect, it } from 'vitest'
import { buildSyncFingerprint } from './syncFingerprint'
import type { GameState } from '../types'

function minimalState(overrides: Partial<GameState> = {}): GameState {
  return {
    sport: null,
    gameInfo: null,
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
      gameId: null,
      gameStatus: null,
      playerIdMap: {},
      status: 'idle',
      lastSyncedAt: null,
      lastSyncedFingerprint: null,
      lastError: null,
      shotChartHydrationDroppedRows: 0,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    ...overrides,
  }
}

describe('buildSyncFingerprint', () => {
  it('changes when player stats change', () => {
    const base = minimalState({
      players: [{ id: 'p1', name: 'A', number: '1', stats: { pts: 1 } }],
    })
    const edited = minimalState({
      players: [{ id: 'p1', name: 'A', number: '1', stats: { pts: 2 } }],
    })
    expect(buildSyncFingerprint(base)).not.toBe(buildSyncFingerprint(edited))
  })

  it('ignores cloudSync metadata', () => {
    const a = minimalState({
      cloudSync: { ...minimalState().cloudSync, gameId: 'g1', lastSyncedFingerprint: 'fp-a' },
    })
    const b = minimalState({
      cloudSync: { ...minimalState().cloudSync, gameId: 'g2', lastSyncedFingerprint: 'fp-b' },
    })
    expect(buildSyncFingerprint(a)).toBe(buildSyncFingerprint(b))
  })
})

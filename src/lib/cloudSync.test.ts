import { describe, expect, it } from 'vitest'
import { shouldDeferShotChartCloudSync } from './cloudSync'
import type { GameState, ShotRecord } from '../types'

const emptyCloudSync = {
  seasonId: null,
  teamId: null,
  gameId: null,
  gameStatus: null,
  playerIdMap: {},
  status: 'idle' as const,
  lastSyncedAt: null,
  lastError: null,
  shotChartHydrationDroppedRows: 0,
}

function minimalGameState(overrides: {
  shotChart?: ShotRecord[]
  shotChartHydrationDroppedRows?: number
}): GameState {
  const { shotChart = [], shotChartHydrationDroppedRows = 0 } = overrides
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
      ...emptyCloudSync,
      shotChartHydrationDroppedRows,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart,
  }
}

const oneShot: ShotRecord[] = [
  {
    id: 'shot-1',
    x: 0,
    y: 0,
    made: true,
    shotType: '2pt',
    zone: 'paint',
    playerId: 'p1',
    timestamp: 0,
  },
]

describe('shouldDeferShotChartCloudSync', () => {
  it('defers when hydration dropped rows and local chart still has shots', () => {
    expect(
      shouldDeferShotChartCloudSync(
        minimalGameState({ shotChartHydrationDroppedRows: 1, shotChart: oneShot })
      )
    ).toBe(true)
  })

  it('does not defer when chart is empty so a clear can delete cloud rows', () => {
    expect(
      shouldDeferShotChartCloudSync(
        minimalGameState({ shotChartHydrationDroppedRows: 3, shotChart: [] })
      )
    ).toBe(false)
  })

  it('does not defer when no rows were dropped during hydration', () => {
    expect(
      shouldDeferShotChartCloudSync(
        minimalGameState({ shotChartHydrationDroppedRows: 0, shotChart: oneShot })
      )
    ).toBe(false)
  })
})

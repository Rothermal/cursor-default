import { describe, it, expect } from 'vitest'
import { clearEntireShotChartInState } from './clearEntireShotChart'
import type { ActionLogEntry, GameState, Player } from '../types'

const emptyCloudSync = (): GameState['cloudSync'] => ({
  seasonId: null,
  teamId: null,
  gameId: null,
  gameStatus: null,
  playerIdMap: {},
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
  shotChartHydrationDroppedRows: 0,
})

function player(id: string, stats: Record<string, number>): Player {
  return { id, name: 'Test', number: '1', stats }
}

function inc(
  id: string,
  playerId: string,
  statId: string,
  previousValue: number,
  shotId?: string
): ActionLogEntry {
  return {
    id,
    timestamp: 1,
    type: 'increment',
    playerId,
    statId,
    previousValue,
    shotId,
  }
}

function dec(id: string, playerId: string, statId: string, previousValue: number): ActionLogEntry {
  return {
    id,
    timestamp: 2,
    type: 'decrement',
    playerId,
    statId,
    previousValue,
  }
}

function baseState(players: Player[], actionLog: ActionLogEntry[], shotChart: GameState['shotChart']): GameState {
  return {
    sport: null,
    gameInfo: null,
    players,
    activePlayerId: players[0]?.id ?? null,
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog,
    cloudSync: emptyCloudSync(),
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart,
  }
}

describe('clearEntireShotChartInState', () => {
  it('subtracts chart counts when log tail does not match last shot (original clear bug)', () => {
    const shot = {
      id: 'shot_a',
      x: 1,
      y: 2,
      made: true,
      shotType: '2pt' as const,
      zone: 'paint' as const,
      playerId: 'p1',
      timestamp: 1,
    }
    const players = [player('p1', { '2pt': 6 })]
    const log: ActionLogEntry[] = [
      inc('1', 'p1', '2pt', 5, 'shot_a'),
      inc('2', 'p1', 'ast', 0),
    ]
    const next = clearEntireShotChartInState(baseState(players, log, [shot]))
    expect(next.shotChart).toEqual([])
    expect(next.players[0].stats['2pt']).toBe(5)
    expect(next.actionLog).toHaveLength(1)
    expect(next.actionLog[0].statId).toBe('ast')
  })

  it('does not double-subtract when the chart basket was already decremented on the tracker', () => {
    const shot = {
      id: 'shot_a',
      x: 1,
      y: 2,
      made: true,
      shotType: '2pt' as const,
      zone: 'paint' as const,
      playerId: 'p1',
      timestamp: 1,
    }
    const players = [player('p1', { '2pt': 5 })]
    const log: ActionLogEntry[] = [inc('1', 'p1', '2pt', 5, 'shot_a'), dec('2', 'p1', '2pt', 6)]
    const next = clearEntireShotChartInState(baseState(players, log, [shot]))
    expect(next.shotChart).toEqual([])
    expect(next.players[0].stats['2pt']).toBe(5)
    expect(next.actionLog).toEqual([dec('2', 'p1', '2pt', 6)])
  })

  it('clears two chart shots in log order (newest increment first)', () => {
    const s1 = {
      id: 'shot_1',
      x: 1,
      y: 2,
      made: true,
      shotType: '2pt' as const,
      zone: 'paint' as const,
      playerId: 'p1',
      timestamp: 1,
    }
    const s2 = {
      id: 'shot_2',
      x: 2,
      y: 2,
      made: true,
      shotType: '2pt' as const,
      zone: 'paint' as const,
      playerId: 'p1',
      timestamp: 2,
    }
    const players = [player('p1', { '2pt': 7 })]
    const log: ActionLogEntry[] = [
      inc('1', 'p1', '2pt', 5, 'shot_1'),
      inc('2', 'p1', '2pt', 6, 'shot_2'),
    ]
    const next = clearEntireShotChartInState(baseState(players, log, [s1, s2]))
    expect(next.players[0].stats['2pt']).toBe(5)
    expect(next.actionLog).toEqual([])
  })
})

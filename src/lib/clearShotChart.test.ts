import { describe, expect, it } from 'vitest'
import type { ActionLogEntry, GameState, ShotRecord } from '../types'
import {
  clearEntireShotChart,
  linkedCourtStatEntryIds,
} from './clearShotChart'

function shot(id: string, playerId = 'p1', made = true): ShotRecord {
  return {
    id,
    playerId,
    x: 0,
    y: 8,
    made,
    shotType: '2pt',
    zone: 'paint',
    timestamp: 1,
  }
}

function logEntry(overrides: Partial<ActionLogEntry>): ActionLogEntry {
  return {
    id: 'log',
    timestamp: 1,
    type: 'increment',
    previousValue: 0,
    ...overrides,
  }
}

function baseState(
  shotChart: ShotRecord[],
  actionLog: ActionLogEntry[],
  playerStats: Record<string, Record<string, number>> = {}
): GameState {
  return {
    sport: null,
    gameInfo: null,
    players: [
      { id: 'p1', name: 'A', number: '1', stats: playerStats.p1 ?? {} },
      { id: 'p2', name: 'B', number: '2', stats: playerStats.p2 ?? {} },
    ],
    activePlayerId: 'p1',
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog,
    cloudSync: {
      seasonId: null,
      teamId: null,
      gameId: null,
      gameStatus: null,
      playerIdMap: {},
      status: 'idle',
      lastSyncedAt: null,
      lastError: null,
      lastSyncedGameFingerprint: null,
      shotChartHydrationDroppedRows: 0,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart,
    eventStream: null,
    sportGameState: null,
  }
}

describe('linkedCourtStatEntryIds', () => {
  it('detects an assist with explicit linkedShotId', () => {
    const ids = linkedCourtStatEntryIds(
      [
        logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt', shotId: 's1' }),
        logEntry({ id: 'ast-log', playerId: 'p2', statId: 'ast', linkedShotId: 's1' }),
      ],
      new Set(['s1'])
    )
    expect([...ids]).toEqual(['ast-log'])
  })

  it('ignores legacy positional assist without linkedShotId', () => {
    const ids = linkedCourtStatEntryIds(
      [
        logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt', shotId: 's1' }),
        logEntry({ id: 'ast-log', playerId: 'p2', statId: 'ast' }),
      ],
      new Set(['s1'])
    )
    expect([...ids]).toEqual([])
  })

  it('detects F9 rebound with linkedShotId', () => {
    const ids = linkedCourtStatEntryIds(
      [
        logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt_miss', shotId: 's1' }),
        logEntry({ id: 'oreb-log', playerId: 'p2', statId: 'oreb', linkedShotId: 's1' }),
      ],
      new Set(['s1'])
    )
    expect([...ids]).toEqual(['oreb-log'])
  })

  it('ignores standalone court/grid stat taps after a shot', () => {
    const ids = linkedCourtStatEntryIds(
      [
        logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt', shotId: 's1' }),
        logEntry({ id: 'oreb', playerId: 'p1', statId: 'oreb' }),
        logEntry({ id: 'ast-log', playerId: 'p2', statId: 'ast' }),
      ],
      new Set(['s1'])
    )
    expect([...ids]).toEqual([])
  })
})

describe('clearEntireShotChart', () => {
  it('reverts linked court-popup assists when clearing chart shots', () => {
    const next = clearEntireShotChart(
      baseState(
        [shot('s1')],
        [
          logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt', shotId: 's1', previousValue: 0 }),
          logEntry({ id: 'ast-log', playerId: 'p2', statId: 'ast', linkedShotId: 's1', previousValue: 1 }),
        ],
        { p1: { '2pt': 1 }, p2: { ast: 2 } }
      )
    )

    expect(next.shotChart).toEqual([])
    expect(next.actionLog).toEqual([])
    expect(next.players.find(p => p.id === 'p1')?.stats['2pt']).toBe(0)
    expect(next.players.find(p => p.id === 'p2')?.stats.ast).toBe(1)
  })

  it('reverts F9 linked rebounds when clearing chart shots', () => {
    const next = clearEntireShotChart(
      baseState(
        [shot('s1', 'p1', false)],
        [
          logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt_miss', shotId: 's1' }),
          logEntry({ id: 'oreb-log', playerId: 'p2', statId: 'oreb', linkedShotId: 's1' }),
        ],
        { p1: { '2pt_miss': 1 }, p2: { oreb: 1 } }
      )
    )

    expect(next.shotChart).toEqual([])
    expect(next.actionLog).toEqual([])
    expect(next.players.find(p => p.id === 'p1')?.stats['2pt_miss']).toBe(0)
    expect(next.players.find(p => p.id === 'p2')?.stats.oreb).toBe(0)
  })

  it('keeps standalone stat taps when clearing chart shots', () => {
    const next = clearEntireShotChart(
      baseState(
        [shot('s1')],
        [
          logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt', shotId: 's1' }),
          logEntry({ id: 'oreb', playerId: 'p1', statId: 'oreb' }),
        ],
        { p1: { '2pt': 1, oreb: 1 } }
      )
    )

    expect(next.actionLog).toHaveLength(1)
    expect(next.players.find(p => p.id === 'p1')?.stats.oreb).toBe(1)
  })

  it('keeps standalone assist after a shot when not linked', () => {
    const next = clearEntireShotChart(
      baseState(
        [shot('s1')],
        [
          logEntry({ id: 'shot-log', playerId: 'p1', statId: '2pt', shotId: 's1' }),
          logEntry({ id: 'ast-log', playerId: 'p2', statId: 'ast' }),
        ],
        { p1: { '2pt': 1 }, p2: { ast: 1 } }
      )
    )

    expect(next.shotChart).toEqual([])
    expect(next.actionLog).toHaveLength(1)
    expect(next.actionLog[0]?.id).toBe('ast-log')
    expect(next.players.find(p => p.id === 'p2')?.stats.ast).toBe(1)
  })
})

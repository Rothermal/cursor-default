import { describe, expect, it } from 'vitest'
import { createInitialState, gameReducer } from './GameContext'
import { sports } from '../config/sports'
import type { ShotRecord } from '../types'

const basketball = sports.find(s => s.id === 'basketball')!

const shot: ShotRecord = {
  id: 'shot-1',
  x: 0,
  y: 0,
  made: true,
  shotType: '2pt',
  zone: 'paint',
  playerId: 'p1',
  timestamp: 0,
}

describe('CLEAR_SHOT_CHART', () => {
  it('resets shotChartHydrationDroppedRows so cloud sync can proceed', () => {
    let state = createInitialState()
    state = gameReducer(state, { type: 'SET_SPORT', sport: basketball })
    state = {
      ...state,
      shotChart: [shot],
      players: [{ id: 'p1', name: 'A', number: '1', stats: { '2pt': 1 } }],
      cloudSync: { ...state.cloudSync, shotChartHydrationDroppedRows: 2 },
    }
    const next = gameReducer(state, { type: 'CLEAR_SHOT_CHART' })
    expect(next.shotChart).toEqual([])
    expect(next.cloudSync.shotChartHydrationDroppedRows).toBe(0)
    expect(next.players[0].stats['2pt']).toBe(0)
  })

  it('no-ops when shot chart already empty', () => {
    const state = {
      ...createInitialState(),
      cloudSync: { ...createInitialState().cloudSync, shotChartHydrationDroppedRows: 3 },
    }
    const next = gameReducer(state, { type: 'CLEAR_SHOT_CHART' })
    expect(next).toBe(state)
    expect(next.cloudSync.shotChartHydrationDroppedRows).toBe(3)
  })
})

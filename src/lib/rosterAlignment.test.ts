import { describe, expect, it } from 'vitest'
import { playerIdMapForRoster, shotChartForRoster } from './rosterAlignment'
import type { Player, ShotRecord } from '../types'

const p = (id: string): Player => ({
  id,
  name: id,
  number: '1',
  stats: {},
})

const shot = (playerId: string, id = 's1'): ShotRecord => ({
  id,
  x: 0,
  y: 0,
  made: true,
  shotType: '2pt',
  zone: 'paint',
  playerId,
  timestamp: 0,
})

describe('playerIdMapForRoster', () => {
  it('drops entries for locals not on the roster', () => {
    const players = [p('uuid-a')]
    const map = {
      'uuid-a': 'uuid-a',
      oldLocal: 'uuid-b',
    }
    expect(playerIdMapForRoster(map, players)).toEqual({ 'uuid-a': 'uuid-a' })
  })
})

describe('shotChartForRoster', () => {
  it('keeps only shots for current roster ids', () => {
    const players = [p('uuid-a')]
    expect(shotChartForRoster([shot('uuid-a'), shot('gone', 's2')], players)).toEqual([shot('uuid-a')])
  })
})

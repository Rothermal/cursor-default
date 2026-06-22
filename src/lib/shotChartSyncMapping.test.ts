import { describe, expect, it } from 'vitest'
import type { ShotRecord } from '../types'
import { hasMappableChartShot } from './shotChartSyncMapping'

const baseShot = (overrides: Partial<ShotRecord>): ShotRecord => ({
  id: 's1',
  x: 1,
  y: 2,
  made: true,
  shotType: '2pt',
  zone: 'paint',
  playerId: 'local-a',
  timestamp: 1,
  ...overrides,
})

describe('hasMappableChartShot', () => {
  it('returns false when chart has shots but no player id maps to a remote id', () => {
    const chart: ShotRecord[] = [baseShot({ playerId: 'orphan' })]
    const map = { other: 'uuid-1' }
    expect(hasMappableChartShot(chart, map)).toBe(false)
  })

  it('returns true when at least one shot maps', () => {
    const chart: ShotRecord[] = [baseShot({ playerId: 'orphan' }), baseShot({ id: 's2', playerId: 'ok' })]
    const map = { ok: 'uuid-1' }
    expect(hasMappableChartShot(chart, map)).toBe(true)
  })

  it('returns false for empty chart', () => {
    expect(hasMappableChartShot([], { a: 'b' })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  classifyShotZone,
  orientBasketballCourtPoint,
  zoneForForcedShotType,
} from './courtGeometry'

describe('zoneForForcedShotType', () => {
  it('forces any selected 3PT shot into the three zone', () => {
    expect(zoneForForcedShotType(0, 2, '3pt')).toBe('three')
    expect(zoneForForcedShotType(0, 12, '3pt')).toBe('three')
  })

  it('forces an outside-arc 2PT shot into mid range', () => {
    expect(classifyShotZone(0, 25)).toBe('three')
    expect(zoneForForcedShotType(0, 25, '2pt')).toBe('mid_range')
  })

  it('keeps the location zone for selected 2PT shots inside the arc', () => {
    expect(zoneForForcedShotType(0, 2, '2pt')).toBe('restricted')
    expect(zoneForForcedShotType(0, 8, '2pt')).toBe('paint')
    expect(zoneForForcedShotType(10, 10, '2pt')).toBe('mid_range')
  })

  it('matches normal classification when the selected value matches the location', () => {
    expect(zoneForForcedShotType(0, 8, '2pt')).toBe(classifyShotZone(0, 8))
    expect(zoneForForcedShotType(0, 25, '3pt')).toBe(classifyShotZone(0, 25))
  })
})

describe('orientBasketballCourtPoint', () => {
  it('round-trips canonical locations through the flipped presentation', () => {
    const canonical = { x: 8.5, y: 12.3 }
    const flipped = orientBasketballCourtPoint(canonical, 'flipped')

    expect(flipped).not.toEqual(canonical)
    expect(orientBasketballCourtPoint(flipped, 'flipped')).toEqual(canonical)
    expect(orientBasketballCourtPoint(canonical, 'standard')).toEqual(canonical)
  })
})

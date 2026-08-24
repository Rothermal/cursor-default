import { describe, expect, it } from 'vitest'
import {
  classifyShotZone,
  CORNER_THREE_ARC_Y,
  CORNER_THREE_X,
  courtFeetToNormalizedLocation,
  isThreePointer,
  normalizedCourtLocationToFeet,
  THREE_POINT_RADIUS,
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

describe('corner and arc three-point boundaries', () => {
  it('treats the corner vertical and arc join as three pointers', () => {
    expect(isThreePointer(CORNER_THREE_X, 0)).toBe(true)
    expect(isThreePointer(-CORNER_THREE_X, CORNER_THREE_ARC_Y)).toBe(true)
    expect(classifyShotZone(CORNER_THREE_X, 0)).toBe('three')
  })

  it('keeps just-inside corner and arc locations as two pointers', () => {
    expect(isThreePointer(CORNER_THREE_X - 0.1, 0)).toBe(false)
    expect(classifyShotZone(CORNER_THREE_X - 0.1, 0)).toBe('mid_range')
    expect(isThreePointer(0, THREE_POINT_RADIUS)).toBe(false)
    expect(isThreePointer(0, THREE_POINT_RADIUS + 0.01)).toBe(true)
    expect(classifyShotZone(0, THREE_POINT_RADIUS + 0.01)).toBe('three')
  })
})

describe('court feet and normalized location conversion', () => {
  it('round-trips the rim center and a mid-court point', () => {
    const rim = { x: 0, y: 0 }
    const mid = { x: 10, y: 20 }
    const rimAgain = normalizedCourtLocationToFeet(courtFeetToNormalizedLocation(rim))
    const midAgain = normalizedCourtLocationToFeet(courtFeetToNormalizedLocation(mid))
    expect(rimAgain.x).toBeCloseTo(rim.x)
    expect(rimAgain.y).toBeCloseTo(rim.y)
    expect(midAgain.x).toBeCloseTo(mid.x)
    expect(midAgain.y).toBeCloseTo(mid.y)
  })

  it('clamps out-of-bounds feet into the canonical unit square', () => {
    expect(courtFeetToNormalizedLocation({ x: -40, y: -20 })).toEqual({ x: 0, y: 0 })
    expect(courtFeetToNormalizedLocation({ x: 40, y: 80 })).toEqual({ x: 1, y: 1 })
  })
})

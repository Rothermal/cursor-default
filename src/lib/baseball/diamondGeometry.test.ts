import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BaseballDiamond from '../../components/baseball/BaseballDiamond'
import BaseballPitchPad from '../../components/baseball/BaseballPitchPad'
import {
  BASEBALL_BASE_POINTS,
  BASEBALL_FENCE,
  BASEBALL_FIELDER_SPOTS,
  BASEBALL_HOME_PLATE,
  BASEBALL_RUBBER,
  baseballDiamondLocation,
  baseballFieldArea,
  baseballPitchPadDisplay,
  baseballPitchPadLocation,
  isBaseballFair,
  isBaseballPitchInZone,
} from './diamondGeometry'
import { baseballDiamondView } from './trackerView'
import { baseballSportState } from './commands'
import { startedGame } from './testFixtures'

const inside = (point: { x: number; y: number }) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1

describe('Baseball diamond geometry', () => {
  it('puts home at the documented point and the bases a square apart', () => {
    expect(BASEBALL_HOME_PLATE).toEqual({ x: 0.5, y: 0.95 })
    const side = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    const { first, second, third } = BASEBALL_BASE_POINTS
    for (const length of [side(BASEBALL_HOME_PLATE, first), side(first, second), side(second, third), side(third, BASEBALL_HOME_PLATE)]) {
      expect(length).toBeCloseTo(0.2, 9)
    }
    expect(second.x).toBe(0.5)
    expect(BASEBALL_RUBBER.y).toBeGreaterThan(second.y)
    expect(BASEBALL_RUBBER.y).toBeLessThan(BASEBALL_HOME_PLATE.y)
  })

  it('keeps every base, fence point and fielder spot inside the frame', () => {
    const points = [
      ...Object.values(BASEBALL_BASE_POINTS),
      ...Object.values(BASEBALL_FENCE),
      ...Object.values(BASEBALL_FIELDER_SPOTS),
    ]
    for (const point of points) expect(inside(point)).toBe(true)
    expect(Object.keys(BASEBALL_FIELDER_SPOTS).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('places every fielder except the catcher in fair territory', () => {
    for (const [position, spot] of Object.entries(BASEBALL_FIELDER_SPOTS)) {
      if (position === '2') expect(isBaseballFair(spot)).toBe(false)
      else expect(isBaseballFair(spot)).toBe(true)
    }
    expect(baseballFieldArea(BASEBALL_FIELDER_SPOTS[6])).toBe('infield')
    expect(baseballFieldArea(BASEBALL_FIELDER_SPOTS[8])).toBe('outfield')
  })

  it('stores diamond taps unflipped with an unknown direction', () => {
    expect(baseballDiamondLocation(0.25, 0.4)).toEqual({ x: 0.25, y: 0.4, attackingDirection: 'unknown' })
    expect(baseballDiamondLocation(-0.2, 1.3)).toEqual({ x: 0, y: 1, attackingDirection: 'unknown' })
    expect(baseballDiamondLocation(1 / 3, 2 / 3)).toEqual({ x: 0.333, y: 0.667, attackingDirection: 'unknown' })
  })

  it('reads fair, foul, infield and outfield at read time', () => {
    expect(baseballFieldArea({ x: 0.5, y: 0.8 })).toBe('infield')
    expect(baseballFieldArea(BASEBALL_BASE_POINTS.first)).toBe('infield')
    expect(baseballFieldArea({ x: 0.5, y: 0.2 })).toBe('outfield')
    expect(baseballFieldArea({ x: 0.1, y: 0.9 })).toBe('foul')
    expect(baseballFieldArea({ x: 0.5, y: 0.98 })).toBe('foul')
    // A ball exactly on the line is fair.
    expect(isBaseballFair({ x: 0.3, y: 0.75 })).toBe(true)
  })

  it('maps pitch pad taps to the engine frame and back', () => {
    expect(baseballPitchPadLocation(0, 0)).toEqual({ x: -0.75, y: -0.75 })
    expect(baseballPitchPadLocation(1, 1)).toEqual({ x: 1.75, y: 1.75 })
    expect(baseballPitchPadLocation(0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 })
    expect(baseballPitchPadLocation(2, -1)).toEqual({ x: 1.75, y: -0.75 })
    const display = baseballPitchPadDisplay({ x: 0.5, y: 0.5 })
    expect(display.x).toBeCloseTo(0.5)
    expect(isBaseballPitchInZone({ x: 0.5, y: 0.5 })).toBe(true)
    expect(isBaseballPitchInZone({ x: -0.1, y: 0.5 })).toBe(false)
  })
})

describe('Baseball diamond and pitch pad render', () => {
  it('labels runners, fielders and the batter without making them tappable while idle', () => {
    const sport = baseballSportState(startedGame())!
    const markup = renderToStaticMarkup(createElement(BaseballDiamond, {
      view: baseballDiamondView(sport),
      battingLabel: 'Visitors',
      fieldingLabel: 'Aces',
    }))
    expect(markup).toContain('Visitors batting: Batter 1, 1st in the order.')
    expect(markup).toContain('First base: empty.')
    expect(markup).toContain('aria-label="Aces fielder 6, #6 Player 6"')
    expect(markup).not.toContain('role="button"')
    expect(markup).not.toContain('Location unknown')
  })

  it('becomes tappable during play entry and always offers Location unknown', () => {
    const sport = baseballSportState(startedGame())!
    const markup = renderToStaticMarkup(createElement(BaseballDiamond, {
      view: baseballDiamondView(sport),
      battingLabel: 'Visitors',
      fieldingLabel: 'Aces',
      onFielder: () => undefined,
      onLocation: () => undefined,
      onLocationUnknown: () => undefined,
    }))
    expect(markup).toContain('role="button"')
    expect(markup).toContain('Location unknown')
  })

  it('hides the zone when pitch location is off and disables results until capture exists', () => {
    const withZone = renderToStaticMarkup(createElement(BaseballPitchPad, {
      showZone: true, pendingLocation: null, onLocation: () => undefined, disabledReason: 'Not yet.',
    }))
    expect(withZone).toContain('Strike zone, catcher view')
    expect(withZone).toContain('Not yet.')
    expect(withZone).toMatch(/<button[^>]*disabled=""[^>]*>Ball<\/button>/)
    const withoutZone = renderToStaticMarkup(createElement(BaseballPitchPad, {
      showZone: false, pendingLocation: null, onLocation: () => undefined, onResult: () => undefined,
    }))
    expect(withoutZone).not.toContain('Strike zone')
    expect(withoutZone).not.toMatch(/disabled=""[^>]*>Ball</)
  })
})

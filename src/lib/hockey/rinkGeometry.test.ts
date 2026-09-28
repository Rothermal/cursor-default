import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import HockeyRink from '../../components/hockey/HockeyRink'
import {
  HOCKEY_FACEOFF_DOT_IDS,
  HOCKEY_FACEOFF_DOTS,
  HOCKEY_RINK_LINES,
  hockeyRinkLocation,
  hockeyZone,
  nearestHockeyFaceoffDot,
} from './rinkGeometry'

describe('hockey rink geometry', () => {
  it('normalizes the 200 x 85 ft reference lines', () => {
    expect(HOCKEY_RINK_LINES).toEqual({
      leftGoalLine: 0.055,
      rightGoalLine: 0.945,
      leftBlueLine: 0.375,
      rightBlueLine: 0.625,
      centerLine: 0.5,
    })
  })

  it('places the nine faceoff dots at their reference distances', () => {
    expect(HOCKEY_FACEOFF_DOT_IDS).toHaveLength(9)
    const feet = (id: typeof HOCKEY_FACEOFF_DOT_IDS[number]) => ({
      x: +(HOCKEY_FACEOFF_DOTS[id].x * 200).toFixed(6),
      y: +(HOCKEY_FACEOFF_DOTS[id].y * 85).toFixed(6),
    })
    expect(feet('center')).toEqual({ x: 100, y: 42.5 })
    // 20 ft out from the goal line, 22 ft either side of the long axis.
    expect(feet('left_end_upper')).toEqual({ x: 31, y: 20.5 })
    expect(feet('left_end_lower')).toEqual({ x: 31, y: 64.5 })
    expect(feet('right_end_upper')).toEqual({ x: 169, y: 20.5 })
    expect(feet('right_end_lower')).toEqual({ x: 169, y: 64.5 })
    // 5 ft into the neutral zone from each blue line.
    expect(feet('left_neutral_upper')).toEqual({ x: 80, y: 20.5 })
    expect(feet('left_neutral_lower')).toEqual({ x: 80, y: 64.5 })
    expect(feet('right_neutral_upper')).toEqual({ x: 120, y: 20.5 })
    expect(feet('right_neutral_lower')).toEqual({ x: 120, y: 64.5 })
  })

  it('snaps taps from every quadrant to the nearest dot with its exact point', () => {
    const cases: [number, number, string][] = [
      [0.1, 0.1, 'left_end_upper'],
      [0.1, 0.9, 'left_end_lower'],
      [0.9, 0.1, 'right_end_upper'],
      [0.9, 0.9, 'right_end_lower'],
      [0.42, 0.2, 'left_neutral_upper'],
      [0.42, 0.8, 'left_neutral_lower'],
      [0.58, 0.2, 'right_neutral_upper'],
      [0.58, 0.8, 'right_neutral_lower'],
      [0.51, 0.52, 'center'],
    ]
    for (const [x, y, id] of cases) {
      const snapped = nearestHockeyFaceoffDot({ x, y })
      expect(snapped.id).toBe(id)
      expect(snapped.point).toEqual(HOCKEY_FACEOFF_DOTS[snapped.id])
    }
  })

  it('measures snapping distance in feet, not normalized units', () => {
    // 0.03 across is 2.55 ft; 0.03 along is 6 ft. The across-axis dot is nearer.
    const between = { x: HOCKEY_FACEOFF_DOTS.left_end_upper.x + 0.03, y: HOCKEY_FACEOFF_DOTS.left_end_upper.y + 0.03 }
    expect(nearestHockeyFaceoffDot(between).id).toBe('left_end_upper')
    // Discriminating point: 884 sq ft to the neutral dot vs 1,600 to center, while
    // unscaled normalized distance would pick center.
    expect(nearestHockeyFaceoffDot({ x: 0.3, y: 0.5 }).id).toBe('left_neutral_upper')
  })

  it('breaks exact ties toward the earlier dot id', () => {
    const upper = HOCKEY_FACEOFF_DOTS.left_end_upper
    const midpoint = { x: upper.x, y: 0.5 }
    expect(nearestHockeyFaceoffDot(midpoint).id).toBe('left_end_upper')
    const rightMid = { x: HOCKEY_FACEOFF_DOTS.right_end_upper.x, y: 0.5 }
    expect(nearestHockeyFaceoffDot(rightMid).id).toBe('right_end_upper')
  })

  it('derives zones for both sides and both directions', () => {
    const left = { x: 0.2, y: 0.5 }
    const middle = { x: 0.5, y: 0.5 }
    const right = { x: 0.8, y: 0.5 }
    expect(hockeyZone(right, 'tracked', 'left_to_right')).toBe('offensive')
    expect(hockeyZone(left, 'tracked', 'left_to_right')).toBe('defensive')
    expect(hockeyZone(right, 'opponent', 'left_to_right')).toBe('defensive')
    expect(hockeyZone(left, 'opponent', 'left_to_right')).toBe('offensive')
    expect(hockeyZone(right, 'tracked', 'right_to_left')).toBe('defensive')
    expect(hockeyZone(left, 'tracked', 'right_to_left')).toBe('offensive')
    expect(hockeyZone(left, 'opponent', 'right_to_left')).toBe('defensive')
    for (const side of ['tracked', 'opponent'] as const) {
      expect(hockeyZone(middle, side, 'left_to_right')).toBe('neutral')
      expect(hockeyZone({ x: 0.375, y: 0.1 }, side, 'left_to_right')).toBe('neutral')
      expect(hockeyZone({ x: 0.625, y: 0.9 }, side, 'right_to_left')).toBe('neutral')
    }
  })

  it('round-trips display and canonical coordinates with the flip on and off', () => {
    const plain = hockeyRinkLocation(0.84, 0.24, false, 'left_to_right')
    expect(plain).toEqual({ x: 0.84, y: 0.24, attackingDirection: 'left_to_right' })
    const flipped = hockeyRinkLocation(0.16, 0.76, true, 'left_to_right')
    expect(flipped.x).toBeCloseTo(0.84)
    expect(flipped.y).toBeCloseTo(0.24)
    expect(nearestHockeyFaceoffDot(flipped).id).toBe(nearestHockeyFaceoffDot(plain).id)
    expect(hockeyRinkLocation(-1, 2, false, 'right_to_left')).toEqual({ x: 0, y: 1, attackingDirection: 'right_to_left' })
  })
})

describe('HockeyRink component', () => {
  const render = (overrides: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(HockeyRink, {
    trackedDirection: 'left_to_right',
    flipped: false,
    trapezoid: false,
    onFlip: () => {},
    onLocation: () => {},
    ...overrides,
  }))

  it('draws all nine faceoff dots on a horizontal rink', () => {
    const html = render()
    expect(html).toContain('viewBox="0 0 200 85"')
    expect(html.match(/data-faceoff-dot=/g)).toHaveLength(9)
    expect(html).toContain('Tracked attack')
    expect(html).not.toContain('rotate-180')
  })

  it('draws the trapezoid only when the rules call for it', () => {
    expect(render().match(/stroke-width="0.4"/g)?.length)
      .toBeLessThan(render({ trapezoid: true }).match(/stroke-width="0.4"/g)?.length ?? 0)
  })

  it('rotates only the view when flipped and labels markers', () => {
    const html = render({
      flipped: true,
      markers: [{ id: 'm1', x: 0.9, y: 0.5, teamSide: 'opponent', kind: 'goal', label: 'Opponent goal' }],
      onMarker: () => {},
    })
    expect(html).toContain('rotate-180')
    expect(html).toContain('aria-label="Opponent goal"')
    expect(html).toContain('role="button"')
  })

  it('makes each faceoff dot a keyboard tap target only when asked and capture is enabled', () => {
    expect(render()).not.toContain('data-faceoff-target')
    const html = render({ onFaceoffDot: () => {} })
    expect(html.match(/data-faceoff-target=/g)).toHaveLength(9)
    expect(html).toContain('aria-label="Faceoff at the left end upper dot"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(9)
    expect(render({ onFaceoffDot: () => {}, disabled: true })).not.toContain('data-faceoff-target')
  })
})

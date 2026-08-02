import type { ShotZone } from '../../types'
import type { GameEventLocation } from '../gameEvents/types'

export const COURT_WIDTH = 50
export const HALF_COURT_DEPTH = 47

const NBA_BASELINE_TO_RIM_FT = 5.25
const NBA_BACKBOARD_FROM_BASELINE_FT = 4

export const BASKET_CENTER_Y = NBA_BASELINE_TO_RIM_FT / 2
export const BASELINE_Y = -BASKET_CENTER_Y
export const HALFCOURT_Y = HALF_COURT_DEPTH - BASKET_CENTER_Y
export const BACKBOARD_Y =
  -BASKET_CENTER_Y +
  (NBA_BACKBOARD_FROM_BASELINE_FT / NBA_BASELINE_TO_RIM_FT) * BASKET_CENTER_Y
export const BACKBOARD_WIDTH = 6
export const BASKET_RADIUS = 0.75
export const PAINT_WIDTH = 16
const PAINT_DEPTH_FROM_BASELINE = 19
export const FT_LINE_Y = PAINT_DEPTH_FROM_BASELINE - BASKET_CENTER_Y
export const FT_CIRCLE_RADIUS = 6
const RESTRICTED_RADIUS = 4
export const THREE_POINT_RADIUS = 23.75
export const CORNER_THREE_X = 22
export const CORNER_THREE_ARC_Y = Math.sqrt(
  THREE_POINT_RADIUS * THREE_POINT_RADIUS - CORNER_THREE_X * CORNER_THREE_X
)
export const LANE_MARKS_FROM_BASELINE = [7, 8, 11, 14]

export interface BasketballCourtPoint {
  x: number
  y: number
}

export function isThreePointer(x: number, y: number): boolean {
  if (Math.abs(x) >= CORNER_THREE_X && y <= CORNER_THREE_ARC_Y) return true
  return Math.sqrt(x * x + y * y) > THREE_POINT_RADIUS
}

export function classifyShotZone(x: number, y: number): ShotZone {
  const distance = Math.sqrt(x * x + y * y)
  if (distance <= RESTRICTED_RADIUS) return 'restricted'
  if (Math.abs(x) <= PAINT_WIDTH / 2 && y <= FT_LINE_Y) return 'paint'
  if (isThreePointer(x, y)) return 'three'
  return 'mid_range'
}

export function zoneForForcedShotType(
  x: number,
  y: number,
  shotType: '2pt' | '3pt'
): ShotZone {
  if (shotType === '3pt') return 'three'
  const zone = classifyShotZone(x, y)
  return zone === 'three' ? 'mid_range' : zone
}

/** Convert canonical 0..1 event coordinates into the existing rim-centered court feet. */
export function normalizedCourtLocationToFeet(
  location: Pick<GameEventLocation, 'x' | 'y'>
): BasketballCourtPoint {
  return {
    x: (location.x - 0.5) * COURT_WIDTH,
    y: BASELINE_Y + location.y * HALF_COURT_DEPTH,
  }
}

/** Convert current court taps into canonical event coordinates for the BKE-1C command layer. */
export function courtFeetToNormalizedLocation(
  point: BasketballCourtPoint
): Pick<GameEventLocation, 'x' | 'y'> {
  return {
    x: clamp((point.x + COURT_WIDTH / 2) / COURT_WIDTH),
    y: clamp((point.y - BASELINE_Y) / HALF_COURT_DEPTH),
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

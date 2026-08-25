import type { ShotZone } from '../../types'
import type { GameEventLocation } from '../gameEvents/types'

export const COURT_WIDTH = 50
export const HALF_COURT_DEPTH = 47

// NBA: rim 5.25' from baseline, backboard face 4' from baseline. For the diagram we use
// half that rim offset so the basket sits halfway between the old position and the
// baseline; the backboard interpolates on the same segment so it stays between
// baseline and rim.
const NBA_BASELINE_TO_RIM_FT = 5.25
const NBA_BACKBOARD_FROM_BASELINE_FT = 4

// Court coordinates: origin (0,0) = center of the rim; +y runs toward half-court;
// baseline is behind the hoop (negative y).
export const BASKET_CENTER_Y = NBA_BASELINE_TO_RIM_FT / 2
export const BASELINE_Y = -BASKET_CENTER_Y
export const HALFCOURT_Y = HALF_COURT_DEPTH - BASKET_CENTER_Y

// Backboard: 4' from baseline in NBA; scale along the shortened baseline-to-rim segment.
export const BACKBOARD_Y =
  -BASKET_CENTER_Y +
  (NBA_BACKBOARD_FROM_BASELINE_FT / NBA_BASELINE_TO_RIM_FT) * BASKET_CENTER_Y
export const BACKBOARD_WIDTH = 6
export const BASKET_RADIUS = 0.75

// Paint / lane: 16' wide (NBA), 19' deep from baseline to free-throw line.
export const PAINT_WIDTH = 16
const PAINT_DEPTH_FROM_BASELINE = 19
export const FT_LINE_Y = PAINT_DEPTH_FROM_BASELINE - BASKET_CENTER_Y
export const FT_CIRCLE_RADIUS = 6
const RESTRICTED_RADIUS = 4
export const THREE_POINT_RADIUS = 23.75
export const CORNER_THREE_X = 22
/** y (feet from hoop) where the corner vertical meets the 3pt arc. */
export const CORNER_THREE_ARC_Y = Math.sqrt(
  THREE_POINT_RADIUS * THREE_POINT_RADIUS - CORNER_THREE_X * CORNER_THREE_X
)
export const LANE_MARKS_FROM_BASELINE = [7, 8, 11, 14]

export interface BasketballCourtPoint {
  x: number
  y: number
}

export function orientBasketballCourtPoint(
  point: BasketballCourtPoint,
  orientation: 'standard' | 'flipped'
): BasketballCourtPoint {
  if (orientation === 'standard') return { ...point }
  const centerY = (BASELINE_Y + HALFCOURT_Y) / 2
  return {
    x: -point.x,
    y: Math.round((2 * centerY - point.y) * 10) / 10,
  }
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

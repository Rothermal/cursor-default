import type { ShotZone } from '../../types'

// Overall half-court dimensions (feet)
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

// Backboard: 4' from baseline in NBA; scale along the shortened baseline→rim segment.
export const BACKBOARD_Y =
  -BASKET_CENTER_Y +
  (NBA_BACKBOARD_FROM_BASELINE_FT / NBA_BASELINE_TO_RIM_FT) * BASKET_CENTER_Y
export const BACKBOARD_WIDTH = 6

export const BASKET_RADIUS = 0.75

// Paint / lane: 16' wide (NBA), 19' deep from baseline to free-throw line
export const PAINT_WIDTH = 16
export const PAINT_DEPTH_FROM_BASELINE = 19
export const FT_LINE_Y = PAINT_DEPTH_FROM_BASELINE - BASKET_CENTER_Y

export const FT_CIRCLE_RADIUS = 6

export const RESTRICTED_RADIUS = 4

export const THREE_POINT_RADIUS = 23.75
export const CORNER_THREE_X = 22
/** y (feet from hoop) where the corner vertical meets the 3pt arc */
export const CORNER_THREE_ARC_Y = Math.sqrt(
  THREE_POINT_RADIUS * THREE_POINT_RADIUS - CORNER_THREE_X * CORNER_THREE_X
)

export const LANE_MARKS_FROM_BASELINE = [7, 8, 11, 14]

export function isThreePointer(x: number, y: number): boolean {
  if (Math.abs(x) >= CORNER_THREE_X && y <= CORNER_THREE_ARC_Y) {
    return true
  }
  const distFromBasket = Math.sqrt(x * x + y * y)
  return distFromBasket > THREE_POINT_RADIUS
}

export function classifyShotZone(x: number, y: number): ShotZone {
  const dist = Math.sqrt(x * x + y * y)
  if (dist <= RESTRICTED_RADIUS) return 'restricted'
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

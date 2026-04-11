import type { ShotZone } from '../../types'

// Overall half-court dimensions (feet)
export const COURT_WIDTH = 50
export const HALF_COURT_DEPTH = 47

// Basket center is 5.25' from baseline (4' backboard offset + 1.25' to rim center).
// All SVG coordinates are basket-centered: origin (0,0) = center of the rim.
export const BASKET_CENTER_Y = 5.25
export const BASELINE_Y = -BASKET_CENTER_Y                         // -5.25
export const HALFCOURT_Y = HALF_COURT_DEPTH - BASKET_CENTER_Y      // 41.75

// Backboard: face is 4' from baseline → 1.25' behind basket center
export const BACKBOARD_Y = -(BASKET_CENTER_Y - 4)                  // -1.25
export const BACKBOARD_WIDTH = 6                                    // 72" = 6'

// Basket (rim)
export const BASKET_RADIUS = 0.75                                   // 18" diameter

// Paint / lane: 16' wide (NBA), 19' deep from baseline to free-throw line
export const PAINT_WIDTH = 16
export const PAINT_DEPTH_FROM_BASELINE = 19
export const FT_LINE_Y = PAINT_DEPTH_FROM_BASELINE - BASKET_CENTER_Y  // 13.75

// Free-throw circle: 6' radius, centered on the FT line
export const FT_CIRCLE_RADIUS = 6

// Restricted area: 4' radius arc from basket center
export const RESTRICTED_RADIUS = 4

// Three-point line
export const THREE_POINT_RADIUS = 23.75                             // 23'9"
export const CORNER_THREE_X = 22                                    // 3' from sideline

// Lane hash marks (rebounding/block positions) — distances from baseline
export const LANE_MARKS_FROM_BASELINE = [7, 8, 11, 14]

export function isThreePointer(x: number, y: number): boolean {
  // Corner three: beyond the straight vertical at x = ±22
  if (Math.abs(x) >= CORNER_THREE_X) return true
  // Arc three: beyond the 23.75' arc
  return Math.sqrt(x * x + y * y) > THREE_POINT_RADIUS
}

export function classifyShotZone(x: number, y: number): ShotZone {
  const dist = Math.sqrt(x * x + y * y)
  if (dist <= RESTRICTED_RADIUS) return 'restricted'
  if (Math.abs(x) <= PAINT_WIDTH / 2 && y <= FT_LINE_Y) return 'paint'
  if (isThreePointer(x, y)) return 'three'
  return 'mid_range'
}

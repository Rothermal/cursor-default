import type { ShotZone } from '../../types'

export const COURT_WIDTH = 50
export const HALF_COURT_DEPTH = 47
export const THREE_POINT_RADIUS = 23.75
export const CORNER_THREE_X = 22
export const CORNER_THREE_Y = 14
export const RESTRICTED_RADIUS = 4
export const PAINT_WIDTH = 12
export const PAINT_DEPTH = 19
export const FT_LINE_Y = 19
export const FT_CIRCLE_RADIUS = 6
export const BASKET_RADIUS = 0.75
export const BACKBOARD_WIDTH = 6

export function isThreePointer(x: number, y: number): boolean {
  if (Math.abs(x) >= CORNER_THREE_X && y <= CORNER_THREE_Y) {
    return true
  }
  const distFromBasket = Math.sqrt(x * x + y * y)
  return distFromBasket > THREE_POINT_RADIUS
}

export function classifyShotZone(x: number, y: number): ShotZone {
  const dist = Math.sqrt(x * x + y * y)
  if (dist <= RESTRICTED_RADIUS) return 'restricted'
  if (Math.abs(x) <= PAINT_WIDTH / 2 && y <= PAINT_DEPTH) return 'paint'
  if (isThreePointer(x, y)) return 'three'
  return 'mid_range'
}

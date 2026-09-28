import type { GameEventLocation } from '../gameEvents/types'
import { surfaceLocation } from '../surface/location'
import type { HockeyAttackingDirection } from './types'

/**
 * Rink geometry normalized from a 200 x 85 ft reference rink (HKY-0 §4).
 * Canonical coordinates put x along the long axis (0 = left end boards) and
 * y across it (0 = upper boards). A flipped view never changes them.
 */
export const HOCKEY_RINK_LENGTH_FT = 200
export const HOCKEY_RINK_WIDTH_FT = 85
export const HOCKEY_RINK_CORNER_RADIUS_FT = 28
export const HOCKEY_FACEOFF_CIRCLE_RADIUS_FT = 15
export const HOCKEY_CREASE_RADIUS_FT = 6
export const HOCKEY_NET_WIDTH_FT = 6
export const HOCKEY_NET_DEPTH_FT = 40 / 12
/** Trapezoid widths at the goal line and at the end boards. */
export const HOCKEY_TRAPEZOID_GOAL_LINE_WIDTH_FT = 18
export const HOCKEY_TRAPEZOID_BOARDS_WIDTH_FT = 28

const GOAL_LINE_FT = 11
const BLUE_LINE_FT = 75
const END_DOT_FROM_GOAL_LINE_FT = 20
const NEUTRAL_DOT_FROM_BLUE_LINE_FT = 5
const DOT_OFFSET_FROM_AXIS_FT = 22

export const HOCKEY_RINK_LINES = {
  leftGoalLine: GOAL_LINE_FT / HOCKEY_RINK_LENGTH_FT,
  rightGoalLine: 1 - GOAL_LINE_FT / HOCKEY_RINK_LENGTH_FT,
  leftBlueLine: BLUE_LINE_FT / HOCKEY_RINK_LENGTH_FT,
  rightBlueLine: 1 - BLUE_LINE_FT / HOCKEY_RINK_LENGTH_FT,
  centerLine: 0.5,
} as const

/** Stable ids in the canonical frame; ties in snapping go to the earlier id. */
export const HOCKEY_FACEOFF_DOT_IDS = [
  'center',
  'left_end_upper',
  'left_end_lower',
  'left_neutral_upper',
  'left_neutral_lower',
  'right_neutral_upper',
  'right_neutral_lower',
  'right_end_upper',
  'right_end_lower',
] as const

export type HockeyFaceoffDotId = typeof HOCKEY_FACEOFF_DOT_IDS[number]

export interface HockeyRinkPoint {
  x: number
  y: number
}

const END_DOT_X = (GOAL_LINE_FT + END_DOT_FROM_GOAL_LINE_FT) / HOCKEY_RINK_LENGTH_FT
const NEUTRAL_DOT_X = (BLUE_LINE_FT + NEUTRAL_DOT_FROM_BLUE_LINE_FT) / HOCKEY_RINK_LENGTH_FT
const UPPER_DOT_Y = (HOCKEY_RINK_WIDTH_FT / 2 - DOT_OFFSET_FROM_AXIS_FT) / HOCKEY_RINK_WIDTH_FT
const LOWER_DOT_Y = 1 - UPPER_DOT_Y

export const HOCKEY_FACEOFF_DOTS: Readonly<Record<HockeyFaceoffDotId, Readonly<HockeyRinkPoint>>> = {
  center: { x: 0.5, y: 0.5 },
  left_end_upper: { x: END_DOT_X, y: UPPER_DOT_Y },
  left_end_lower: { x: END_DOT_X, y: LOWER_DOT_Y },
  left_neutral_upper: { x: NEUTRAL_DOT_X, y: UPPER_DOT_Y },
  left_neutral_lower: { x: NEUTRAL_DOT_X, y: LOWER_DOT_Y },
  right_neutral_upper: { x: 1 - NEUTRAL_DOT_X, y: UPPER_DOT_Y },
  right_neutral_lower: { x: 1 - NEUTRAL_DOT_X, y: LOWER_DOT_Y },
  right_end_upper: { x: 1 - END_DOT_X, y: UPPER_DOT_Y },
  right_end_lower: { x: 1 - END_DOT_X, y: LOWER_DOT_Y },
}

/** Dots that sit inside a painted faceoff circle. */
export const HOCKEY_FACEOFF_CIRCLE_DOT_IDS: readonly HockeyFaceoffDotId[] = [
  'center',
  'left_end_upper',
  'left_end_lower',
  'right_end_upper',
  'right_end_lower',
]

export type HockeyZone = 'offensive' | 'neutral' | 'defensive'

/** A tap in display coordinates, as the location of an event by `attackingDirection`'s side. */
export function hockeyRinkLocation(
  displayX: number,
  displayY: number,
  flipped: boolean,
  attackingDirection: HockeyAttackingDirection
): GameEventLocation {
  return surfaceLocation(displayX, displayY, flipped, attackingDirection)
}

/**
 * The nearest faceoff dot by true on-ice distance (feet, not normalized units),
 * with its exact canonical point.
 */
export function nearestHockeyFaceoffDot(
  location: HockeyRinkPoint
): { id: HockeyFaceoffDotId; point: HockeyRinkPoint } {
  let best: HockeyFaceoffDotId = HOCKEY_FACEOFF_DOT_IDS[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const id of HOCKEY_FACEOFF_DOT_IDS) {
    const dot = HOCKEY_FACEOFF_DOTS[id]
    const dx = (location.x - dot.x) * HOCKEY_RINK_LENGTH_FT
    const dy = (location.y - dot.y) * HOCKEY_RINK_WIDTH_FT
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      best = id
      bestDistance = distance
    }
  }
  return { id: best, point: { ...HOCKEY_FACEOFF_DOTS[best] } }
}

/**
 * The zone a canonical location is in for one side, derived at read time and
 * never stored. A point exactly on a blue line counts as neutral.
 */
export function hockeyZone(
  location: HockeyRinkPoint,
  side: 'tracked' | 'opponent',
  trackedAttackingDirection: HockeyAttackingDirection
): HockeyZone {
  const attacking = side === 'tracked'
    ? trackedAttackingDirection
    : oppositeHockeyDirection(trackedAttackingDirection)
  if (location.x > HOCKEY_RINK_LINES.rightBlueLine) {
    return attacking === 'left_to_right' ? 'offensive' : 'defensive'
  }
  if (location.x < HOCKEY_RINK_LINES.leftBlueLine) {
    return attacking === 'left_to_right' ? 'defensive' : 'offensive'
  }
  return 'neutral'
}

export function oppositeHockeyDirection(direction: HockeyAttackingDirection): HockeyAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

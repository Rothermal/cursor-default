import type { GameEventLocation } from '../gameEvents/types'
import { surfaceLocation } from '../surface/location'
import type { BaseballPitchLocation } from './types'

/**
 * The fixed diamond frame (BSB-0 section 8): normalized 0..1 with home plate at
 * (0.5, 0.95), second base above it and the outfield fanning to the top. The frame
 * includes foul territory and is never flipped. The drawing is proportional, not to
 * scale per profile, so one frame serves every profile, softball included (BSB-3 Q6).
 */
export interface BaseballDiamondPoint {
  x: number
  y: number
}

/** Frame units between bases (about 90 ft on the reference field). */
export const BASEBALL_BASE_DISTANCE = 0.2
const DIAGONAL = BASEBALL_BASE_DISTANCE / Math.SQRT2
/** Pitcher's rubber distance from home in frame units (60.5 of 90 ft). */
const RUBBER_DISTANCE = (60.5 / 90) * BASEBALL_BASE_DISTANCE

export const BASEBALL_HOME_PLATE: Readonly<BaseballDiamondPoint> = { x: 0.5, y: 0.95 }

export const BASEBALL_BASE_POINTS = {
  first: { x: 0.5 + DIAGONAL, y: 0.95 - DIAGONAL },
  second: { x: 0.5, y: 0.95 - 2 * DIAGONAL },
  third: { x: 0.5 - DIAGONAL, y: 0.95 - DIAGONAL },
} as const satisfies Record<'first' | 'second' | 'third', BaseballDiamondPoint>

export const BASEBALL_RUBBER: Readonly<BaseballDiamondPoint> = { x: 0.5, y: 0.95 - RUBBER_DISTANCE }

/** Radius of the infield dirt arc around the rubber (about 95 ft). */
export const BASEBALL_INFIELD_RADIUS = (95 / 90) * BASEBALL_BASE_DISTANCE

/** Distance from home to the fence along each foul line and in straightaway center. */
export const BASEBALL_FENCE_AT_LINES = 0.66
export const BASEBALL_FENCE_AT_CENTER = 0.88

/** Where each foul line meets the fence, and the fence's center point. */
export const BASEBALL_FENCE = {
  left: { x: 0.5 - BASEBALL_FENCE_AT_LINES / Math.SQRT2, y: 0.95 - BASEBALL_FENCE_AT_LINES / Math.SQRT2 },
  center: { x: 0.5, y: 0.95 - BASEBALL_FENCE_AT_CENTER },
  right: { x: 0.5 + BASEBALL_FENCE_AT_LINES / Math.SQRT2, y: 0.95 - BASEBALL_FENCE_AT_LINES / Math.SQRT2 },
} as const

/** The quadratic curve control point that makes the fence pass through its center point. */
export const BASEBALL_FENCE_CONTROL: Readonly<BaseballDiamondPoint> = {
  x: 0.5,
  y: 2 * BASEBALL_FENCE.center.y - (BASEBALL_FENCE.left.y + BASEBALL_FENCE.right.y) / 2,
}

/**
 * Where each fielding number's marker sits: 1 P to 9 RF, and 10 for the slowpitch short
 * fielder. Markers show where a fielder normally plays, not where a play happened.
 */
export const BASEBALL_FIELDER_SPOTS: Readonly<Record<number, Readonly<BaseballDiamondPoint>>> = {
  1: { ...BASEBALL_RUBBER },
  2: { x: 0.5, y: 0.967 },
  3: { x: 0.7, y: 0.745 },
  4: { x: 0.59, y: 0.655 },
  5: { x: 0.3, y: 0.745 },
  6: { x: 0.41, y: 0.655 },
  7: { x: 0.2, y: 0.42 },
  8: { x: 0.5, y: 0.3 },
  9: { x: 0.8, y: 0.42 },
  10: { x: 0.5, y: 0.47 },
}

/** A tap on the diamond, in display coordinates 0..1, as a stored batted-ball location. */
export function baseballDiamondLocation(displayX: number, displayY: number): GameEventLocation {
  const location = surfaceLocation(displayX, displayY, false, 'unknown')
  return { ...location, x: round(location.x), y: round(location.y) }
}

export type BaseballFieldArea = 'foul' | 'infield' | 'outfield'

/**
 * Fair territory lies between the foul lines (45 degrees either side of straight up from
 * home) and in front of the plate. Read-time only; nothing about it is stored.
 */
export function isBaseballFair(point: BaseballDiamondPoint): boolean {
  const depth = BASEBALL_HOME_PLATE.y - point.y
  return depth >= 0 && Math.abs(point.x - BASEBALL_HOME_PLATE.x) <= depth + 1e-9
}

/** Foul, infield (inside the dirt arc or the base square) or outfield. Read-time only. */
export function baseballFieldArea(point: BaseballDiamondPoint): BaseballFieldArea {
  if (!isBaseballFair(point)) return 'foul'
  const fromRubber = Math.hypot(point.x - BASEBALL_RUBBER.x, point.y - BASEBALL_RUBBER.y)
  if (fromRubber <= BASEBALL_INFIELD_RADIUS) return 'infield'
  const depth = BASEBALL_HOME_PLATE.y - point.y
  const across = Math.abs(point.x - BASEBALL_HOME_PLATE.x)
  // Inside the square formed by the bases.
  return depth + across <= 2 * DIAGONAL + 1e-9 ? 'infield' : 'outfield'
}

/**
 * The pitch pad frame (catcher's view). The strike zone is 0..1 on both axes; the pad
 * extends 0.75 beyond it on every side, matching the engine's accepted range.
 */
export const BASEBALL_PITCH_PAD_MIN = -0.75
export const BASEBALL_PITCH_PAD_SPAN = 2.5

/** A tap on the pitch pad, in display coordinates 0..1, as a stored pitch location. */
export function baseballPitchPadLocation(displayX: number, displayY: number): BaseballPitchLocation {
  const toZone = (value: number) =>
    round(BASEBALL_PITCH_PAD_MIN + Math.min(1, Math.max(0, value)) * BASEBALL_PITCH_PAD_SPAN)
  return { x: toZone(displayX), y: toZone(displayY) }
}

/** Display position (0..1) of a stored pitch location on the pad. */
export function baseballPitchPadDisplay(location: BaseballPitchLocation): BaseballDiamondPoint {
  return {
    x: (location.x - BASEBALL_PITCH_PAD_MIN) / BASEBALL_PITCH_PAD_SPAN,
    y: (location.y - BASEBALL_PITCH_PAD_MIN) / BASEBALL_PITCH_PAD_SPAN,
  }
}

/** Whether a pitch location is inside the drawn strike zone. Read-time only. */
export function isBaseballPitchInZone(location: BaseballPitchLocation): boolean {
  return location.x >= 0 && location.x <= 1 && location.y >= 0 && location.y <= 1
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

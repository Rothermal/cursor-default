import type { GameEventLocation } from '../gameEvents/types'
import {
  BASELINE_Y,
  COURT_WIDTH,
  HALF_COURT_DEPTH,
  HALFCOURT_Y,
  normalizedCourtLocationToFeet,
  type BasketballCourtPoint,
} from './courtGeometry'
import type { BasketballAttackingDirection } from './types'

/**
 * Full-court frame (BKE-7 §3.1): `x` runs along the length (0 = left baseline,
 * 1 = right baseline) and `y` across (0 = top sideline). Each end is the existing
 * half-court drawing, so a point classifies exactly as it would on the half court.
 *
 * A location's `attackingDirection` names its frame: `'unknown'` is the half court
 * recorded before BKE-7; a known direction is the full court, aimed at the basket
 * that direction attacks (right for left_to_right).
 */
export const FULL_COURT_LENGTH = HALF_COURT_DEPTH * 2

export function oppositeBasketballDirection(
  direction: BasketballAttackingDirection
): BasketballAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

export function isBasketballAttackingDirection(value: unknown): value is BasketballAttackingDirection {
  return value === 'left_to_right' || value === 'right_to_left'
}

/**
 * Rim-centered feet relative to the location's own target basket, in the same space
 * as the half court (`+y` toward half court, `x` across). The left basket is the
 * half court turned a quarter so its baseline is on top; the right basket is that
 * view turned half a turn, so `(x, y)` toward the right equals `(1 - x, 1 - y)`
 * toward the left. Value checks always read the stored location through this
 * helper, so a command and the validator agree on every borderline point.
 */
export function basketballShotFeet(
  location: Pick<GameEventLocation, 'x' | 'y' | 'attackingDirection'>
): BasketballCourtPoint {
  if (location.attackingDirection === 'unknown') return normalizedCourtLocationToFeet(location)
  const leftward = location.attackingDirection === 'right_to_left'
  const x = leftward ? location.x : 1 - location.x
  const y = leftward ? location.y : 1 - location.y
  return {
    x: (0.5 - y) * COURT_WIDTH,
    y: x * FULL_COURT_LENGTH + BASELINE_Y,
  }
}

/** The full-court location of a target-relative point; the inverse of `basketballShotFeet`. */
export function basketballFullCourtLocation(
  point: BasketballCourtPoint,
  direction: BasketballAttackingDirection
): GameEventLocation {
  const leftX = clamp((point.y - BASELINE_Y) / FULL_COURT_LENGTH)
  const leftY = clamp(0.5 - point.x / COURT_WIDTH)
  return direction === 'right_to_left'
    ? { x: leftX, y: leftY, attackingDirection: direction }
    : { x: 1 - leftX, y: 1 - leftY, attackingDirection: direction }
}

/** A full-court point past the midcourt line from its own basket (BKE-7 §3.3, §3.5). */
export function isBasketballBeyondHalfCourt(
  location: Pick<GameEventLocation, 'x' | 'y' | 'attackingDirection'>
): boolean {
  if (location.attackingDirection === 'unknown') return false
  return basketballShotFeet(location).y > HALFCOURT_Y
}

/** The basket nearer a full-court tap: the right one for `x > 0.5`. */
/**
 * The basket a direction aims at as the recorder sees it: the canonical basket, or the
 * other one while the court is shown flipped. Labels only; stored directions never change.
 */
export function basketballShownBasket(
  direction: BasketballAttackingDirection,
  orientation: 'standard' | 'flipped' = 'standard'
): 'left' | 'right' {
  const right = direction === 'left_to_right'
  return right !== (orientation === 'flipped') ? 'right' : 'left'
}

export function basketballDirectionTowardTap(x: number): BasketballAttackingDirection {
  return x > 0.5 ? 'left_to_right' : 'right_to_left'
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

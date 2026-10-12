import type { BasketballAttackingDirection } from './types'

/**
 * Rollback switch for BKE-7: false makes new Basketball Event games half court again
 * (no tip-off event). Full-court games already recorded still open and track.
 */
export const BASKETBALL_FULL_COURT_FOR_NEW_GAMES = true

/** The tracked team shoots at the right basket first unless the recorder picks (§7 Q5). */
export const BASKETBALL_DEFAULT_TIP_OFF_DIRECTION: BasketballAttackingDirection = 'left_to_right'

/** The tip-off direction a new game starts with, or undefined for a half-court game. */
export function basketballNewGameTipOffDirection(
  chosen: BasketballAttackingDirection = BASKETBALL_DEFAULT_TIP_OFF_DIRECTION
): BasketballAttackingDirection | undefined {
  return BASKETBALL_FULL_COURT_FOR_NEW_GAMES ? chosen : undefined
}

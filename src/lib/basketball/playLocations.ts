import type { GameState } from '../../types'
import type { GameEventLocation } from '../gameEvents/types'
import { basketballCurrentDirection } from './courtDirectionEvents'
import { basketballShotFeet, basketballShownBasket } from './fullCourtGeometry'
import type {
  BasketballAttackingDirection,
  BasketballMatchEvent,
  BasketballTeamSide,
} from './types'

/**
 * Located plays (BKE-7C, §7 Q3): rebounds, steals, blocks, turnovers and fouls entered from a
 * full-court tap keep their spot, stamped with the acting side's direction like a shot. Plays
 * never use the half-court frame, and plays entered any other way stay unlocated.
 */
export const BASKETBALL_LOCATED_PLAY_TYPES = new Set<BasketballMatchEvent['eventType']>([
  'basketball.rebound',
  'basketball.steal',
  'basketball.block',
  'basketball.turnover',
  'basketball.foul',
])

/** A play may carry only a full-court spot (a known direction), or none. */
export function isValidBasketballPlayLocation(location: GameEventLocation | null): boolean {
  return location === null || location.attackingDirection !== 'unknown'
}

/** A 0..1 full-court tap as a play location for `side`, or null in a half-court game. */
export function basketballPlayCaptureLocation(
  state: GameState,
  side: BasketballTeamSide,
  point: { x: number; y: number } | null | undefined
): GameEventLocation | null {
  if (!point || state.sportGameState?.sportId !== 'basketball') return null
  const direction = basketballCurrentDirection(state.sportGameState.projection, side)
  if (!direction) return null
  if (![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null
  return { x: point.x, y: point.y, attackingDirection: direction }
}

/**
 * The spot of a located play while it is edited. The stored direction stays as recorded
 * (§3.4): moving the spot or changing the team never re-stamps it, and removing the spot
 * clears it.
 */
export interface BasketballPlaySpotDraft {
  point: { x: number; y: number } | null
  direction: BasketballAttackingDirection
}

/** The edit draft for a play's spot, or null when the play has none to edit. */
export function basketballPlaySpotDraft(event: BasketballMatchEvent): BasketballPlaySpotDraft | null {
  if (!BASKETBALL_LOCATED_PLAY_TYPES.has(event.eventType)) return null
  const location = event.location
  if (!location || location.attackingDirection === 'unknown') return null
  return { point: { x: location.x, y: location.y }, direction: location.attackingDirection }
}

export function basketballPlaySpotLocation(spot: BasketballPlaySpotDraft): GameEventLocation | null {
  return spot.point ? { ...spot.point, attackingDirection: spot.direction } : null
}

/** "6.1 ft from the right basket": the distance to the nearer basket, as the court is shown. */
export function basketballPlaySpotText(
  location: GameEventLocation,
  orientation: 'standard' | 'flipped' = 'standard'
): string {
  const nearer: BasketballAttackingDirection = location.x >= 0.5 ? 'left_to_right' : 'right_to_left'
  const feet = basketballShotFeet({ x: location.x, y: location.y, attackingDirection: nearer })
  return `${Math.hypot(feet.x, feet.y).toFixed(1)} ft from the ${basketballShownBasket(nearer, orientation)} basket`
}

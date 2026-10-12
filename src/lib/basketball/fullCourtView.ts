import type { GameState, ShotRecord } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import type { GameEventLocation } from '../gameEvents/types'
import { COURT_WIDTH } from './courtGeometry'
import { basketballCurrentDirection } from './courtDirectionEvents'
import { FULL_COURT_LENGTH } from './fullCourtGeometry'
import type { BasketballAttackingDirection, BasketballTeamSide } from './types'

/** A game with a tip-off direction is tracked on the full court (BKE-7 §3.2). */
export function isBasketballFullCourtGame(state: GameState): boolean {
  return state.sportGameState?.sportId === 'basketball' &&
    Boolean(state.sportGameState.projection.court)
}

/** The side's current basket, or null for a half-court game. */
export function basketballSideDirection(
  state: GameState,
  side: BasketballTeamSide
): BasketballAttackingDirection | null {
  if (state.sportGameState?.sportId !== 'basketball') return null
  return basketballCurrentDirection(state.sportGameState.projection, side)
}

/** The side attacking the basket a full-court direction points at. */
export function basketballSideAttacking(
  state: GameState,
  direction: BasketballAttackingDirection
): BasketballTeamSide | null {
  const tracked = basketballSideDirection(state, 'tracked')
  if (!tracked) return null
  return tracked === direction ? 'tracked' : 'opponent'
}

/** Stored full-court locations of active located field goals, by event id. */
export function basketballFullCourtShotLocations(state: GameState): Map<string, GameEventLocation> {
  const locations = new Map<string, GameEventLocation>()
  for (const event of state.eventStream?.events ?? []) {
    if (
      !isGameEventEnvelope(event) ||
      event.sportId !== 'basketball' ||
      event.eventType !== 'basketball.shot' ||
      event.deletedAt ||
      !event.location ||
      event.location.attackingDirection === 'unknown'
    ) continue
    locations.set(event.id, event.location)
  }
  return locations
}

/** Full-court feet (0..94 along the length, 0..50 across) of a stored location. */
export function basketballFullCourtFeet(point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x * FULL_COURT_LENGTH, y: point.y * COURT_WIDTH }
}

/**
 * Shot records moved to full-court feet, for drawing and overlap checks on the full
 * court. Shots without a full-court location (none in a full-court game) are left out.
 */
export function basketballFullCourtShotRecords(
  shots: ShotRecord[],
  locations: Map<string, GameEventLocation>
): ShotRecord[] {
  return shots.flatMap(shot => {
    const location = locations.get(shot.id)
    if (!location) return []
    const feet = basketballFullCourtFeet(location)
    return [{ ...shot, x: feet.x, y: feet.y }]
  })
}

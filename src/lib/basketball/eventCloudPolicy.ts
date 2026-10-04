import type { GameState } from '../../types'
import {
  eventCloudPolicyForState,
  invalidEventCloudPolicyError,
  normalizeEventCloudPolicy,
  normalizeEventCloudPolicyState,
  type EventCloudPolicy,
} from '../eventCloudPolicy'

export type BasketballEventCloudPolicy = EventCloudPolicy

export const INVALID_BASKETBALL_EVENT_CLOUD_POLICY_ERROR = invalidEventCloudPolicyError('Basketball')

export const normalizeBasketballEventCloudPolicy = normalizeEventCloudPolicy

/** Missing preserves the automatic behavior of Basketball Event games created before BKE-5C. */
export function basketballEventCloudPolicyForState(
  state: GameState
): BasketballEventCloudPolicy | null {
  return state.sport?.id === 'basketball' ? eventCloudPolicyForState(state) : null
}

export function isBasketballEventLocalOnly(state: GameState): boolean {
  return basketballEventCloudPolicyForState(state) === 'local_only'
}

/** Sport-neutral since HKY-5B; kept for existing callers. */
export const normalizeBasketballEventCloudPolicyState = normalizeEventCloudPolicyState

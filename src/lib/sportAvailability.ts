import { BASEBALL_NEW_GAME_CREATION_ENABLED } from './baseball/releasePolicy'

export const SOCCER_RELEASED_IN_PRODUCTION = true
export const BASKETBALL_EVENT_RELEASE_STAGE = 'released' as const
/**
 * XS-1 per-sport event stages (HKY-2E). Existing event games stay reachable at every
 * stage; only new games are gated. `released` makes every new game an event game with no
 * device toggle (HKY-6C). Hockey rollback is creation-only: `released` -> `internal`.
 * Baseball's cutover instead uses the creation-only switch; stages cannot revive its grid.
 */
export const SPORT_EVENT_RELEASE_STAGES = {
  hockey: 'released',
} as const satisfies Record<string, SportEventReleaseStage>
const DEVELOPMENT_BUILD = import.meta.env.DEV

export type SportReleaseStage = 'unreleased' | 'preview' | 'released'
export type BasketballEventReleaseStage = 'internal' | 'released'
export type SportEventReleaseStage = 'internal' | 'released'

export interface SportAvailabilityPolicy {
  releaseStage: SportReleaseStage | null
  toggleAvailable: boolean
  discoverable: boolean
  canStartNewGame: boolean
  canAccessExisting: boolean
}

interface SportAvailabilityOptions {
  development?: boolean
  soccerReleasedInProduction?: boolean
}

export interface BasketballEventCreationPolicy {
  releaseStage: BasketballEventReleaseStage
  preferenceAvailable: boolean
  canCreateNewEventGame: boolean
  canAccessExistingEventGames: true
}

interface BasketballEventCreationPolicyOptions {
  releaseStage?: BasketballEventReleaseStage
}

export interface SportEventCreationPolicy {
  releaseStage: SportEventReleaseStage
  /** Whether the device toggle is shown and honoured in this build. */
  preferenceAvailable: boolean
  canCreateNewEventGame: boolean
  canAccessExistingEventGames: true
}

/**
 * Hockey's retired preview preference is ignored. Rollback blocks new games, including
 * development/local-only setup, without reviving the aggregate tracker.
 */
export function getHockeyEventCreationPolicy(
  {
    releaseStage = SPORT_EVENT_RELEASE_STAGES.hockey,
  }: { releaseStage?: SportEventReleaseStage } = {}
): SportEventCreationPolicy {
  return { releaseStage, preferenceAvailable: false,
    canCreateNewEventGame: releaseStage === 'released', canAccessExistingEventGames: true }
}

/**
 * BSB-7D: old preview preferences/stages cannot revive aggregate creation. The separate
 * creation switch also applies in development; existing games are never gated by it.
 */
export function getBaseballEventCreationPolicy(
  {
    creationEnabled = BASEBALL_NEW_GAME_CREATION_ENABLED,
  }: { creationEnabled?: boolean } = {}
): SportEventCreationPolicy {
  return { releaseStage: 'released', preferenceAvailable: false,
    canCreateNewEventGame: creationEnabled, canAccessExistingEventGames: true }
}

export function getSportAvailabilityPolicy(
  sportId: string,
  enabledInSettings: boolean,
  {
    development = DEVELOPMENT_BUILD,
    soccerReleasedInProduction = SOCCER_RELEASED_IN_PRODUCTION,
  }: SportAvailabilityOptions = {}
): SportAvailabilityPolicy {
  if (sportId !== 'soccer') {
    return {
      releaseStage: null,
      toggleAvailable: true,
      discoverable: enabledInSettings,
      canStartNewGame: enabledInSettings,
      canAccessExisting: true,
    }
  }

  const releaseStage: SportReleaseStage = development
    ? 'preview'
    : soccerReleasedInProduction
      ? 'released'
      : 'unreleased'
  const toggleAvailable = releaseStage !== 'unreleased'
  const enabled = toggleAvailable && enabledInSettings

  return {
    releaseStage,
    toggleAvailable,
    discoverable: enabled,
    canStartNewGame: enabled,
    canAccessExisting: true,
  }
}

export function getBasketballEventCreationPolicy(
  {
    releaseStage = BASKETBALL_EVENT_RELEASE_STAGE,
  }: BasketballEventCreationPolicyOptions = {}
): BasketballEventCreationPolicy {
  // Internal is a creation-only rollback, including development. Never restore the grid.
  return {
    releaseStage,
    preferenceAvailable: false,
    canCreateNewEventGame: releaseStage === 'released',
    canAccessExistingEventGames: true,
  }
}

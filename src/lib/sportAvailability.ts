export const SOCCER_RELEASED_IN_PRODUCTION = true
export const BASKETBALL_EVENT_RELEASE_STAGE = 'opt_in' as const
/**
 * XS-1 per-sport event stages (HKY-2E). Existing event games stay reachable at every
 * stage; only new games are gated. `released` makes every new game an event game with no
 * device toggle (HKY-6C). Rollback: `released` -> `opt_in`, `opt_in` -> `internal`.
 */
export const SPORT_EVENT_RELEASE_STAGES = {
  hockey: 'released',
  baseball: 'opt_in',
} as const satisfies Record<string, SportEventReleaseStage>
const DEVELOPMENT_BUILD = import.meta.env.DEV

export type SportReleaseStage = 'unreleased' | 'preview' | 'released'
export type BasketballEventReleaseStage = 'internal' | 'opt_in'
export type SportEventReleaseStage = 'internal' | 'opt_in' | 'released'

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
  development?: boolean
  releaseStage?: BasketballEventReleaseStage
}

export interface SportEventCreationPolicy {
  releaseStage: SportEventReleaseStage
  /** Whether the device toggle is shown and honoured in this build. */
  preferenceAvailable: boolean
  canCreateNewEventGame: boolean
  canAccessExistingEventGames: true
}

interface SportEventCreationPolicyOptions {
  development?: boolean
  releaseStage?: SportEventReleaseStage
}

/**
 * HKY-2E (Q2): at `opt_in`, new Hockey event games need the owner's device toggle in
 * production, which defaults off, and development keeps the preview without it. HKY-6C
 * releases Hockey: every new game is an event game and the toggle is gone.
 */
export function getHockeyEventCreationPolicy(
  enabledOnDevice: boolean,
  {
    development = DEVELOPMENT_BUILD,
    releaseStage = SPORT_EVENT_RELEASE_STAGES.hockey,
  }: SportEventCreationPolicyOptions = {}
): SportEventCreationPolicy {
  return sportEventCreationPolicy(enabledOnDevice, development, releaseStage)
}

/**
 * Whether a new Hockey game opens the event setup rather than the stat grid: always once
 * released, otherwise only with the device toggle on and the policy allowing it.
 */
export function hockeyNewGamesUseEventTracker(
  enabledOnDevice: boolean,
  options: SportEventCreationPolicyOptions = {}
): boolean {
  const policy = getHockeyEventCreationPolicy(enabledOnDevice, options)
  return policy.canCreateNewEventGame && (policy.releaseStage === 'released' || enabledOnDevice)
}

function sportEventCreationPolicy(
  enabledOnDevice: boolean,
  development: boolean,
  releaseStage: SportEventReleaseStage
): SportEventCreationPolicy {
  const preferenceAvailable = releaseStage === 'opt_in'
  return {
    releaseStage,
    preferenceAvailable,
    canCreateNewEventGame: development || releaseStage === 'released' || (preferenceAvailable && enabledOnDevice),
    canAccessExistingEventGames: true,
  }
}

/**
 * BSB-3D (Q1): new Baseball event games need the owner's device toggle in production,
 * which defaults off; development keeps the preview without it. Event Baseball stays
 * local-only at every stage; BSB-7 owns the wider release.
 */
export function getBaseballEventCreationPolicy(
  enabledOnDevice: boolean,
  {
    development = DEVELOPMENT_BUILD,
    releaseStage = SPORT_EVENT_RELEASE_STAGES.baseball,
  }: SportEventCreationPolicyOptions = {}
): SportEventCreationPolicy {
  return sportEventCreationPolicy(enabledOnDevice, development, releaseStage)
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
  enabledOnDevice: boolean,
  {
    development = DEVELOPMENT_BUILD,
    releaseStage = BASKETBALL_EVENT_RELEASE_STAGE,
  }: BasketballEventCreationPolicyOptions = {}
): BasketballEventCreationPolicy {
  const preferenceAvailable = development || releaseStage === 'opt_in'
  return {
    releaseStage,
    preferenceAvailable,
    canCreateNewEventGame: preferenceAvailable && enabledOnDevice,
    canAccessExistingEventGames: true,
  }
}

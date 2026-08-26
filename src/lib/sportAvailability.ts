export const SOCCER_RELEASED_IN_PRODUCTION = true
export const BASKETBALL_EVENT_RELEASE_STAGE = 'opt_in' as const
const DEVELOPMENT_BUILD = import.meta.env.DEV

export type SportReleaseStage = 'unreleased' | 'preview' | 'released'
export type BasketballEventReleaseStage = 'internal' | 'opt_in'

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

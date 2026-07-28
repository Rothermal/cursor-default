export const SOCCER_RELEASED_IN_PRODUCTION = true

export type SportReleaseStage = 'unreleased' | 'preview' | 'released'

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

export function getSportAvailabilityPolicy(
  sportId: string,
  enabledInSettings: boolean,
  {
    development = import.meta.env.DEV,
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

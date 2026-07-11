/**
 * Pure decision helpers for cloud team switches (PR #178).
 * Prevents re-homing an active/bound cloud game onto a different team.
 */

/** Deep-link /setup?teamId= must reset when sport differs, or same-sport different team with an active game. */
export function shouldResetActiveGameForRequestedTeam(options: {
  hasActiveGame: boolean
  currentSportId: string | null | undefined
  requestedSportId: string
  currentTeamId: string | null
  requestedTeamId: string | null | undefined
}): boolean {
  const sportMismatch = options.currentSportId !== options.requestedSportId
  const teamMismatch = Boolean(
    options.requestedTeamId &&
      options.currentTeamId &&
      options.requestedTeamId !== options.currentTeamId
  )
  return sportMismatch || (teamMismatch && options.hasActiveGame)
}

/** Proceed path: switching teams with an active game or bound cloud gameId requires clear/confirm. */
export function shouldGuardCloudTeamSwitch(options: {
  nextTeamId: string | null
  currentTeamId: string | null
  hasActiveGame: boolean
  currentGameId: string | null
}): boolean {
  const teamIdChanging = options.nextTeamId !== options.currentTeamId
  return teamIdChanging && (options.hasActiveGame || Boolean(options.currentGameId))
}

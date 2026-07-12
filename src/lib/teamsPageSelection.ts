/**
 * Pure selection rule for Cloud Teams list vs manage routes.
 * List mode never auto-selects; manage only selects a requested id present in the loaded set.
 */
export function resolveTeamsPageSelectedTeamId(options: {
  isManagementRoute: boolean
  requestedTeamId: string | null
  loadedTeamIds: string[]
}): string {
  const { isManagementRoute, requestedTeamId, loadedTeamIds } = options
  if (
    isManagementRoute &&
    requestedTeamId &&
    loadedTeamIds.includes(requestedTeamId)
  ) {
    return requestedTeamId
  }
  return ''
}

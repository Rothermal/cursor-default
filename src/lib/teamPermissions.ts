export type TeamRole = 'owner' | 'admin' | 'scorer'

const TEAM_ROLES = new Set<TeamRole>(['owner', 'admin', 'scorer'])

export function parseTeamRole(value: unknown): TeamRole | null {
  return typeof value === 'string' && TEAM_ROLES.has(value as TeamRole)
    ? (value as TeamRole)
    : null
}

export function acceptedTeamRole(
  role: unknown,
  acceptedAt: string | null | undefined
): TeamRole | null {
  return acceptedAt ? parseTeamRole(role) : null
}

export function canViewTeam(role: TeamRole | null): boolean {
  return role !== null
}

export function canTrackGames(role: TeamRole | null): boolean {
  return role !== null
}

export function canManageTeam(role: TeamRole | null): boolean {
  return role === 'owner' || role === 'admin'
}

export const canManageRoster = canManageTeam
export const canManageMembers = canManageTeam
export const canInviteMembers = canManageTeam
export const canCorrectStats = canManageTeam
export const canMergePlayers = canManageTeam

export function canDeleteTeam(role: TeamRole | null): boolean {
  return role === 'owner'
}

export function canDeleteGame(role: TeamRole | null): boolean {
  return canManageTeam(role)
}

export function canLeaveTeam(role: TeamRole | null): boolean {
  return role === 'admin' || role === 'scorer'
}

export function canInviteTeamRole(
  actorRole: TeamRole | null,
  invitedRole: TeamRole
): boolean {
  if (invitedRole === 'owner') return false
  if (actorRole === 'owner') return invitedRole === 'admin' || invitedRole === 'scorer'
  return actorRole === 'admin' && invitedRole === 'scorer'
}

export function canRemoveTeamMember(
  actorRole: TeamRole | null,
  targetRole: TeamRole | null,
  isSelf: boolean
): boolean {
  if (!actorRole || !targetRole || isSelf || targetRole === 'owner') return false
  if (actorRole === 'owner') return targetRole === 'admin' || targetRole === 'scorer'
  return actorRole === 'admin' && targetRole === 'scorer'
}

export function canChangeTeamMemberRole(
  actorRole: TeamRole | null,
  targetRole: TeamRole | null,
  nextRole: TeamRole
): boolean {
  return (
    actorRole === 'owner' &&
    targetRole !== null &&
    targetRole !== 'owner' &&
    (nextRole === 'admin' || nextRole === 'scorer')
  )
}

export function canEditPlayerIdentity(
  userId: string | null,
  createdBy: string | null | undefined,
  isGuardian: boolean
): boolean {
  return Boolean(userId && (createdBy === userId || isGuardian))
}

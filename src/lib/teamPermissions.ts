export type TeamRole = 'owner' | 'admin' | 'scorer' | 'viewer'

const TEAM_ROLES = new Set<TeamRole>(['owner', 'admin', 'scorer', 'viewer'])

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
  return role === 'owner' || role === 'admin' || role === 'scorer'
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
  return role === 'admin' || role === 'scorer' || role === 'viewer'
}

export function canInviteTeamRole(
  actorRole: TeamRole | null,
  invitedRole: TeamRole
): boolean {
  if (invitedRole === 'owner') return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && (invitedRole === 'scorer' || invitedRole === 'viewer')
}

export function canRemoveTeamMember(
  actorRole: TeamRole | null,
  targetRole: TeamRole | null,
  isSelf: boolean
): boolean {
  if (!actorRole || !targetRole || isSelf || targetRole === 'owner') return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && (targetRole === 'scorer' || targetRole === 'viewer')
}

export function canChangeTeamMemberRole(
  actorRole: TeamRole | null,
  targetRole: TeamRole | null,
  nextRole: TeamRole
): boolean {
  if (!targetRole || targetRole === 'owner' || nextRole === 'owner') return false
  if (actorRole === 'owner') return true
  return (
    actorRole === 'admin' &&
    (targetRole === 'scorer' || targetRole === 'viewer') &&
    (nextRole === 'scorer' || nextRole === 'viewer')
  )
}

export function canClaimPlayerGuardianship(role: TeamRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'scorer'
}

export function canEditPlayerIdentity(
  userId: string | null,
  createdBy: string | null | undefined,
  isGuardian: boolean
): boolean {
  return Boolean(userId && (createdBy === userId || isGuardian))
}

export function canViewPlayerGuardians(
  role: TeamRole | null,
  isCreator: boolean,
  isGuardian: boolean
): boolean {
  return canManageRoster(role) || isCreator || isGuardian
}

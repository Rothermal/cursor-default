export type TeamInviteLinkRole = 'scorer' | 'viewer'

const TEAM_INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/i

export function normalizeTeamInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim().toLowerCase()
  return TEAM_INVITE_TOKEN_PATTERN.test(token) ? token : null
}

export function teamInvitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`
}

export function buildTeamInviteUrl(
  token: string,
  location: Pick<Location, 'origin' | 'pathname'> = window.location
): string {
  return `${location.origin}${location.pathname}#${teamInvitePath(token)}`
}

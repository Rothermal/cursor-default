import type { SoccerRole, SoccerRoleGroup } from './types'

export type SoccerRosterRoleGroup = Exclude<SoccerRoleGroup, 'custom'>

export const SOCCER_ROSTER_ROLE_OPTIONS: ReadonlyArray<{
  value: SoccerRosterRoleGroup
  label: string
}> = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
]

const DEFAULT_ROLE: SoccerRosterRoleGroup = 'midfielder'
const STORAGE_PREFIX = 'soccer:'

export function parseSoccerRosterRole(value: unknown): SoccerRole {
  if (typeof value !== 'string') return soccerRosterRole(DEFAULT_ROLE)
  const stored = value.trim()
  const option = SOCCER_ROSTER_ROLE_OPTIONS.find(
    candidate => `${STORAGE_PREFIX}${candidate.value}` === stored
  )
  return soccerRosterRole(option?.value ?? DEFAULT_ROLE)
}

export function serializeSoccerRosterRole(group: SoccerRosterRoleGroup): string {
  return `${STORAGE_PREFIX}${group}`
}

export function soccerRosterRoleLabel(value: unknown): string {
  const role = parseSoccerRosterRole(value)
  return SOCCER_ROSTER_ROLE_OPTIONS.find(option => option.value === role.group)?.label
    ?? 'Midfielder'
}

function soccerRosterRole(group: SoccerRosterRoleGroup): SoccerRole {
  return { group, label: null }
}

import { isPlainObject } from '../gameEvents/envelope'

export const SOCCER_TEAM_LINEUP_DEFAULTS_VERSION = 1
export const MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS = 250

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type SoccerLineupDefaultStatus = 'starter' | 'bench'

export interface SoccerTeamLineupDefaultsV1 {
  version: 1
  starterPlayerIds: string[]
}

export type SoccerLineupDefaultsParseResult =
  | { ok: true; value: SoccerTeamLineupDefaultsV1 }
  | { ok: false; error: string }

export function emptySoccerTeamLineupDefaults(): SoccerTeamLineupDefaultsV1 {
  return { version: SOCCER_TEAM_LINEUP_DEFAULTS_VERSION, starterPlayerIds: [] }
}

export function parseSoccerTeamLineupDefaults(
  value: unknown
): SoccerLineupDefaultsParseResult {
  if (!hasExactKeys(value, ['version', 'starterPlayerIds'])) {
    return invalid('Soccer lineup defaults must use the exact schema.')
  }
  if (value.version !== SOCCER_TEAM_LINEUP_DEFAULTS_VERSION) {
    return invalid('Soccer lineup defaults version is unsupported.')
  }
  if (!Array.isArray(value.starterPlayerIds)) {
    return invalid('Soccer lineup default starterPlayerIds must be an array.')
  }
  if (value.starterPlayerIds.length > MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS) {
    return invalid('Soccer lineup defaults contain too many starter player ids.')
  }

  const normalized = new Set<string>()
  for (const playerId of value.starterPlayerIds) {
    if (typeof playerId !== 'string' || !UUID_PATTERN.test(playerId)) {
      return invalid('Soccer lineup default player ids must be UUIDs.')
    }
    const normalizedPlayerId = playerId.toLowerCase()
    if (normalized.has(normalizedPlayerId)) {
      return invalid('Soccer lineup default player ids must be unique.')
    }
    normalized.add(normalizedPlayerId)
  }

  return {
    ok: true,
    value: {
      version: SOCCER_TEAM_LINEUP_DEFAULTS_VERSION,
      starterPlayerIds: [...normalized].sort(),
    },
  }
}

export function soccerLineupDefaultStatusForPlayer(
  defaults: SoccerTeamLineupDefaultsV1,
  playerId: string
): SoccerLineupDefaultStatus {
  const normalizedPlayerId = playerId.toLowerCase()
  return defaults.starterPlayerIds.includes(normalizedPlayerId) ? 'starter' : 'bench'
}

export function setSoccerLineupDefaultStatus(
  defaults: SoccerTeamLineupDefaultsV1,
  playerId: string,
  status: SoccerLineupDefaultStatus
): SoccerTeamLineupDefaultsV1 {
  if (!UUID_PATTERN.test(playerId)) return structuredClone(defaults)
  const normalizedPlayerId = playerId.toLowerCase()
  const starterPlayerIds = new Set(defaults.starterPlayerIds)
  if (status === 'starter') {
    if (
      !starterPlayerIds.has(normalizedPlayerId) &&
      starterPlayerIds.size >= MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS
    ) {
      return structuredClone(defaults)
    }
    starterPlayerIds.add(normalizedPlayerId)
  } else {
    starterPlayerIds.delete(normalizedPlayerId)
  }
  return {
    version: SOCCER_TEAM_LINEUP_DEFAULTS_VERSION,
    starterPlayerIds: [...starterPlayerIds].sort(),
  }
}

export function unavailableSoccerLineupDefaultPlayerIds(
  defaults: SoccerTeamLineupDefaultsV1,
  completeTeamPlayerIds: Iterable<string>
): string[] {
  const available = new Set(
    [...completeTeamPlayerIds].map(playerId => playerId.toLowerCase())
  )
  return defaults.starterPlayerIds.filter(playerId => !available.has(playerId))
}

export function prepareSoccerLineupDefaultsForSave(
  defaults: SoccerTeamLineupDefaultsV1,
  completeTeamPlayerIds: Iterable<string>
): SoccerTeamLineupDefaultsV1 {
  const available = new Set(
    [...completeTeamPlayerIds].map(playerId => playerId.toLowerCase())
  )
  return {
    version: SOCCER_TEAM_LINEUP_DEFAULTS_VERSION,
    starterPlayerIds: defaults.starterPlayerIds.filter(playerId => available.has(playerId)),
  }
}

function hasExactKeys<T extends string>(
  value: unknown,
  expectedKeys: readonly T[]
): value is Record<T, unknown> {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  return keys.length === expectedKeys.length &&
    keys.every(key => expectedKeys.includes(key as T))
}

function invalid(error: string): SoccerLineupDefaultsParseResult {
  return { ok: false, error }
}

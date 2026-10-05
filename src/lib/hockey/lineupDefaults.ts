import { isPlainObject } from '../gameEvents/envelope'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const HOCKEY_MAX_DEFAULT_STARTERS = 6

/**
 * Team roster defaults: Starter skaters plus starting and backup goalies, keyed by
 * stable player id. Missing defaults mean Bench and no goalie (never inferred).
 */
export interface HockeyLineupDefaults {
  version: 1
  starterPlayerIds: string[]
  startingGoaliePlayerId: string | null
  backupGoaliePlayerId: string | null
}

export function emptyHockeyLineupDefaults(): HockeyLineupDefaults {
  return { version: 1, starterPlayerIds: [], startingGoaliePlayerId: null, backupGoaliePlayerId: null }
}

/** Exact parser; ids are lower-cased and starters sorted so equal defaults compare equal. */
export function parseHockeyLineupDefaults(value: unknown): HockeyLineupDefaults | null {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 4 ||
    value.version !== 1 ||
    !Array.isArray(value.starterPlayerIds) ||
    value.starterPlayerIds.length > HOCKEY_MAX_DEFAULT_STARTERS ||
    !('startingGoaliePlayerId' in value) ||
    !('backupGoaliePlayerId' in value)
  ) return null
  const starters: string[] = []
  for (const id of value.starterPlayerIds) {
    const normalized = normalizeId(id)
    if (!normalized || starters.includes(normalized)) return null
    starters.push(normalized)
  }
  const starting = value.startingGoaliePlayerId === null ? null : normalizeId(value.startingGoaliePlayerId)
  const backup = value.backupGoaliePlayerId === null ? null : normalizeId(value.backupGoaliePlayerId)
  if (starting === undefined || backup === undefined) return null
  if (starting !== null && (starting === backup || starters.includes(starting))) return null
  if (backup !== null && starters.includes(backup)) return null
  return {
    version: 1,
    starterPlayerIds: starters.sort(),
    startingGoaliePlayerId: starting,
    backupGoaliePlayerId: backup,
  }
}

/** Drops ids that are no longer on the active roster (explicit cleanup, never automatic). */
export function pruneHockeyLineupDefaults(
  defaults: HockeyLineupDefaults,
  activePlayerIds: ReadonlySet<string>
): HockeyLineupDefaults {
  const keep = (id: string | null) => (id !== null && activePlayerIds.has(id) ? id : null)
  return {
    version: 1,
    starterPlayerIds: defaults.starterPlayerIds.filter(id => activePlayerIds.has(id)),
    startingGoaliePlayerId: keep(defaults.startingGoaliePlayerId),
    backupGoaliePlayerId: keep(defaults.backupGoaliePlayerId),
  }
}

export type HockeyDefaultRole = 'bench' | 'starter' | 'starting_goalie' | 'backup_goalie'

export function hockeyDefaultRole(lineup: HockeyLineupDefaults, playerId: string): HockeyDefaultRole {
  if (lineup.startingGoaliePlayerId === playerId) return 'starting_goalie'
  if (lineup.backupGoaliePlayerId === playerId) return 'backup_goalie'
  return lineup.starterPlayerIds.includes(playerId) ? 'starter' : 'bench'
}

/**
 * Gives one player one default role. A goalie slot moves to the new player, and the
 * starter list keeps its limit; the result always parses (ids sorted like the parser).
 */
export function setHockeyDefaultRole(
  lineup: HockeyLineupDefaults,
  playerId: string,
  role: HockeyDefaultRole
): HockeyLineupDefaults {
  const clear = (id: string | null) => (id === playerId ? null : id)
  const next: HockeyLineupDefaults = {
    version: 1,
    starterPlayerIds: lineup.starterPlayerIds.filter(id => id !== playerId),
    startingGoaliePlayerId: clear(lineup.startingGoaliePlayerId),
    backupGoaliePlayerId: clear(lineup.backupGoaliePlayerId),
  }
  if (role === 'starter' && next.starterPlayerIds.length < HOCKEY_MAX_DEFAULT_STARTERS) {
    next.starterPlayerIds = [...next.starterPlayerIds, playerId].sort()
  }
  if (role === 'starting_goalie') next.startingGoaliePlayerId = playerId
  if (role === 'backup_goalie') next.backupGoaliePlayerId = playerId
  return next
}

/** Default lineup ids that are no longer on the active roster. */
export function staleHockeyLineupPlayerIds(lineup: HockeyLineupDefaults, activeIds: ReadonlySet<string>): string[] {
  return [...lineup.starterPlayerIds, lineup.startingGoaliePlayerId, lineup.backupGoaliePlayerId]
    .filter((id): id is string => id !== null && !activeIds.has(id))
}

function normalizeId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined
}

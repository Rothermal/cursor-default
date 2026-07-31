import type { ShotRecord } from '../types'

/** Raw `shot_chart` row shape as selected from Supabase. */
export type RemoteShotRow = {
  player_id: string
  client_shot_id: string
  x: number | string
  y: number | string
  made: boolean
  shot_type: string
  zone: string
  created_at: string
}

const SHOT_ZONES: ShotRecord['zone'][] = ['restricted', 'paint', 'mid_range', 'three']

export function isMissingLastOpenedColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('last_opened_at') && error.message.includes('column')
}

export function isMissingHomeScoreAdjustmentColumnError(
  error: { message?: string } | null
): boolean {
  if (!error?.message) return false
  return error.message.includes('home_score_adjustment') && error.message.includes('column')
}

export function isMissingHomeTeamScoreColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('home_team_score') && error.message.includes('column')
}

export function isMissingTournamentIdColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('tournament_id') && error.message.includes('column')
}

export function isMissingNotesColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return (
    error.message.includes("'notes'") ||
    (error.message.includes('notes') && error.message.includes('column'))
  )
}

export function isMissingSeasonIdColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('season_id') && error.message.includes('column')
}

export function isMissingSportIdColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('sport_id') && error.message.includes('column')
}

export function isMissingTeamStatsConfigColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('team_stats_config') && error.message.includes('column')
}

export function isMissingGameTeamPlaceholderColumnError(
  error: { message?: string } | null
): boolean {
  if (!error?.message) return false
  const m = error.message
  if (!m.includes('column')) return false
  return m.includes('home_team_player_id') || m.includes('opp_team_player_id')
}

export function isMissingIsTeamPlaceholderColumnError(
  error: { message?: string } | null
): boolean {
  if (!error?.message) return false
  return error.message.includes('is_team_placeholder') && error.message.includes('column')
}

export function isMissingShotChartTableError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  const m = error.message.toLowerCase()
  return (
    (m.includes('shot_chart') && m.includes('relation') && m.includes('does not exist')) ||
    (m.includes('shot_chart') && m.includes('could not find the table'))
  )
}

/**
 * Map remote `shot_chart` rows to local `ShotRecord`s (zone validation, number coercion,
 * remote→local player id lookup). Rows that can't be mapped are counted as dropped.
 * Shared by hydration and the review load path (F3).
 */
export function mapShotRows(
  rows: RemoteShotRow[],
  remoteToLocalPlayerId: Record<string, string>
): { shotChart: ShotRecord[]; droppedRows: number } {
  const shotChart: ShotRecord[] = []
  let droppedRows = 0
  for (const row of rows) {
    const localPlayerId = remoteToLocalPlayerId[row.player_id]
    if (!localPlayerId) {
      droppedRows += 1
      continue
    }
    const z = row.zone as ShotRecord['zone']
    if (!SHOT_ZONES.includes(z)) {
      droppedRows += 1
      continue
    }
    shotChart.push({
      id: row.client_shot_id,
      x: Number(row.x),
      y: Number(row.y),
      made: row.made,
      shotType: row.shot_type === '3pt' ? '3pt' : '2pt',
      zone: z,
      playerId: localPlayerId,
      timestamp: new Date(row.created_at).getTime(),
    })
  }
  return { shotChart, droppedRows }
}

export function invertPlayerIdMap(playerIdMap: Record<string, string>): Record<string, string> {
  const remoteToLocal: Record<string, string> = {}
  for (const [localId, remoteId] of Object.entries(playerIdMap)) {
    remoteToLocal[remoteId] = localId
  }
  return remoteToLocal
}

export function parseSeasonTeamStatsConfig(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  return Object.keys(rec).length > 0 ? rec : null
}

export function parsePlayerName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { firstName: 'Player', lastName: '' }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

/** Same-name teammate already on the cloud roster, with whatever jersey it carries. */
export interface TeamPlayerCandidate {
  playerId: string
  jerseyNumber: string | null
}

export type UnmappedPlayerResolution =
  | { mode: 'reuse_team_match'; playerId: string; adoptJersey: boolean }
  | { mode: 'create_distinct' }
  | { mode: 'reuse_or_create_owned' }

/**
 * Resolve strategy when `playerIdMap` has no entry for a local player.
 *
 * Name-only team matching collapsed siblings / same-named teammates (e.g. two
 * "Alex Kim" rows) onto one cloud `players` row and overwrote the survivor's
 * jersey. Two things prevent that here:
 *
 * 1. `claimedPlayerIds` — cloud rows another local player already resolved to in
 *    this sync are never offered again, so two same-named locals cannot merge even
 *    when neither carries a number.
 * 2. Jersey comparison against the remaining candidates:
 *    - an exact name+jersey teammate is the same person — reuse it;
 *    - a lone same-name teammate with no jersey is the same person who just got a
 *      number — reuse it and adopt the jersey.
 *
 * What this deliberately does **not** do is resolve a changed number. Local
 * "John Smith #23" against cloud "John Smith #12" is indistinguishable from two
 * same-named teammates, so it creates a distinct player rather than guessing.
 * That case is normally covered by the durable `playerIdMap`, which short-circuits
 * before any of this runs; it only surfaces for a player who has never synced. A
 * split identity is recoverable through player merge, whereas a wrong merge is not.
 */
export function resolveUnmappedPlayer(args: {
  candidates: TeamPlayerCandidate[]
  jerseyNumber: string
  claimedPlayerIds?: ReadonlySet<string>
}): UnmappedPlayerResolution {
  const jersey = args.jerseyNumber.trim()
  const claimed = args.claimedPlayerIds ?? new Set<string>()
  // Stable ordering keeps resolution deterministic across syncs.
  const candidates = [...args.candidates]
    .filter(candidate => !claimed.has(candidate.playerId))
    .sort((left, right) => left.playerId.localeCompare(right.playerId))

  if (candidates.length === 0) {
    // Every same-name teammate is already spoken for by another local player, so
    // this must be a different person even without a number to prove it.
    if (args.candidates.length > 0) return { mode: 'create_distinct' }
    return jersey ? { mode: 'create_distinct' } : { mode: 'reuse_or_create_owned' }
  }

  if (!jersey) {
    return { mode: 'reuse_team_match', playerId: candidates[0].playerId, adoptJersey: false }
  }

  const exact = candidates.find(candidate => (candidate.jerseyNumber ?? '').trim() === jersey)
  if (exact) {
    return { mode: 'reuse_team_match', playerId: exact.playerId, adoptJersey: false }
  }

  const unnumbered = candidates.filter(candidate => !(candidate.jerseyNumber ?? '').trim())
  if (unnumbered.length === 1) {
    return { mode: 'reuse_team_match', playerId: unnumbered[0].playerId, adoptJersey: true }
  }

  return { mode: 'create_distinct' }
}

export function getSeasonFromDate(dateIso: string): string {
  const date = new Date(dateIso)
  if (Number.isNaN(date.getTime())) {
    return new Date().getFullYear().toString()
  }

  return date.getFullYear().toString()
}

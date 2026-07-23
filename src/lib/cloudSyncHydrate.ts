import type { Player } from '../types'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from './teamPlayers'
import {
  isMissingGameTeamPlaceholderColumnError,
  isMissingHomeScoreAdjustmentColumnError,
  isMissingHomeTeamScoreColumnError,
  isMissingLastOpenedColumnError,
  isMissingNotesColumnError,
  isMissingSeasonIdColumnError,
  isMissingSportIdColumnError,
  isMissingTournamentIdColumnError,
} from './cloudSyncHelpers'

export type CloudStatRow = {
  player_id: string
  stat_id: string
  value: number
}

export type CloudRosterRow = {
  player_id: string
  jersey_number: string | null
  is_active: boolean
  players: {
    id: string
    first_name: string
    last_name: string | null
    created_at: string
  }
}

export type OptionalGameColumnGaps = {
  lastOpened: boolean
  homeTeamScore: boolean
  homeAdj: boolean
  tournamentId: boolean
  notes: boolean
  seasonId: boolean
  sportId: boolean
  teamPlaceholders: boolean
}

/** Collapse per-row `game_stats` / resolved RPC rows into a player → stat map. */
export function aggregateStatsByPlayer(
  rows: CloudStatRow[] | null | undefined
): Map<string, Record<string, number>> {
  const statsByPlayer = new Map<string, Record<string, number>>()
  for (const row of rows ?? []) {
    const playerId = row.player_id
    const statMap = statsByPlayer.get(playerId) ?? {}
    statMap[row.stat_id] = row.value
    statsByPlayer.set(playerId, statMap)
  }
  return statsByPlayer
}

function playerDisplayName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim()
}

/**
 * Build the local hydrate roster from cloud team_players + optional team placeholders.
 * Inactive roster rows are kept only when they already have stats for this game.
 * Team placeholder cloud ids are excluded from the individual roster and remapped to
 * local `__team_home__` / `__team_opp__` ids in `playerIdMap`.
 */
export function buildHydratedCloudPlayers(input: {
  rosterRows: CloudRosterRow[]
  statsByPlayer: Map<string, Record<string, number>>
  homeCloudId: string | null
  oppCloudId: string | null
  homeTeamName: string
  opponentName: string
  placeholderNameById: Map<string, { first_name: string; last_name: string | null }>
}): {
  players: Player[]
  rosterPlayers: Player[]
  teamPlayers: Player[]
  playerIdMap: Record<string, string>
  activePlayerId: string | null
} {
  const {
    rosterRows,
    statsByPlayer,
    homeCloudId,
    oppCloudId,
    homeTeamName,
    opponentName,
    placeholderNameById,
  } = input

  const rosterPlayers: Player[] = rosterRows
    .filter(row => row.is_active || statsByPlayer.has(row.player_id))
    .filter(
      row =>
        (homeCloudId ? row.player_id !== homeCloudId : true) &&
        (oppCloudId ? row.player_id !== oppCloudId : true)
    )
    .map(row => {
      const p = row.players
      const fullName = playerDisplayName(p.first_name, p.last_name)
      return {
        id: row.player_id,
        name: fullName || 'Player',
        number: row.jersey_number ?? '',
        stats: statsByPlayer.get(row.player_id) ?? {},
      }
    })

  const teamPlayers: Player[] = []
  if (homeCloudId) {
    const meta = placeholderNameById.get(homeCloudId)
    const fromDb = meta ? playerDisplayName(meta.first_name, meta.last_name) : ''
    teamPlayers.push({
      id: TEAM_PLAYER_HOME_ID,
      name: fromDb || homeTeamName || 'Home',
      number: '★',
      stats: statsByPlayer.get(homeCloudId) ?? {},
      isTeamPlayer: true,
      teamSide: 'home',
    })
  }
  if (oppCloudId) {
    const meta = placeholderNameById.get(oppCloudId)
    const fromDb = meta ? playerDisplayName(meta.first_name, meta.last_name) : ''
    teamPlayers.push({
      id: TEAM_PLAYER_OPP_ID,
      name: fromDb || opponentName || 'Opponent',
      number: '★',
      stats: statsByPlayer.get(oppCloudId) ?? {},
      isTeamPlayer: true,
      teamSide: 'opponent',
    })
  }

  const players: Player[] = [...teamPlayers, ...rosterPlayers]

  const playerIdMap: Record<string, string> = {}
  for (const p of rosterPlayers) {
    playerIdMap[p.id] = p.id
  }
  if (homeCloudId) {
    playerIdMap[TEAM_PLAYER_HOME_ID] = homeCloudId
  }
  if (oppCloudId) {
    playerIdMap[TEAM_PLAYER_OPP_ID] = oppCloudId
  }

  return {
    players,
    rosterPlayers,
    teamPlayers,
    playerIdMap,
    activePlayerId: rosterPlayers[0]?.id ?? teamPlayers[0]?.id ?? null,
  }
}

export function detectOptionalGameColumnGaps(
  error: { message?: string } | null
): OptionalGameColumnGaps {
  return {
    lastOpened: isMissingLastOpenedColumnError(error),
    homeTeamScore: isMissingHomeTeamScoreColumnError(error),
    homeAdj: isMissingHomeScoreAdjustmentColumnError(error),
    tournamentId: isMissingTournamentIdColumnError(error),
    notes: isMissingNotesColumnError(error),
    seasonId: isMissingSeasonIdColumnError(error),
    sportId: isMissingSportIdColumnError(error),
    teamPlaceholders: isMissingGameTeamPlaceholderColumnError(error),
  }
}

export function hasAnyOptionalGameColumnGap(gaps: OptionalGameColumnGaps): boolean {
  return (
    gaps.lastOpened ||
    gaps.homeTeamScore ||
    gaps.homeAdj ||
    gaps.tournamentId ||
    gaps.notes ||
    gaps.seasonId ||
    gaps.sportId ||
    gaps.teamPlaceholders
  )
}

/** by-id loads never select `last_opened_at`, so that gap is not recoverable there. */
export function hasLoadByIdOptionalGameColumnGap(gaps: OptionalGameColumnGaps): boolean {
  return (
    gaps.homeTeamScore ||
    gaps.homeAdj ||
    gaps.tournamentId ||
    gaps.notes ||
    gaps.seasonId ||
    gaps.sportId ||
    gaps.teamPlaceholders
  )
}

/**
 * Append still-available optional `games` columns after a missing-column PostgREST error.
 * Pass `includeLastOpened: false` for by-id loads that never select `last_opened_at`.
 */
export function buildOptionalGameSelectSuffix(
  gaps: OptionalGameColumnGaps,
  options: { includeLastOpened?: boolean } = {}
): string {
  const includeLastOpened = options.includeLastOpened !== false
  return (
    (!gaps.homeTeamScore ? ',home_team_score' : '') +
    (!gaps.homeAdj ? ',home_score_adjustment' : '') +
    (!gaps.tournamentId ? ',tournament_id' : '') +
    (!gaps.notes ? ',notes' : '') +
    (includeLastOpened && !gaps.lastOpened ? ',last_opened_at' : '') +
    (!gaps.seasonId ? ',season_id' : '') +
    (!gaps.sportId ? ',sport_id' : '') +
    (!gaps.teamPlaceholders ? ',home_team_player_id,opp_team_player_id' : '')
  )
}

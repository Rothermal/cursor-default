import type { Player } from '../types'

/** Local deterministic ids for team pseudo-players (mapped to cloud `players` rows in sync). */
export const TEAM_PLAYER_HOME_ID = '__team_home__' as const
export const TEAM_PLAYER_OPP_ID = '__team_opp__' as const

const LOCAL_TEAM_PLAYER_IDS = new Set<string>([TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID])

/** True for home/opponent team pseudo-players (team-level stats, not roster individuals). */
export function isTeamPseudoPlayer(player: Pick<Player, 'id' | 'isTeamPlayer'>): boolean {
  if (player.isTeamPlayer === true) return true
  return LOCAL_TEAM_PLAYER_IDS.has(player.id)
}

/**
 * Ensures both team pseudo-players exist without resetting stats on placeholders
 * already in the roster (e.g. hydrated from cloud with only one side linked).
 */
export function mergeTeamPlaceholders(
  players: Player[],
  teamName: string,
  opponentName: string,
): Player[] {
  const existingHome = players.find(p => p.id === TEAM_PLAYER_HOME_ID)
  const existingOpp = players.find(p => p.id === TEAM_PLAYER_OPP_ID)
  if (existingHome && existingOpp) return players

  const homeTeamPlayer: Player =
    existingHome ?? {
      id: TEAM_PLAYER_HOME_ID,
      name: teamName,
      number: '★',
      stats: {},
      isTeamPlayer: true,
      teamSide: 'home',
    }
  const oppTeamPlayer: Player =
    existingOpp ?? {
      id: TEAM_PLAYER_OPP_ID,
      name: opponentName,
      number: '★',
      stats: {},
      isTeamPlayer: true,
      teamSide: 'opponent',
    }

  const withoutPlaceholders = players.filter(
    p => p.id !== TEAM_PLAYER_HOME_ID && p.id !== TEAM_PLAYER_OPP_ID
  )
  return [homeTeamPlayer, oppTeamPlayer, ...withoutPlaceholders]
}

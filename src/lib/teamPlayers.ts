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

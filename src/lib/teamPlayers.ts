import type { Player } from '../types'

const LOCAL_TEAM_PLAYER_IDS = new Set(['__team_home__', '__team_opp__'])

/** True for home/opponent team pseudo-players (team-level stats, not roster individuals). */
export function isTeamPseudoPlayer(player: Pick<Player, 'id' | 'isTeamPlayer'>): boolean {
  if (player.isTeamPlayer === true) return true
  return LOCAL_TEAM_PLAYER_IDS.has(player.id)
}

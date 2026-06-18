import type { Player } from '../types'

/** Local deterministic ids for team pseudo-players (mapped to cloud `players` rows in sync). */
export const TEAM_PLAYER_HOME_ID = '__team_home__' as const
export const TEAM_PLAYER_OPP_ID = '__team_opp__' as const

const LOCAL_TEAM_PLAYER_IDS = new Set<string>([TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID])

/** Returns roster with team pseudo-players prepended, preserving stats on existing placeholders. Null if both already present. */
export function playersWithTeamPlaceholders(
  players: Player[],
  teamName: string,
  opponentName: string
): Player[] | null {
  const hasHome = players.some(p => p.id === TEAM_PLAYER_HOME_ID)
  const hasOpp = players.some(p => p.id === TEAM_PLAYER_OPP_ID)
  if (hasHome && hasOpp) return null

  const existingHome = players.find(p => p.id === TEAM_PLAYER_HOME_ID)
  const existingOpp = players.find(p => p.id === TEAM_PLAYER_OPP_ID)

  const homeTeamPlayer: Player = {
    id: TEAM_PLAYER_HOME_ID,
    name: teamName,
    number: '★',
    stats: existingHome?.stats ?? {},
    isTeamPlayer: true,
    teamSide: 'home',
  }
  const oppTeamPlayer: Player = {
    id: TEAM_PLAYER_OPP_ID,
    name: opponentName,
    number: '★',
    stats: existingOpp?.stats ?? {},
    isTeamPlayer: true,
    teamSide: 'opponent',
  }

  const without = players.filter(
    p => p.id !== TEAM_PLAYER_HOME_ID && p.id !== TEAM_PLAYER_OPP_ID
  )
  return [homeTeamPlayer, oppTeamPlayer, ...without]
}

/** True for home/opponent team pseudo-players (team-level stats, not roster individuals). */
export function isTeamPseudoPlayer(player: Pick<Player, 'id' | 'isTeamPlayer'>): boolean {
  if (player.isTeamPlayer === true) return true
  return LOCAL_TEAM_PLAYER_IDS.has(player.id)
}

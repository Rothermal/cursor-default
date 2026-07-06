import type { Player } from '../types'
import { sideOf } from './shotChartViews'
import { isTeamPseudoPlayer, sortTeamPlayersFirst } from './teamPlayers'

/**
 * F7 assist candidates for a made court shot: same-side individual players,
 * excluding the shooter. Opponent pseudo-player shots have no candidate roster in v1.
 */
export function assistCandidatesForMadeShot(players: Player[], shooterId: string): Player[] {
  const shooter = players.find(player => player.id === shooterId)
  if (!shooter) return []

  const shooterSide = sideOf(shooter)
  if (isTeamPseudoPlayer(shooter) && shooterSide === 'opponent') return []

  return sortTeamPlayersFirst(players).filter(player => {
    if (player.id === shooterId) return false
    if (isTeamPseudoPlayer(player)) return false
    return sideOf(player) === shooterSide
  })
}

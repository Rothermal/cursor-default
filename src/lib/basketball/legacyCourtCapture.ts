import type { Player } from '../../types'
import { isTeamPseudoPlayer } from '../teamPlayers'

/** Legacy scores derive from tracked individuals, not team/opponent shot totals. */
export function legacyBasketballShotActorError(player: Player | undefined): string | null {
  if (!player || isTeamPseudoPlayer(player) || player.teamSide === 'opponent') {
    return 'Choose a tracked player under Log for to record a legacy shot. Use the scoreboard to adjust team or opponent scores.'
  }
  return null
}

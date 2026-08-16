import type { GameState } from '../../types'

/** Cloud finalization is server authority; nonfinal event games remain locally editable. */
export function isFinalBasketballCloudGame(
  state: Pick<GameState, 'cloudSync'>
): boolean {
  return state.cloudSync.gameStatus === 'final'
}

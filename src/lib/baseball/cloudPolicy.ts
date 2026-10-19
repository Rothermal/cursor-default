import type { GameState } from '../../types'

/** A finalized cloud game is server authority: the tracker is read-only until a manager reopens it. */
export function isFinalBaseballCloudGame(state: Pick<GameState, 'cloudSync'>): boolean {
  return state.cloudSync.gameStatus === 'final'
}

export const BASEBALL_FINAL_CLOUD_GAME_MESSAGE = 'Reopen the finalized game before editing it.'

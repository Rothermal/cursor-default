import type { GameState } from '../../types'
import { isCurrentAuthUser } from '../authIdentity'

/** A finalized cloud game is server authority: the tracker is read-only until a manager reopens it. */
export function isFinalBaseballCloudGame(state: Pick<GameState, 'cloudSync'>): boolean {
  return state.cloudSync.gameStatus === 'final'
}

export const BASEBALL_FINAL_CLOUD_GAME_MESSAGE = 'Reopen the finalized game before editing it.'

export function assertBaseballCloudAccount(userId: string | null): void {
  if (!userId || !isCurrentAuthUser(userId)) throw new Error('The signed-in account changed. Open the Baseball game again.')
}

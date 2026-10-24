import type { GameAction, GameState } from '../../types'
import { isLegacyGameForSport, legacyRetiredGameBinding, retiredGameAuthorityForHydration } from '../legacyGameRetirement'
export { canFinalizeAggregateGame } from '../legacyGameRetirement'

/** Rollback stops new creation only. Never restore aggregate capture or hide saved games. */
export const BASEBALL_NEW_GAME_CREATION_ENABLED = true

type AuthorityState = Partial<Pick<GameState, 'sport' | 'gameDataAuthority' | 'eventStream' | 'sportGameState'>>

export function isLegacyBaseballGame(state: AuthorityState): boolean {
  return isLegacyGameForSport(state, 'baseball')
}

/** Preserve an event marker before malformed setup/stream normalization can erase it. */
export function baseballAuthorityForHydration(state: AuthorityState): GameState['gameDataAuthority'] {
  return retiredGameAuthorityForHydration(state)
}

export function legacyBaseballBinding(
  current: GameState,
  records: ReadonlyArray<{ localGameId: string; gameState: GameState }>,
  gameId: string
): { kind: 'active' } | { kind: 'parked'; localGameId: string } | null {
  return legacyRetiredGameBinding(current, records, gameId, 'baseball')
}

export function blocksRetiredBaseballMutation(state: AuthorityState, action: GameAction): boolean {
  if (action.type === 'SET_SPORT' && action.sport.id === 'baseball') return true
  // Transport hydration/settlement and explicit parking/reset remain data-management operations.
  return isLegacyBaseballGame(state) && ![
    'HYDRATE_STATE', 'SET_CLOUD_SYNC_STATE', 'RESET_GAME', 'SET_SPORT',
  ].includes(action.type)
}

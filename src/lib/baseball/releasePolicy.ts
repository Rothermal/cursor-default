import type { GameAction, GameState } from '../../types'

/** Rollback stops new creation only. Never restore aggregate capture or hide saved games. */
export const BASEBALL_NEW_GAME_CREATION_ENABLED = true

type AuthorityState = Partial<Pick<GameState, 'sport' | 'gameDataAuthority' | 'eventStream' | 'sportGameState'>>

export function isLegacyBaseballGame(state: AuthorityState): boolean {
  return state.sport?.id === 'baseball' && state.gameDataAuthority !== 'sport_events'
    && !state.eventStream && !state.sportGameState
}

/** Preserve an event marker before malformed setup/stream normalization can erase it. */
export function baseballAuthorityForHydration(state: AuthorityState): GameState['gameDataAuthority'] {
  return (state.sport?.id === 'baseball' && !isLegacyBaseballGame(state)) || state.gameDataAuthority === 'sport_events'
    ? 'sport_events' : null
}

export function legacyBaseballBinding(
  current: GameState,
  records: ReadonlyArray<{ localGameId: string; gameState: GameState }>,
  gameId: string
): { kind: 'active' } | { kind: 'parked'; localGameId: string } | null {
  const matches = records.filter(record => record.gameState.cloudSync.gameId === gameId)
  if (matches.length > 1 || matches.some(record => !isLegacyBaseballGame(record.gameState))) {
    throw Error('This cloud game has conflicting local bindings. Review local game exports before opening it.')
  }
  if (current.cloudSync.gameId === gameId) {
    if (!isLegacyBaseballGame(current)) throw Error('The local game has incompatible authority. Its saved data was preserved.')
    return { kind: 'active' }
  }
  return matches[0] ? { kind: 'parked', localGameId: matches[0].localGameId } : null
}

export function canFinalizeAggregateGame(state: AuthorityState): boolean {
  return state.sport?.id !== 'baseball' && state.gameDataAuthority !== 'sport_events'
    && !state.eventStream && !state.sportGameState
}

export function blocksRetiredBaseballMutation(state: AuthorityState, action: GameAction): boolean {
  if (action.type === 'SET_SPORT' && action.sport.id === 'baseball') return true
  // Transport hydration/settlement and explicit parking/reset remain data-management operations.
  return isLegacyBaseballGame(state) && ![
    'HYDRATE_STATE', 'SET_CLOUD_SYNC_STATE', 'RESET_GAME', 'SET_SPORT',
  ].includes(action.type)
}

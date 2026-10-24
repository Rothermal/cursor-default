import type { GameAction, GameState } from '../types'

export type LegacyAuthorityState = Partial<Pick<GameState, 'sport' | 'gameDataAuthority' | 'eventStream' | 'sportGameState'>>
export type RetiredLegacySport = 'basketball' | 'baseball'

export function isLegacyGameForSport(state: LegacyAuthorityState, sportId: RetiredLegacySport): boolean {
  return state.sport?.id === sportId && state.gameDataAuthority == null
    && state.eventStream == null && state.sportGameState == null
}

export function isRetiredLegacyGame(state: LegacyAuthorityState): boolean {
  return isLegacyGameForSport(state, 'basketball') || isLegacyGameForSport(state, 'baseball')
}

/** Preserve event authority before malformed stream/setup normalization can erase its markers. */
export function retiredGameAuthorityForHydration(state: LegacyAuthorityState): GameState['gameDataAuthority'] {
  const retiredSport = state.sport?.id === 'basketball' || state.sport?.id === 'baseball'
  return (retiredSport && !isRetiredLegacyGame(state)) || state.gameDataAuthority === 'sport_events'
    ? 'sport_events' : null
}

export function legacyRetiredGameBinding(
  current: GameState,
  records: ReadonlyArray<{ localGameId: string; gameState: GameState }>,
  gameId: string,
  sportId: RetiredLegacySport
): { kind: 'active' } | { kind: 'parked'; localGameId: string } | null {
  const matches = records.filter(record => record.gameState.cloudSync.gameId === gameId)
  if (matches.length > 1 || matches.some(record => !isLegacyGameForSport(record.gameState, sportId))) {
    throw Error('This cloud game has conflicting local bindings. Review local game exports before opening it.')
  }
  if (current.cloudSync.gameId === gameId) {
    if (!isLegacyGameForSport(current, sportId)) throw Error('The local game has incompatible authority. Its saved data was preserved.')
    return { kind: 'active' }
  }
  return matches[0] ? { kind: 'parked', localGameId: matches[0].localGameId } : null
}

export function canFinalizeAggregateGame(state: LegacyAuthorityState): boolean {
  return state.sport?.id !== 'basketball' && state.sport?.id !== 'baseball'
    && state.gameDataAuthority == null && state.eventStream == null && state.sportGameState == null
}

export function blocksRetiredLegacyMutation(state: LegacyAuthorityState, action: GameAction): boolean {
  if (action.type === 'SET_SPORT' && ['basketball', 'baseball'].includes(action.sport.id)) return true
  // Transport settlement, explicit replacement and reset must still preserve/drain saved facts.
  return isRetiredLegacyGame(state) && ![
    'HYDRATE_STATE', 'SET_CLOUD_SYNC_STATE', 'RESET_GAME', 'SET_SPORT',
  ].includes(action.type)
}

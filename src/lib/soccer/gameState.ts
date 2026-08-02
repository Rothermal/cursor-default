import type { GameState } from '../../types'
import type { GameEventStream } from '../gameEvents/types'
import type { SoccerSportGameState } from './types'

export type SoccerGameState = Omit<GameState, 'sportGameState'> & {
  sportGameState: SoccerSportGameState
}

export type SoccerEventGameState = Omit<SoccerGameState, 'eventStream'> & {
  eventStream: GameEventStream
}

export function requireSoccerGameState(state: GameState): SoccerGameState {
  if (state.sportGameState?.sportId !== 'soccer') {
    throw new Error('Soccer match state is unavailable.')
  }
  return state as SoccerGameState
}

export function requireSoccerEventGameState(state: GameState): SoccerEventGameState {
  if (state.sportGameState?.sportId !== 'soccer' || !state.eventStream) {
    throw new Error('Initialized Soccer match state is unavailable.')
  }
  return state as SoccerEventGameState
}

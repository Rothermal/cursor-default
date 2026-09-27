import type { BaseballSportGameState } from '../baseball/types'
import type { BasketballSportGameState } from '../basketball/types'
import type { SoccerSportGameState } from '../soccer/types'

export type SportGameState = BasketballSportGameState | SoccerSportGameState | BaseballSportGameState

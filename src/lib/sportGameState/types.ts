import type { BaseballSportGameState } from '../baseball/types'
import type { BasketballSportGameState } from '../basketball/types'
import type { HockeySportGameState } from '../hockey/types'
import type { SoccerSportGameState } from '../soccer/types'

export type SportGameState =
  | BasketballSportGameState
  | SoccerSportGameState
  | BaseballSportGameState
  | HockeySportGameState

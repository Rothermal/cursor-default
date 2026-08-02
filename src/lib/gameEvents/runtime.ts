import { GameEventProjectorRegistry } from './projection'
import { GameEventRegistry } from './registry'
import { soccerEventDefinitions } from '../soccer/events'
import { soccerGameEventProjector } from '../soccer/projector'
import { basketballEventDefinitions } from '../basketball/events'
import { basketballGameEventProjector } from '../basketball/projector'

export const gameEventRegistry = new GameEventRegistry([
  ...soccerEventDefinitions,
  ...basketballEventDefinitions,
])
export const gameEventProjectors = new GameEventProjectorRegistry([
  soccerGameEventProjector,
  basketballGameEventProjector,
])

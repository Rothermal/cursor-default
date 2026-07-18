import { GameEventProjectorRegistry } from './projection'
import { GameEventRegistry } from './registry'
import { soccerEventDefinitions } from '../soccer/events'
import { soccerGameEventProjector } from '../soccer/projector'

export const gameEventRegistry = new GameEventRegistry(soccerEventDefinitions)
export const gameEventProjectors = new GameEventProjectorRegistry([soccerGameEventProjector])

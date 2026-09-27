import { GameEventProjectorRegistry } from './projection'
import { GameEventRegistry } from './registry'
import { soccerEventDefinitions } from '../soccer/events'
import { soccerGameEventProjector } from '../soccer/projector'
import { basketballEventDefinitions } from '../basketball/events'
import { basketballGameEventProjector } from '../basketball/projector'
import { baseballEventDefinitions } from '../baseball/events'
import { baseballGameEventProjector } from '../baseball/projector'
import { hockeyEventDefinitions } from '../hockey/events'
import { hockeyGameEventProjector } from '../hockey/projector'

export const gameEventRegistry = new GameEventRegistry([
  ...soccerEventDefinitions,
  ...basketballEventDefinitions,
  ...baseballEventDefinitions,
  ...hockeyEventDefinitions,
])
export const gameEventProjectors = new GameEventProjectorRegistry([
  soccerGameEventProjector,
  basketballGameEventProjector,
  baseballGameEventProjector,
  hockeyGameEventProjector,
])

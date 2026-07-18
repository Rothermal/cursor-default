import { GameEventProjectorRegistry } from './projection'
import { GameEventRegistry } from './registry'

/** Production definitions are added by sport phases; SOC-1 intentionally leaves these empty. */
export const gameEventRegistry = new GameEventRegistry()
export const gameEventProjectors = new GameEventProjectorRegistry()

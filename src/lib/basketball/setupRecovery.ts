import type { GameState } from '../../types'
import { hasStartedBasketballEventGame, isBasketballEventSetupIntent } from './commands'

/** Re-review is only for the current pre-start game, never an explicit new-game route. */
export function canReviewCurrentBasketballSetup(state: GameState, params: URLSearchParams): boolean {
  return params.get('reviewCurrent') === '1' &&
    !params.get('teamId') && !params.get('sport') &&
    isBasketballEventSetupIntent(state) && !hasStartedBasketballEventGame(state)
}

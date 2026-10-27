import type { GameEventActor } from '../gameEvents/types'
import type { BasketballTeamSide } from './types'

/** Team credit is available only for opponents; tracked free throws stay individual. */
export function isBasketballFreeThrowShooter(side: BasketballTeamSide, actor: GameEventActor): boolean {
  return actor.kind === 'player' || (side === 'opponent' && actor.kind === 'team')
}

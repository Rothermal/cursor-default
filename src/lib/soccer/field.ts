import type { GameEventLocation } from '../gameEvents/types'
import type { SoccerAttackingDirection } from './types'

export function soccerFieldLocation(
  displayX: number,
  displayY: number,
  flipped: boolean,
  attackingDirection: SoccerAttackingDirection
): GameEventLocation {
  const x = clamp(displayX)
  const y = clamp(displayY)
  return {
    x: flipped ? 1 - x : x,
    y: flipped ? 1 - y : y,
    attackingDirection,
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

import type { GameEventLocation } from '../gameEvents/types'

/**
 * Converts a tap on a horizontal playing surface into a canonical location.
 * Display coordinates are normalized 0..1 and clamped; a flipped (180-degree)
 * view is undone so stored coordinates never depend on the view.
 */
export function surfaceLocation(
  displayX: number,
  displayY: number,
  flipped: boolean,
  attackingDirection: GameEventLocation['attackingDirection']
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

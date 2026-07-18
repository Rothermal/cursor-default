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

interface SoccerFieldEventCandidate {
  eventType: string
  teamSide: 'tracked' | 'opponent'
  period: { id: string }
  location: GameEventLocation | null
}

export function soccerFieldReviewEvents<TEvent extends SoccerFieldEventCandidate>(
  events: TEvent[],
  filters: {
    side: 'all' | 'tracked' | 'opponent'
    scope: 'current' | 'match'
    periodId: string | null
  }
): TEvent[] {
  return events
    .filter(event => event.location !== null && (
      event.eventType === 'soccer.shot' || event.eventType === 'soccer.own_goal'
    ))
    .filter(event => filters.scope === 'match' || event.period.id === filters.periodId)
    .filter(event => filters.side === 'all' || event.teamSide === filters.side)
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

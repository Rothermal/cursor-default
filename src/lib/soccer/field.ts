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
  id: string
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
    family?: 'all' | 'shots' | 'defense' | 'incidents'
  }
): TEvent[] {
  return events
    .filter(event => event.location !== null && soccerFieldEventFamily(event.eventType) !== null)
    .filter(event => !filters.family || filters.family === 'all' ||
      soccerFieldEventFamily(event.eventType) === filters.family)
    .filter(event => filters.scope === 'match' || event.period.id === filters.periodId)
    .filter(event => filters.side === 'all' || event.teamSide === filters.side)
}

export function soccerFieldEventFamily(
  eventType: string
): 'shots' | 'defense' | 'incidents' | null {
  if (eventType === 'soccer.shot' || eventType === 'soccer.own_goal') return 'shots'
  if (eventType === 'soccer.defensive_action') return 'defense'
  if (eventType === 'soccer.foul' || eventType === 'soccer.card' || eventType === 'soccer.team_event') {
    return 'incidents'
  }
  return null
}

export interface SoccerMarkerPoint {
  id: string
  x: number
  y: number
}

export function clusterSoccerMarkerPoints<TPoint extends SoccerMarkerPoint>(
  points: TPoint[],
  threshold = 0.035
): TPoint[][] {
  const clusters: TPoint[][] = []
  for (const point of points) {
    const cluster = clusters.find(items => items.some(item =>
      Math.hypot(item.x - point.x, item.y - point.y) <= threshold
    ))
    if (cluster) cluster.push(point)
    else clusters.push([point])
  }
  return clusters
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

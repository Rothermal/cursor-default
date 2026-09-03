import type { GameEvent, GameEventLocation } from '../gameEvents/types'
import type {
  SoccerAttackingDirection,
  SoccerTeamEventKind,
} from './types'

const RESTART_BOUNDARY_THRESHOLD = 0.08
const GOAL_AREA_HALF_WIDTH = 0.15

type SuggestedSoccerRestartKind = Extract<
  SoccerTeamEventKind,
  'corner' | 'throw_in' | 'goal_kick'
>

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

export function suggestSoccerRestartKind(
  location: Pick<GameEventLocation, 'x' | 'y'>,
  teamSide: 'tracked' | 'opponent',
  trackedAttackingDirection: SoccerAttackingDirection
): SuggestedSoccerRestartKind | null {
  if (
    !Number.isFinite(location.x) ||
    !Number.isFinite(location.y) ||
    location.x < 0 ||
    location.x > 1 ||
    location.y < 0 ||
    location.y > 1
  ) return null

  const attackingDirection = teamSide === 'tracked'
    ? trackedAttackingDirection
    : oppositeDirection(trackedAttackingDirection)
  const nearAttackingEnd = attackingDirection === 'left_to_right'
    ? location.x >= 1 - RESTART_BOUNDARY_THRESHOLD
    : location.x <= RESTART_BOUNDARY_THRESHOLD
  const nearDefendingEnd = attackingDirection === 'left_to_right'
    ? location.x <= RESTART_BOUNDARY_THRESHOLD
    : location.x >= 1 - RESTART_BOUNDARY_THRESHOLD
  const nearTouchline = location.y <= RESTART_BOUNDARY_THRESHOLD ||
    location.y >= 1 - RESTART_BOUNDARY_THRESHOLD

  if (nearAttackingEnd && nearTouchline) return 'corner'
  if (nearTouchline) return 'throw_in'
  if (nearDefendingEnd && Math.abs(location.y - 0.5) <= GOAL_AREA_HALF_WIDTH) {
    return 'goal_kick'
  }
  return null
}

export function isSoccerLocatedEditableEvent(
  event: Pick<GameEvent, 'eventType' | 'period'>
): boolean {
  return event.eventType === 'soccer.shot' ||
    event.eventType === 'soccer.own_goal' ||
    event.eventType === 'soccer.defensive_action' ||
    event.eventType === 'soccer.foul' ||
    (event.eventType === 'soccer.card' && event.period.id !== 'shootout') ||
    event.eventType === 'soccer.team_event'
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
  const ordered = [...points].sort(
    (left, right) =>
      left.x - right.x ||
      left.y - right.y ||
      left.id.localeCompare(right.id)
  )
  const clusters: TPoint[][] = []
  for (const point of ordered) {
    const cluster = clusters.find(items => items.some(item =>
      Math.hypot(item.x - point.x, item.y - point.y) <= threshold
    ))
    if (cluster) cluster.push(point)
    else clusters.push([point])
  }
  return clusters.map(cluster =>
    cluster.sort((left, right) => left.id.localeCompare(right.id))
  )
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function oppositeDirection(direction: SoccerAttackingDirection): SoccerAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

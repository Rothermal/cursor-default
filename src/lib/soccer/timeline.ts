import type { GameEvent } from '../gameEvents/types'
import type { SoccerPeriodTiming } from './live'
import { formatSoccerDuration } from './live'
import type { SoccerTeamEventKind } from './types'

export type SoccerTimelineFilter =
  | 'all'
  | 'attacking'
  | 'defensive'
  | 'discipline'
  | 'team_events'
  | 'match_control'

export interface SoccerTeamEventReviewPresentation {
  actorLabel: string
  kindLabel: string
  label: string
  sideLabel: string
}

const TEAM_EVENT_KIND_LABELS: Record<SoccerTeamEventKind, string> = {
  corner: 'Corner',
  offside: 'Offside',
  throw_in: 'Throw-in',
  goal_kick: 'Goal kick',
}

export function soccerTeamEventReviewPresentation(
  event: Pick<GameEvent, 'actors' | 'payload' | 'teamSide'>
): SoccerTeamEventReviewPresentation {
  const kind = (event.payload as { kind?: unknown }).kind
  const kindLabel = typeof kind === 'string' && kind in TEAM_EVENT_KIND_LABELS
    ? TEAM_EVENT_KIND_LABELS[kind as SoccerTeamEventKind]
    : 'Team event'
  const actorRole = kind === 'offside' ? 'offside_player' : 'taker'
  const actor = event.actors.find(candidate => candidate.role === actorRole)
  const actorLabel = actor?.label?.trim() || (
    kind === 'offside' ? 'Player not recorded' : 'Taker not recorded'
  )
  const sideLabel = event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'
  return {
    actorLabel,
    kindLabel,
    label: `${sideLabel} ${kindLabel.toLowerCase()} - ${actorLabel}`,
    sideLabel,
  }
}

export function isSoccerAttackingEventType(eventType: string): boolean {
  return eventType === 'soccer.shot' ||
    eventType === 'soccer.own_goal' ||
    eventType === 'soccer.score_adjustment'
}

export function soccerEventMatchesTimelineFilter(
  event: Pick<GameEvent, 'eventType'>,
  filter: SoccerTimelineFilter
): boolean {
  if (filter === 'all') return true
  if (filter === 'attacking') return isSoccerAttackingEventType(event.eventType)
  if (filter === 'defensive') return event.eventType === 'soccer.defensive_action'
  if (filter === 'discipline') {
    return event.eventType === 'soccer.foul' || event.eventType === 'soccer.card'
  }
  if (filter === 'team_events') return event.eventType === 'soccer.team_event'
  return !isSoccerAttackingEventType(event.eventType) &&
    event.eventType !== 'soccer.defensive_action' &&
    event.eventType !== 'soccer.foul' &&
    event.eventType !== 'soccer.card' &&
    event.eventType !== 'soccer.team_event'
}

export function isSoccerScoringEvent(event: Pick<GameEvent, 'eventType' | 'payload'>): boolean {
  return event.eventType === 'soccer.own_goal' ||
    event.eventType === 'soccer.score_adjustment' ||
    (event.eventType === 'soccer.shot' && (event.payload as { outcome?: unknown }).outcome === 'goal')
}

export function soccerEventTimeLabel(
  event: Pick<GameEvent, 'elapsedMs' | 'period'>,
  timings: SoccerPeriodTiming[]
): string {
  if (event.elapsedMs === null) return event.period.id === 'shootout' ? 'Shootout' : 'No match time'
  const timing = timings.find(item => item.period.id === event.period.id)
  return timing
    ? `${timing.label} · ${formatSoccerDuration(Math.max(0, event.elapsedMs - timing.startElapsedMs))}`
    : formatSoccerDuration(event.elapsedMs)
}

/** Formats elapsed ms as `M:SS` for soccer correction/clock inputs (not zero-padded minutes). */
export function formatSoccerInputTime(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Parses `M:SS` / `MM:SS` clock input into elapsed ms; rejects invalid seconds. */
export function parseSoccerInputTime(value: string): number | null {
  const match = value.trim().match(/^(\d+):([0-5]\d)$/)
  if (!match) return null
  return (Number(match[1]) * 60 + Number(match[2])) * 1_000
}

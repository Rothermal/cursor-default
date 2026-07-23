import type { GameState } from '../../types'
import { compareGameEvents } from '../gameEvents'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { formatSoccerDuration, soccerPeriodTimings } from './live'
import { isSoccerScoringEvent } from './timeline'

export type SoccerSummaryTimelineFilter =
  | 'all'
  | 'scoring'
  | 'attack'
  | 'defense'
  | 'restarts'
  | 'discipline'
  | 'lineup'
  | 'match_control'

export const SOCCER_SUMMARY_TIMELINE_FILTERS: ReadonlyArray<{
  id: SoccerSummaryTimelineFilter
  label: string
}> = [
  { id: 'all', label: 'All' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'attack', label: 'Attack' },
  { id: 'defense', label: 'Defense' },
  { id: 'restarts', label: 'Restarts' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'lineup', label: 'Lineup' },
  { id: 'match_control', label: 'Match Control' },
]

export interface SoccerSummaryTimelineRow {
  event: GameEvent
  timeLabel: string
  corrected: boolean
}

export interface SoccerSummaryTimelineSection {
  periodId: string
  periodOrder: number
  label: string
  rows: SoccerSummaryTimelineRow[]
}

export interface SoccerSummaryTimelineReview {
  activeSections: SoccerSummaryTimelineSection[]
  removedSections: SoccerSummaryTimelineSection[]
  activeCount: number
  removedCount: number
}

export function canEditSoccerSummaryTimeline(source: {
  kind: 'local' | 'cloud_primary' | 'cloud_recording' | 'canonical'
  editable: boolean
}): boolean {
  return source.kind === 'local' && source.editable
}

export function soccerSummaryTimelineReview(
  state: GameState,
  inspection: GameEventInspection<GameEvent>,
  filter: SoccerSummaryTimelineFilter
): SoccerSummaryTimelineReview {
  const timings = soccerPeriodTimings(state)
  const labels = new Map(timings.map(timing => [timing.period.id, timing.label]))
  const starts = new Map(
    timings.map(timing => [timing.period.id, timing.startElapsedMs])
  )
  const buildSections = (events: GameEvent[]) =>
    groupTimelineRows(
      events
        .filter(isSoccerSummaryTimelineEvent)
        .filter(event => soccerSummaryEventMatchesFilter(event, filter))
        .sort(compareGameEvents)
        .map(event => ({
          event,
          timeLabel: summaryEventTimeLabel(event, starts.get(event.period.id)),
          corrected: event.revision > 1,
        })),
      labels
    )

  const activeSections = buildSections([...inspection.activeEvents])
  const removedSections = buildSections([...inspection.deletedEvents])
  return {
    activeSections,
    removedSections,
    activeCount: activeSections.reduce((count, section) => count + section.rows.length, 0),
    removedCount: removedSections.reduce((count, section) => count + section.rows.length, 0),
  }
}

export function isSoccerSummaryTimelineEvent(
  event: Pick<GameEvent, 'eventType'>
): boolean {
  return event.eventType !== 'soccer.shootout_kick'
}

export function soccerSummaryEventMatchesFilter(
  event: Pick<GameEvent, 'eventType' | 'payload'>,
  filter: SoccerSummaryTimelineFilter
): boolean {
  if (!isSoccerSummaryTimelineEvent(event)) return false
  if (filter === 'all') return true
  if (filter === 'scoring') return isSoccerScoringEvent(event)
  if (filter === 'attack') {
    return event.eventType === 'soccer.shot' || event.eventType === 'soccer.own_goal'
  }
  if (filter === 'defense') return event.eventType === 'soccer.defensive_action'
  if (filter === 'restarts') {
    return event.eventType === 'soccer.foul' ||
      event.eventType === 'soccer.team_event' ||
      (
        event.eventType === 'soccer.shot' &&
        typeof (event.payload as { sourceEventId?: unknown }).sourceEventId === 'string'
      )
  }
  if (filter === 'discipline') {
    return event.eventType === 'soccer.card' ||
      (
        event.eventType === 'soccer.foul' &&
        (event.payload as { sanction?: unknown }).sanction !== 'none'
      )
  }
  if (filter === 'lineup') {
    if (
      event.eventType === 'soccer.opening_lineup' ||
      event.eventType === 'soccer.substitution_window' ||
      event.eventType === 'soccer.role_changed' ||
      event.eventType === 'soccer.match_roster_added' ||
      event.eventType === 'soccer.participant_resolved'
    ) return true
    return (
      (event.eventType === 'soccer.foul' || event.eventType === 'soccer.card') &&
      Boolean((event.payload as { lineupResolution?: unknown }).lineupResolution)
    )
  }
  return MATCH_CONTROL_EVENTS.has(event.eventType)
}

const MATCH_CONTROL_EVENTS = new Set([
  'soccer.period_started',
  'soccer.period_ended',
  'soccer.clock_started',
  'soccer.clock_paused',
  'soccer.clock_adjusted',
  'soccer.match_rules_changed',
  'soccer.attacking_direction_changed',
  'soccer.match_ended',
  'soccer.match_reopened',
  'soccer.shootout_started',
  'soccer.shootout_eligibility_changed',
  'soccer.shootout_goalkeeper_changed',
])

function groupTimelineRows(
  rows: SoccerSummaryTimelineRow[],
  labels: Map<string, string>
): SoccerSummaryTimelineSection[] {
  const sections = new Map<string, SoccerSummaryTimelineSection>()
  for (const row of rows) {
    const { id, order } = row.event.period
    let section = sections.get(id)
    if (!section) {
      section = {
        periodId: id,
        periodOrder: order,
        label: labels.get(id) ?? periodLabel(id),
        rows: [],
      }
      sections.set(id, section)
    }
    section.rows.push(row)
  }
  return [...sections.values()].sort(
    (left, right) =>
      left.periodOrder - right.periodOrder ||
      left.periodId.localeCompare(right.periodId)
  )
}

function summaryEventTimeLabel(
  event: GameEvent,
  periodStartElapsedMs: number | undefined
): string {
  if (event.elapsedMs === null) return 'Untimed'
  return formatSoccerDuration(
    Math.max(0, event.elapsedMs - (periodStartElapsedMs ?? 0))
  ).replace(/^0(?=\d:)/, '')
}

function periodLabel(periodId: string): string {
  if (periodId === 'shootout') return 'Shootout'
  return periodId
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

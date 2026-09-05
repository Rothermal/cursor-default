import type { GameState } from '../../types'
import { compareGameEvents } from '../gameEvents'
import type {
  GameEvent,
  GameEventInspection,
  GameEventLocation,
} from '../gameEvents/types'
import type {
  SoccerCardEvent,
  SoccerDefensiveActionEvent,
  SoccerFoulEvent,
  SoccerOwnGoalEvent,
  SoccerShotEvent,
  SoccerSportGameState,
  SoccerTeamEventEvent,
  SoccerTeamSide,
} from './types'
import {
  soccerEventTimeLabel,
  soccerTeamEventReviewPresentation,
} from './timeline'
import { soccerPeriodTimings } from './live'

export type SoccerFieldReviewOrientation = 'normalized' | 'original'
export type SoccerFieldReviewSide = 'all' | SoccerTeamSide
export type SoccerFieldReviewFamily =
  | 'attack'
  | 'defense'
  | 'restarts'
  | 'discipline'
export type SoccerFieldReviewPeriod =
  | 'full_match'
  | 'regulation'
  | 'extra_time'
  | string
export type SoccerFieldReviewParticipant = 'all' | 'unknown' | string

export const SOCCER_FIELD_REVIEW_FAMILIES: ReadonlyArray<{
  id: SoccerFieldReviewFamily
  label: string
}> = [
  { id: 'attack', label: 'Attack' },
  { id: 'defense', label: 'Defense' },
  { id: 'restarts', label: 'Restarts' },
  { id: 'discipline', label: 'Discipline' },
]

export interface SoccerFieldReviewFilters {
  orientation: SoccerFieldReviewOrientation
  side: SoccerFieldReviewSide
  families: readonly SoccerFieldReviewFamily[]
  participant: SoccerFieldReviewParticipant
  period: SoccerFieldReviewPeriod
}

export interface SoccerFieldReviewParticipantOption {
  id: SoccerFieldReviewParticipant
  label: string
}

export interface SoccerFieldReviewPeriodOption {
  id: SoccerFieldReviewPeriod
  label: string
}

export interface SoccerFieldReviewEvent {
  event: SoccerFieldReviewMatchEvent
  families: SoccerFieldReviewFamily[]
  participantIds: string[]
  participantLabel: string
  periodLabel: string
  timeLabel: string
  title: string
  detail: string | null
  displayLocation: GameEventLocation | null
  markerKind:
    | 'goal' | 'saved' | 'blocked' | 'off_target' | 'woodwork' | 'own_goal'
    | 'tackle_won' | 'tackle_lost' | 'interception' | 'clearance' | 'recovery'
    | 'foul' | 'yellow_card' | 'red_card'
    | 'corner' | 'throw_in' | 'goal_kick' | 'offside'
}

type SoccerFieldReviewMatchEvent =
  | SoccerShotEvent
  | SoccerOwnGoalEvent
  | SoccerDefensiveActionEvent
  | SoccerFoulEvent
  | SoccerCardEvent
  | SoccerTeamEventEvent

export interface SoccerFieldReview {
  events: SoccerFieldReviewEvent[]
  locatedEvents: SoccerFieldReviewEvent[]
  unknownLocationCount: number
  participantOptions: SoccerFieldReviewParticipantOption[]
  periodOptions: SoccerFieldReviewPeriodOption[]
}

export function canEditSoccerSummaryField(source: {
  kind: 'local' | 'cloud_primary' | 'cloud_recording' | 'canonical'
  editable: boolean
}): boolean {
  return source.kind === 'local' && source.editable
}

export function soccerSummaryFieldReview(
  state: GameState,
  inspection: GameEventInspection<GameEvent>,
  filters: SoccerFieldReviewFilters
): SoccerFieldReview {
  const sportState = soccerSportState(state)
  if (!sportState) {
    return {
      events: [],
      locatedEvents: [],
      unknownLocationCount: 0,
      participantOptions: [{ id: 'all', label: 'All participants' }],
      periodOptions: [{ id: 'full_match', label: 'Full Match' }],
    }
  }

  const timings = soccerPeriodTimings(state)
  const periodLabels = new Map(
    sportState.projection.currentRules.regulationSegments
      .concat(sportState.projection.currentRules.extraTimeSegments)
      .map(segment => [segment.id, segment.label])
  )
  const participantOptions = fieldParticipantOptions(
    sportState,
    inspection.activeEvents,
    filters.side
  )
  const periodOptions = fieldPeriodOptions(sportState)
  const selectedFamilies = new Set(filters.families)
  const events = inspection.activeEvents
    .filter(event => event.period.id !== 'shootout')
    .flatMap(event => {
      const families = soccerFieldReviewFamilies(event)
      if (families.length === 0) return []
      const soccerEvent = event as SoccerFieldReviewMatchEvent
      return [{
        event: soccerEvent,
        families,
        participantIds: eventParticipantIds(soccerEvent).filter(id =>
          Boolean(sportState.projection.participants[id])
        ),
        participantLabel: eventParticipantLabel(soccerEvent),
        periodLabel: periodLabels.get(soccerEvent.period.id) ?? soccerEvent.period.id,
        timeLabel: soccerEventTimeLabel(soccerEvent, timings),
        title: soccerFieldReviewTitle(soccerEvent),
        detail: soccerFieldReviewDetail(soccerEvent),
        displayLocation: transformFieldLocation(soccerEvent.location, filters.orientation),
        markerKind: soccerFieldReviewMarkerKind(soccerEvent),
      } satisfies SoccerFieldReviewEvent]
    })
    .filter(item =>
      filters.side === 'all' || item.event.teamSide === filters.side
    )
    .filter(item =>
      selectedFamilies.size > 0 &&
      item.families.some(family => selectedFamilies.has(family))
    )
    .filter(item => matchesParticipant(item, filters.participant))
    .filter(item => matchesPeriod(sportState, item.event, filters.period))
    .sort((left, right) => compareGameEvents(left.event, right.event))

  return {
    events,
    locatedEvents: events.filter(item => item.displayLocation !== null),
    unknownLocationCount: events.filter(item => item.displayLocation === null).length,
    participantOptions,
    periodOptions,
  }
}

export function soccerFieldReviewFamilies(
  event: Pick<GameEvent, 'eventType' | 'payload'>
): SoccerFieldReviewFamily[] {
  if (event.eventType === 'soccer.shot') {
    return (event.payload as { outcome?: unknown }).outcome === 'blocked'
      ? ['attack', 'defense']
      : ['attack']
  }
  if (event.eventType === 'soccer.own_goal') return ['attack']
  if (event.eventType === 'soccer.defensive_action') return ['defense']
  if (event.eventType === 'soccer.foul') {
    return (event.payload as { sanction?: unknown }).sanction === 'none'
      ? ['restarts']
      : ['restarts', 'discipline']
  }
  if (event.eventType === 'soccer.card') return ['discipline']
  if (event.eventType === 'soccer.team_event') return ['restarts']
  return []
}

export function transformFieldLocation(
  location: GameEventLocation | null,
  orientation: SoccerFieldReviewOrientation
): GameEventLocation | null {
  if (
    !location ||
    orientation === 'original' ||
    location.attackingDirection !== 'right_to_left'
  ) return location ? { ...location } : null
  return {
    x: 1 - location.x,
    y: 1 - location.y,
    attackingDirection: 'left_to_right',
  }
}

function soccerSportState(state: GameState): SoccerSportGameState | null {
  return state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState
    : null
}

function fieldParticipantOptions(
  sportState: SoccerSportGameState,
  events: GameEvent[],
  side: SoccerFieldReviewSide
): SoccerFieldReviewParticipantOption[] {
  const ids = new Set<string>()
  let hasUnknown = false
  for (const event of events) {
    if (event.period.id === 'shootout') continue
    if (soccerFieldReviewFamilies(event).length === 0) continue
    if (side !== 'all' && event.teamSide !== side) continue
    const participantIds = eventParticipantIds(event).filter(id =>
      Boolean(sportState.projection.participants[id])
    )
    if (participantIds.length === 0) hasUnknown = true
    participantIds.forEach(id => ids.add(id))
  }
  const participants = [...ids]
    .map(id => sportState.projection.participants[id] ?? null)
    .filter((participant): participant is NonNullable<typeof participant> =>
      participant !== null
    )
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      left.participantId.localeCompare(right.participantId)
    )
    .map(participant => ({
      id: participant.participantId,
      label: participant.number
        ? `#${participant.number} ${participant.displayName}`
        : participant.displayName,
    }))
  return [
    { id: 'all', label: 'All participants' },
    ...participants,
    ...(hasUnknown ? [{ id: 'unknown' as const, label: 'Unknown / team' }] : []),
  ]
}

function fieldPeriodOptions(
  sportState: SoccerSportGameState
): SoccerFieldReviewPeriodOption[] {
  const rules = sportState.projection.currentRules
  const started = new Set(sportState.projection.startedPeriodIds)
  const regulation = rules.regulationSegments.filter(segment => started.has(segment.id))
  const extraTime = rules.extraTimeSegments.filter(segment => started.has(segment.id))
  return [
    { id: 'full_match', label: 'Full Match' },
    ...(regulation.length > 1
      ? [{ id: 'regulation' as const, label: 'Regulation' }]
      : []),
    ...(extraTime.length > 0
      ? [{ id: 'extra_time' as const, label: 'Extra Time' }]
      : []),
    ...regulation.concat(extraTime).map(segment => ({
      id: segment.id,
      label: segment.label,
    })),
  ]
}

function matchesParticipant(
  item: SoccerFieldReviewEvent,
  participant: SoccerFieldReviewParticipant
): boolean {
  if (participant === 'all') return true
  if (participant === 'unknown') return item.participantIds.length === 0
  return item.participantIds.includes(participant)
}

function matchesPeriod(
  sportState: SoccerSportGameState,
  event: GameEvent,
  period: SoccerFieldReviewPeriod
): boolean {
  if (period === 'full_match') return true
  const rules = sportState.projection.currentRules
  if (period === 'regulation') {
    return rules.regulationSegments.some(segment => segment.id === event.period.id)
  }
  if (period === 'extra_time') {
    return rules.extraTimeSegments.some(segment => segment.id === event.period.id)
  }
  return event.period.id === period
}

function eventParticipantIds(event: GameEvent): string[] {
  return [...new Set(
    event.actors.flatMap(actor => actor.participantId ? [actor.participantId] : [])
  )].sort()
}

function eventParticipantLabel(event: GameEvent): string {
  if (event.eventType === 'soccer.team_event') {
    return soccerTeamEventReviewPresentation(event).actorLabel
  }
  const labels = [...new Set(
    event.actors.flatMap(actor => actor.label ? [actor.label] : [])
  )]
  return labels.length > 0 ? labels.join(', ') : 'Unknown / team'
}

function soccerFieldReviewTitle(event: GameEvent): string {
  const side = event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'
  if (event.eventType === 'soccer.own_goal') return `${side} own goal`
  if (event.eventType === 'soccer.shot') {
    return `${side} ${humanize((event as SoccerShotEvent).payload.outcome)}`
  }
  if (event.eventType === 'soccer.defensive_action') {
    const payload = (event as SoccerDefensiveActionEvent).payload
    return `${side} ${humanize(payload.action)}${
      payload.tackleOutcome ? ` ${payload.tackleOutcome}` : ''
    }`
  }
  if (event.eventType === 'soccer.foul') return `${side} foul`
  if (event.eventType === 'soccer.card') {
    return `${side} ${humanize((event as SoccerCardEvent).payload.sanction)}`
  }
  const presentation = soccerTeamEventReviewPresentation(event)
  return `${presentation.sideLabel} ${presentation.kindLabel.toLowerCase()}`
}

function soccerFieldReviewDetail(event: GameEvent): string | null {
  if (event.eventType === 'soccer.shot') {
    return humanize((event as SoccerShotEvent).payload.situation)
  }
  if (event.eventType === 'soccer.foul') {
    const payload = (event as SoccerFoulEvent).payload
    return [
      payload.restart !== 'none' ? humanize(payload.restart) : null,
      payload.sanction !== 'none' ? humanize(payload.sanction) : null,
      payload.note,
    ].filter(Boolean).join(' - ') || null
  }
  if (event.eventType === 'soccer.card') {
    return humanize((event as SoccerCardEvent).payload.reason)
  }
  return null
}

function soccerFieldReviewMarkerKind(
  event: GameEvent
): SoccerFieldReviewEvent['markerKind'] {
  if (event.eventType === 'soccer.own_goal') return 'own_goal'
  if (event.eventType === 'soccer.shot') {
    return (event as SoccerShotEvent).payload.outcome
  }
  if (event.eventType === 'soccer.defensive_action') {
    const payload = (event as SoccerDefensiveActionEvent).payload
    return payload.action === 'tackle'
      ? payload.tackleOutcome === 'won' ? 'tackle_won' : 'tackle_lost'
      : payload.action
  }
  if (event.eventType === 'soccer.foul') return 'foul'
  if (event.eventType === 'soccer.card') {
    return (event as SoccerCardEvent).payload.sanction === 'yellow'
      ? 'yellow_card'
      : 'red_card'
  }
  return (event as SoccerTeamEventEvent).payload.kind
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}

import type { GameState, Player, ShotRecord, ShotZone } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type { GameEventActor, GameEventDiagnostic } from '../gameEvents/types'
import { classifyShotZone, normalizedCourtLocationToFeet } from './courtGeometry'
import { resolveBasketballPeriodSegment } from './rules'
import type {
  BasketballMatchEvent,
  BasketballShotEvent,
  BasketballSportGameState,
  BasketballTeamSide,
} from './types'
import {
  BASKETBALL_NEGATIVE_SCORE_RECOVERY_MESSAGE,
  isBasketballNegativeScoreDiagnostic,
} from './scoreAdjustmentRecovery'

export type BasketballTimelineFamily =
  | 'all'
  | 'scoring'
  | 'shooting'
  | 'related_stats'
  | 'fouls_free_throws'
  | 'administration'
  | 'match_control'

export const BASKETBALL_TIMELINE_FAMILIES: ReadonlyArray<{
  id: BasketballTimelineFamily
  label: string
}> = [
  { id: 'all', label: 'All events' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'shooting', label: 'Shooting' },
  { id: 'related_stats', label: 'Related stats' },
  { id: 'fouls_free_throws', label: 'Fouls / FT' },
  { id: 'administration', label: 'Administration' },
  { id: 'match_control', label: 'Match control' },
]

export interface BasketballTimelineFilters {
  family: BasketballTimelineFamily
  periodId: 'all' | string
  teamSide: 'all' | BasketballTeamSide
  participantId: 'all' | string
}

export interface BasketballTimelinePeriodOption {
  id: string
  label: string
}

export interface BasketballTimelineParticipantOption {
  id: string
  label: string
  teamSide: BasketballTeamSide
}

export interface BasketballTimelineEventReview {
  id: string
  event: BasketballMatchEvent
  title: string
  actorLabel: string
  periodLabel: string
  sequenceLabel: string
  teamSide: BasketballMatchEvent['teamSide']
  participantIds: string[]
  families: BasketballTimelineFamily[]
  revised: boolean
  removed: boolean
  recordedLater: boolean
  boundary: boolean
  relationshipLabels: string[]
  warnings: string[]
}

export interface BasketballTimelineGroup {
  id: string
  captureCommandId: string | null
  events: BasketballTimelineEventReview[]
  title: string
  actorLabel: string
  periodLabel: string
  sequenceLabel: string
  occurredAt: string
  revised: boolean
  recordedLater: boolean
  boundary: boolean
  removedCompanionCount: number
  activeCompanionCount: number
}

export interface BasketballTimelineReview {
  complete: boolean
  diagnostics: GameEventDiagnostic[]
  globalWarnings: string[]
  activeGroups: BasketballTimelineGroup[]
  removedGroups: BasketballTimelineGroup[]
  periods: BasketballTimelinePeriodOption[]
  participants: BasketballTimelineParticipantOption[]
  defaultPeriodId: 'all' | string
  eventById: Map<string, BasketballTimelineEventReview>
}

export interface BasketballTimelinePeriodGroup {
  periodId: string
  periodLabel: string
  groups: BasketballTimelineGroup[]
}

export interface BasketballTimelineReviewOptions {
  groupOrder?: 'newest_first' | 'oldest_first'
}

export interface BasketballShotDetailRelationship {
  id: string
  label: string
  removed: boolean
}

export interface BasketballShotDetailModel {
  source: 'event' | 'legacy'
  shotId: string
  heading: string
  ordinalLabel: string
  periodLabel: string | null
  sequenceLabel: string | null
  shooterLabel: string
  teamLabel: string
  resultLabel: string
  valueLabel: string
  locationLabel: string
  occurredAt: string
  relationships: BasketballShotDetailRelationship[]
  warnings: string[]
  technical: Array<{ label: string; value: string }>
  revised: boolean
  removed: boolean
}

const BOUNDARY_TYPES = new Set<BasketballMatchEvent['eventType']>([
  'basketball.period_started',
  'basketball.period_ended',
  'basketball.participant_resolved',
  'basketball.match_ended',
  'basketball.match_reopened',
])

export const BASKETBALL_MARKER_HIT_RADIUS_FEET = 2.1
export const BASKETBALL_MARKER_TIE_EPSILON_FEET = 0.35

export function buildBasketballTimelineReview(
  state: GameState,
  options: BasketballTimelineReviewOptions = {}
): BasketballTimelineReview {
  if (
    state.sport?.id !== 'basketball' ||
    state.sportGameState?.sportId !== 'basketball' ||
    !state.eventStream
  ) {
    return emptyTimelineReview()
  }

  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  const inspection = rebuilt.inspection
  const hasRebuiltBasketballProjection = rebuilt.state !== state &&
    rebuilt.state.sportGameState?.sportId === 'basketball'
  const reviewState = hasRebuiltBasketballProjection ? rebuilt.state : state
  const sportState = reviewState.sportGameState
  if (sportState?.sportId !== 'basketball') return emptyTimelineReview()
  const validActive = inspection.activeEvents.filter(isBasketballMatchEvent)
  const validDeleted = inspection.deletedEvents.filter(isBasketballMatchEvent)
  const allEvents = [...validActive, ...validDeleted]
  const eventsById = new Map(allEvents.map(event => [event.id, event]))
  const diagnosticsByEvent = diagnosticsForEvents(inspection.diagnostics)
  const periods = periodOptionsForEvents(sportState, allEvents)
  const participantMetadata = participantReviewMetadata(sportState, validActive, validDeleted)
  const participants = participantMetadata.options
  const knownParticipantIds = participantMetadata.authoritativeIds
  const relationshipWarnings = hasRebuiltBasketballProjection
    ? sportState.projection.relationshipWarnings.filter(item =>
        eventsById.has(item.eventId) || eventsById.has(item.relatedEventId)
      )
    : []
  const recordedLaterIds = recordedLaterEventIds(allEvents)
  const reviews = allEvents.map(event => reviewEvent(
    reviewState,
    event,
    eventsById,
    diagnosticsByEvent,
    relationshipWarnings,
    knownParticipantIds,
    recordedLaterIds.has(event.id)
  ))
  const eventById = new Map(reviews.map(review => [review.id, review]))
  const activeReviews = validActive.map(event => eventById.get(event.id)!).filter(Boolean)
  const deletedReviews = validDeleted.map(event => eventById.get(event.id)!).filter(Boolean)
  const activeCounts = groupCounts(activeReviews)
  const deletedCounts = groupCounts(deletedReviews)
  return {
    complete: inspection.complete,
    diagnostics: inspection.diagnostics,
    globalWarnings: [...new Set(inspection.diagnostics
      .filter(item => item.eventId === null || isBasketballNegativeScoreDiagnostic(item))
      .map(item => isBasketballNegativeScoreDiagnostic(item)
        ? BASKETBALL_NEGATIVE_SCORE_RECOVERY_MESSAGE
        : item.message))],
    activeGroups: groupReviews(
      activeReviews,
      activeCounts,
      deletedCounts,
      false,
      options.groupOrder ?? 'newest_first'
    ),
    removedGroups: groupReviews(
      deletedReviews,
      deletedCounts,
      activeCounts,
      true,
      options.groupOrder ?? 'newest_first'
    ),
    periods,
    participants,
    defaultPeriodId: defaultPeriodIdForEvents(sportState, validActive, hasRebuiltBasketballProjection),
    eventById,
  }
}

export function groupBasketballTimelineByPeriod(
  groups: BasketballTimelineGroup[],
  periods: BasketballTimelinePeriodOption[]
): BasketballTimelinePeriodGroup[] {
  const periodOrder = new Map(periods.map((period, index) => [period.id, index]))
  const result = new Map<string, BasketballTimelinePeriodGroup>()
  for (const group of groups) {
    const firstEvent = group.events[0]?.event
    if (!firstEvent) continue
    const periodId = firstEvent.period.id
    const existing = result.get(periodId)
    if (existing) {
      existing.groups.push(group)
    } else {
      result.set(periodId, {
        periodId,
        periodLabel: group.periodLabel,
        groups: [group],
      })
    }
  }
  return [...result.values()].sort((left, right) =>
    (periodOrder.get(left.periodId) ?? Number.MAX_SAFE_INTEGER) -
      (periodOrder.get(right.periodId) ?? Number.MAX_SAFE_INTEGER) ||
    left.periodId.localeCompare(right.periodId)
  )
}

export function filterBasketballTimelineGroups(
  groups: BasketballTimelineGroup[],
  filters: BasketballTimelineFilters
): BasketballTimelineGroup[] {
  return groups.filter(group => group.events.some(event =>
    (filters.family === 'all' || event.families.includes(filters.family)) &&
    (filters.periodId === 'all' || event.event.period.id === filters.periodId) &&
    (filters.teamSide === 'all' || event.teamSide === filters.teamSide) &&
    (filters.participantId === 'all' || event.participantIds.includes(filters.participantId))
  ))
}

export function basketballShotDetailForEvent(
  state: GameState,
  eventId: string
): BasketballShotDetailModel | null {
  const review = buildBasketballTimelineReview(state)
  return basketballShotDetailFromReview(state, review, eventId)
}

export function basketballShotDetailFromReview(
  state: GameState,
  review: BasketballTimelineReview,
  eventId: string
): BasketballShotDetailModel | null {
  const eventReview = review.eventById.get(eventId)
  if (!eventReview || eventReview.event.eventType !== 'basketball.shot') return null
  const shot = eventReview.event
  const allReviews = [...review.activeGroups, ...review.removedGroups]
    .flatMap(group => group.events)
  const activeShots = review.activeGroups
    .flatMap(group => group.events)
    .map(item => item.event)
    .filter((event): event is BasketballShotEvent => event.eventType === 'basketball.shot')
    .sort(compareGameEventCaptureOrder)
  const activeFieldGoals = activeShots.filter(event => event.payload.attempt === 'field_goal')
  const activeTrips = review.activeGroups
    .flatMap(group => group.events)
    .map(item => item.event)
    .filter(event => event.eventType === 'basketball.free_throw_trip')
    .sort(compareGameEventCaptureOrder)
  const ordinalLabel = shot.payload.attempt === 'field_goal'
    ? fieldGoalOrdinalLabel(activeFieldGoals, shot)
    : freeThrowOrdinalLabel(activeTrips, shot)
  const related = allReviews.filter(item =>
    isRelatedStat(item.event) && item.event.payload.relatedEventId === shot.id
  )
  const location = shot.location ? normalizedCourtLocationToFeet(shot.location) : null
  const zone = location ? classifyShotZone(location.x, location.y) : null

  return {
    source: 'event',
    shotId: shot.id,
    heading: shot.payload.attempt === 'free_throw' ? 'Free throw detail' : 'Shot detail',
    ordinalLabel,
    periodLabel: eventReview.periodLabel,
    sequenceLabel: eventReview.sequenceLabel,
    shooterLabel: eventReview.actorLabel,
    teamLabel: teamLabel(state, shot.teamSide),
    resultLabel: shot.payload.made ? 'Made' : 'Missed',
    valueLabel: `${shot.payload.value} point${shot.payload.valueSource === 'manual_override' ? ' (manual)' : ''}`,
    locationLabel: location && zone
      ? `${zoneLabel(zone)} (${location.x.toFixed(1)}, ${location.y.toFixed(1)} ft)`
      : 'No court location',
    occurredAt: shot.occurredAt,
    relationships: related.map(item => ({
      id: item.id,
      label: relationshipLabel(state, item.event),
      removed: item.removed,
    })),
    warnings: eventReview.warnings,
    technical: [
      { label: 'Event ID', value: shot.id },
      { label: 'Recorder', value: shot.recorderUserId ?? 'Local recorder' },
      { label: 'Capture group', value: captureCommandId(shot) ?? 'Independent event' },
      { label: 'Revision', value: String(shot.revision) },
      { label: 'Value source', value: shot.payload.valueSource.replace(/_/g, ' ') },
      { label: 'Captured', value: shot.createdAt },
      { label: 'Updated', value: shot.updatedAt },
      ...(shot.deletedAt ? [{ label: 'Removed', value: shot.deletedAt }] : []),
    ],
    revised: shot.revision > 1,
    removed: shot.deletedAt !== null,
  }
}

export function legacyBasketballShotDetail(
  state: GameState,
  shotId: string
): BasketballShotDetailModel | null {
  const shot = state.shotChart.find(candidate => candidate.id === shotId)
  if (!shot) return null
  const ordinal = [...state.shotChart]
    .sort(compareLegacyShots)
    .findIndex(candidate => candidate.id === shot.id) + 1
  const player = state.players.find(candidate => candidate.id === shot.playerId)
  return {
    source: 'legacy',
    shotId: shot.id,
    heading: 'Shot detail',
    ordinalLabel: ordinal > 0 ? `Field goal #${ordinal}` : 'Field goal',
    periodLabel: null,
    sequenceLabel: null,
    shooterLabel: player ? playerLabel(player) : 'Unknown shooter',
    teamLabel: legacyShotTeamLabel(state, player),
    resultLabel: shot.made ? 'Made' : 'Missed',
    valueLabel: shot.shotType === '3pt' ? '3 point' : '2 point',
    locationLabel: `${zoneLabel(shot.zone)} (${shot.x.toFixed(1)}, ${shot.y.toFixed(1)} ft)`,
    occurredAt: new Date(shot.timestamp).toISOString(),
    relationships: [],
    warnings: [],
    technical: [
      { label: 'Shot ID', value: shot.id },
      { label: 'Recorded', value: new Date(shot.timestamp).toISOString() },
    ],
    revised: false,
    removed: false,
  }
}

export function basketballMarkerChoicesAtPoint(
  shots: ShotRecord[],
  selectedShotId: string,
  point: { x: number; y: number } | null,
  hitRadiusFeet = BASKETBALL_MARKER_HIT_RADIUS_FEET,
  tieEpsilonFeet = BASKETBALL_MARKER_TIE_EPSILON_FEET
): ShotRecord[] {
  const selected = shots.find(shot => shot.id === selectedShotId)
  if (!selected) return []
  if (!point) return [selected]
  const candidates = shots
    .map(shot => ({
      shot,
      distance: Math.hypot(shot.x - point.x, shot.y - point.y),
    }))
    .filter(candidate => candidate.distance <= hitRadiusFeet)
    .sort((left, right) => left.distance - right.distance || compareMarkerChoices(left.shot, right.shot))
  if (candidates.length === 0) return [selected]
  const nearestDistance = candidates[0].distance
  return candidates
    .filter(candidate => candidate.distance - nearestDistance <= tieEpsilonFeet)
    .map(candidate => candidate.shot)
    .sort(compareMarkerChoices)
}

export type BasketballMarkerActivation =
  | { kind: 'detail'; shot: ShotRecord }
  | { kind: 'chooser'; shots: ShotRecord[] }

export function resolveBasketballMarkerActivation(
  shots: ShotRecord[],
  selectedShotId: string,
  point: { x: number; y: number } | null
): BasketballMarkerActivation | null {
  const choices = basketballMarkerChoicesAtPoint(shots, selectedShotId, point)
  if (choices.length > 1) return { kind: 'chooser', shots: choices }
  const resolved = choices[0] ?? shots.find(shot => shot.id === selectedShotId)
  return resolved ? { kind: 'detail', shot: resolved } : null
}

function periodOptionsForEvents(
  sportState: BasketballSportGameState,
  events: BasketballMatchEvent[]
): BasketballTimelinePeriodOption[] {
  const periods = new Map<string, number>()
  for (const event of events) {
    const existingOrder = periods.get(event.period.id)
    if (existingOrder === undefined || event.period.order < existingOrder) {
      periods.set(event.period.id, event.period.order)
    }
  }
  return [...periods.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([id]) => ({
      id,
      label: resolveBasketballPeriodSegment(sportState.setup.rulesSnapshot, id)?.label ??
        sportState.projection.periods.find(period => period.id === id)?.label ?? id,
    }))
}

function participantReviewMetadata(
  sportState: BasketballSportGameState,
  activeEvents: BasketballMatchEvent[],
  deletedEvents: BasketballMatchEvent[]
): {
  options: BasketballTimelineParticipantOption[]
  authoritativeIds: Set<string>
} {
  const participants = new Map<string, BasketballTimelineParticipantOption>()
  const authoritativeIds = new Set<string>()
  for (const participant of sportState.setup.participants) {
    authoritativeIds.add(participant.id)
    participants.set(participant.id, {
      id: participant.id,
      label: participantLabel(participant.displayName, participant.number),
      teamSide: participant.teamSide,
    })
  }
  for (const event of [...activeEvents, ...deletedEvents]) {
    if (event.eventType !== 'basketball.match_roster_added') continue
    const participant = event.payload.participant
    authoritativeIds.add(participant.id)
    if (!participants.has(participant.id)) {
      participants.set(participant.id, {
        id: participant.id,
        label: participantLabel(participant.displayName, participant.number),
        teamSide: participant.teamSide,
      })
    }
  }
  for (const event of [...activeEvents].sort(compareGameEventCaptureOrder)) {
    if (event.eventType === 'basketball.match_roster_added') {
      const participant = event.payload.participant
      participants.set(participant.id, {
        id: participant.id,
        label: participantLabel(participant.displayName, participant.number),
        teamSide: participant.teamSide,
      })
    } else if (event.eventType === 'basketball.participant_resolved') {
      const participant = participants.get(event.payload.participantId)
      if (participant) {
        participants.set(participant.id, {
          ...participant,
          label: participantLabel(event.payload.displayName, event.payload.number),
        })
      }
    }
  }
  for (const event of [...activeEvents, ...deletedEvents]) {
    if (event.teamSide === 'neutral') continue
    for (const actor of event.actors) {
      if (!actor.participantId || participants.has(actor.participantId)) continue
      participants.set(actor.participantId, {
        id: actor.participantId,
        label: `Unavailable: ${actor.label || 'Unknown participant'}`,
        teamSide: event.teamSide,
      })
    }
  }
  return {
    options: [...participants.values()]
      .sort((left, right) => left.teamSide.localeCompare(right.teamSide) || left.label.localeCompare(right.label)),
    authoritativeIds,
  }
}

function defaultPeriodIdForEvents(
  sportState: BasketballSportGameState,
  activeEvents: BasketballMatchEvent[],
  hasRebuiltProjection: boolean
): 'all' | string {
  if (
    hasRebuiltProjection &&
    sportState.projection.status === 'in_progress' &&
    sportState.projection.currentPeriodId
  ) return sportState.projection.currentPeriodId

  let currentPeriodId: string | null = null
  for (const event of [...activeEvents].sort(compareGameEventCaptureOrder)) {
    if (event.eventType === 'basketball.period_started') currentPeriodId = event.payload.periodId
    if (event.eventType === 'basketball.period_ended' && currentPeriodId === event.payload.periodId) {
      currentPeriodId = null
    }
    if (event.eventType === 'basketball.match_ended') currentPeriodId = null
  }
  return currentPeriodId ?? 'all'
}

function reviewEvent(
  state: GameState,
  event: BasketballMatchEvent,
  eventsById: Map<string, BasketballMatchEvent>,
  diagnosticsByEvent: Map<string, string[]>,
  relationshipWarnings: Array<{ eventId: string; relatedEventId: string; message: string }>,
  knownParticipantIds: Set<string>,
  recordedLater: boolean
): BasketballTimelineEventReview {
  const participantIds = participantIdsForEvent(state, event)
  const warnings = [
    ...(diagnosticsByEvent.get(event.id) ?? []),
    ...relationshipWarnings
      .filter(item => item.eventId === event.id || item.relatedEventId === event.id)
      .map(item => item.message),
    ...missingActorWarnings(knownParticipantIds, event),
  ]
  return {
    id: event.id,
    event,
    title: eventTitle(state, event),
    actorLabel: actorLabel(state, event),
    periodLabel: periodLabel(state, event.period.id),
    sequenceLabel: `Capture #${event.sequence}`,
    teamSide: event.teamSide,
    participantIds,
    families: familiesForEvent(event),
    revised: event.revision > 1,
    removed: event.deletedAt !== null,
    recordedLater,
    boundary: BOUNDARY_TYPES.has(event.eventType),
    relationshipLabels: relationshipsForEvent(state, event, eventsById),
    warnings: [...new Set(warnings)],
  }
}

function groupReviews(
  reviews: BasketballTimelineEventReview[],
  ownCounts: Map<string, number>,
  companionCounts: Map<string, number>,
  removed: boolean,
  order: 'newest_first' | 'oldest_first'
): BasketballTimelineGroup[] {
  const grouped = new Map<string, BasketballTimelineEventReview[]>()
  for (const review of reviews) {
    const key = groupKey(review.event)
    const members = grouped.get(key) ?? []
    members.push(review)
    grouped.set(key, members)
  }
  return [...grouped.entries()]
    .map(([id, members]) => {
      members.sort((left, right) => compareGameEventCaptureOrder(left.event, right.event))
      const primary = members.find(item => item.event.eventType === 'basketball.shot') ?? members[0]
      const last = members[members.length - 1]
      return {
        id,
        captureCommandId: captureCommandId(primary.event),
        events: members,
        title: groupTitle(members, primary),
        actorLabel: primary.actorLabel,
        periodLabel: primary.periodLabel,
        sequenceLabel: sequenceLabelForEvents(members.map(item => item.event)),
        occurredAt: last.event.occurredAt,
        revised: members.some(item => item.revised),
        recordedLater: members.some(item => item.recordedLater),
        boundary: members.some(item => item.boundary),
        removedCompanionCount: removed
          ? ownCounts.get(id) ?? members.length
          : companionCounts.get(id) ?? 0,
        activeCompanionCount: removed
          ? companionCounts.get(id) ?? 0
          : ownCounts.get(id) ?? members.length,
      }
    })
    .sort((left, right) => {
      const leftEvent = left.events[left.events.length - 1].event
      const rightEvent = right.events[right.events.length - 1].event
      return order === 'oldest_first'
        ? compareGameEventCaptureOrder(leftEvent, rightEvent)
        : compareGameEventCaptureOrder(rightEvent, leftEvent)
    })
}

export function basketballTimelineCorrectionsEnabled(
  state: GameState,
  authorityEditable: boolean
): boolean {
  if (!authorityEditable || state.sportGameState?.sportId !== 'basketball') return false
  return state.sportGameState.projection.status === 'in_progress' ||
    state.sportGameState.projection.status === 'period_break'
}

function sequenceLabelForEvents(events: BasketballMatchEvent[]): string {
  const sequences = events.map(event => event.sequence).sort((left, right) => left - right)
  const first = sequences[0]
  const last = sequences[sequences.length - 1]
  return first === last ? `Capture #${first}` : `Captures #${first}-${last}`
}

function recordedLaterEventIds(events: BasketballMatchEvent[]): Set<string> {
  const result = new Set<string>()
  const endedPeriods = new Set<string>()
  let currentPeriodId: string | null = null
  for (const event of [...events].sort(compareGameEventCaptureOrder)) {
    if (
      isRecordedLaterEligible(event) &&
      (currentPeriodId !== event.period.id || endedPeriods.has(event.period.id))
    ) {
      result.add(event.id)
    }
    if (event.eventType === 'basketball.period_started') {
      currentPeriodId = event.payload.periodId
      endedPeriods.delete(event.payload.periodId)
    } else if (event.eventType === 'basketball.period_ended') {
      endedPeriods.add(event.payload.periodId)
    } else if (event.eventType === 'basketball.match_ended') {
      currentPeriodId = null
    } else if (event.eventType === 'basketball.match_reopened') {
      currentPeriodId = event.period.id
    }
  }
  return result
}

function isRecordedLaterEligible(event: BasketballMatchEvent): boolean {
  return event.eventType !== 'basketball.period_started' &&
    event.eventType !== 'basketball.period_ended' &&
    event.eventType !== 'basketball.match_roster_added' &&
    event.eventType !== 'basketball.participant_resolved' &&
    event.eventType !== 'basketball.match_ended' &&
    event.eventType !== 'basketball.match_reopened' &&
    event.eventType !== 'basketball.clock_started' &&
    event.eventType !== 'basketball.clock_paused' &&
    event.eventType !== 'basketball.clock_adjusted' &&
    event.eventType !== 'basketball.stoppage' &&
    event.eventType !== 'basketball.lineup_confirmed' &&
    event.eventType !== 'basketball.substitution' &&
    event.eventType !== 'basketball.role_changed' &&
    event.eventType !== 'basketball.equal_play_override'
}

function groupTitle(
  members: BasketballTimelineEventReview[],
  primary: BasketballTimelineEventReview
): string {
  if (members.length === 1) return primary.title
  const additions = members
    .filter(item => item.id !== primary.id)
    .map(item => item.title)
  return additions.length > 0 ? `${primary.title} + ${additions.join(' + ')}` : primary.title
}

function eventTitle(
  state: GameState,
  event: BasketballMatchEvent
): string {
  switch (event.eventType) {
    case 'basketball.period_started': return `${periodLabel(state, event.payload.periodId)} started`
    case 'basketball.period_ended': return `${periodLabel(state, event.payload.periodId)} ended`
    case 'basketball.match_roster_added': return `Added to ${event.payload.destination === 'bench' ? 'bench' : 'DNP list'}`
    case 'basketball.participant_resolved': return 'Participant identity updated'
    case 'basketball.match_ended': return event.payload.reason === 'completed'
      ? 'Game completed'
      : event.payload.reason === 'suspended' ? 'Game suspended' : 'Game abandoned'
    case 'basketball.match_reopened': return 'Game reopened'
    case 'basketball.clock_started': return 'Clock started'
    case 'basketball.clock_paused': return event.payload.source === 'expiration'
      ? 'Clock expired'
      : event.payload.source === 'period_end' ? 'Clock paused for period end' : 'Clock paused'
    case 'basketball.clock_adjusted': return 'Clock adjusted'
    case 'basketball.stoppage': return `Stoppage - ${titleCase(event.payload.category)}`
    case 'basketball.lineup_confirmed': return 'Lineup confirmed'
    case 'basketball.substitution': return event.payload.mode === 'current_lineup_recovery'
      ? 'Current lineup recovered'
      : 'Substitution'
    case 'basketball.role_changed': return 'Player roles updated'
    case 'basketball.equal_play_override': return 'Equal-play override'
    case 'basketball.free_throw_trip': {
      const oneAndOne = event.payload.oneAndOne ? ' (1-and-1)' : ''
      return `${event.payload.maximumAttempts} free throw${event.payload.maximumAttempts === 1 ? '' : 's'} awarded${oneAndOne}`
    }
    case 'basketball.shot': return event.payload.attempt === 'free_throw'
      ? `${event.payload.made ? 'Made' : 'Missed'} free throw`
      : `${event.payload.made ? 'Made' : 'Missed'} ${event.payload.value}PT`
    case 'basketball.assist': return 'Assist'
    case 'basketball.rebound': return event.payload.kind === 'offensive' ? 'Offensive rebound' : 'Defensive rebound'
    case 'basketball.steal': return 'Steal'
    case 'basketball.block': return 'Block'
    case 'basketball.turnover': return event.payload.kind === 'team' ? 'Team turnover' : 'Turnover'
    case 'basketball.score_adjustment': {
      const sign = event.payload.delta > 0 ? '+' : ''
      return `Score adjustment ${sign}${event.payload.delta}`
    }
    case 'basketball.foul': return `${titleCase(event.payload.class)} foul - ${titleCase(event.payload.context)}`
    case 'basketball.ejection': return `Ejection - ${event.payload.reason}`
    case 'basketball.timeout': return event.payload.label?.trim() || `${titleCase(event.payload.kind)} timeout`
    case 'basketball.minutes_adjustment': {
      const sign = event.payload.deltaMinutes > 0 ? '+' : ''
      return `Minutes adjustment ${sign}${event.payload.deltaMinutes}`
    }
  }
}

function familiesForEvent(event: BasketballMatchEvent): BasketballTimelineFamily[] {
  const families: BasketballTimelineFamily[] = ['all']
  if (
    (event.eventType === 'basketball.shot' && event.payload.made) ||
    event.eventType === 'basketball.score_adjustment'
  ) families.push('scoring')
  if (event.eventType === 'basketball.shot' || event.eventType === 'basketball.free_throw_trip') {
    families.push('shooting')
  }
  if (
    event.eventType === 'basketball.assist' ||
    event.eventType === 'basketball.rebound' ||
    event.eventType === 'basketball.steal' ||
    event.eventType === 'basketball.block' ||
    event.eventType === 'basketball.turnover'
  ) families.push('related_stats')
  if (
    event.eventType === 'basketball.foul' ||
    event.eventType === 'basketball.free_throw_trip' ||
    (event.eventType === 'basketball.shot' && event.payload.attempt === 'free_throw')
  ) families.push('fouls_free_throws')
  if (
    event.eventType === 'basketball.match_roster_added' ||
    event.eventType === 'basketball.participant_resolved' ||
    event.eventType === 'basketball.ejection' ||
    event.eventType === 'basketball.timeout' ||
    event.eventType === 'basketball.minutes_adjustment' ||
    event.eventType === 'basketball.score_adjustment'
  ) families.push('administration')
  if (
    event.eventType === 'basketball.period_started' ||
    event.eventType === 'basketball.period_ended' ||
    event.eventType === 'basketball.match_ended' ||
    event.eventType === 'basketball.match_reopened'
  ) families.push('match_control')
  return families
}

function relationshipsForEvent(
  state: GameState,
  event: BasketballMatchEvent,
  eventsById: Map<string, BasketballMatchEvent>
): string[] {
  if (event.eventType === 'basketball.shot') {
    return [...eventsById.values()]
      .filter(candidate => isRelatedStat(candidate) && candidate.payload.relatedEventId === event.id)
      .map(candidate => `${candidate.deletedAt ? 'Removed ' : ''}${relationshipLabel(state, candidate)}`)
  }
  if (isRelatedStat(event)) {
    if (!event.payload.relatedEventId) return ['Standalone stat']
    const target = eventsById.get(event.payload.relatedEventId)
    return [target ? `Linked to ${shortEventLabel(target)}` : 'Linked event unavailable']
  }
  if (event.eventType === 'basketball.free_throw_trip' && event.payload.sourceFoulEventId) {
    return [eventsById.has(event.payload.sourceFoulEventId) ? 'Linked to foul' : 'Source foul unavailable']
  }
  if (event.eventType === 'basketball.ejection' && event.payload.relatedFoulEventId) {
    return [eventsById.has(event.payload.relatedFoulEventId) ? 'Linked to foul' : 'Source foul unavailable']
  }
  return []
}

function relationshipLabel(state: GameState, event: BasketballMatchEvent): string {
  const who = actorLabel(state, event)
  switch (event.eventType) {
    case 'basketball.assist': return `${who} assist`
    case 'basketball.rebound': return `${who} ${event.payload.kind === 'offensive' ? 'offensive' : 'defensive'} rebound`
    case 'basketball.block': return `${who} block`
    case 'basketball.steal': return `${who} steal`
    default: return `${who} related stat`
  }
}

function shortEventLabel(event: BasketballMatchEvent): string {
  if (event.eventType === 'basketball.shot') {
    return event.payload.attempt === 'free_throw' ? 'free throw' : `${event.payload.value}PT shot`
  }
  if (event.eventType === 'basketball.turnover') return 'turnover'
  return 'event'
}

function actorLabel(state: GameState, event: BasketballMatchEvent): string {
  if (event.eventType === 'basketball.match_roster_added') {
    return participantLabel(event.payload.participant.displayName, event.payload.participant.number)
  }
  if (event.eventType === 'basketball.participant_resolved') {
    return participantLabel(event.payload.displayName, event.payload.number)
  }
  if (
    event.eventType === 'basketball.period_started' ||
    event.eventType === 'basketball.period_ended' ||
    event.eventType === 'basketball.match_ended' ||
    event.eventType === 'basketball.match_reopened'
  ) return 'Game'
  const actor = primaryActor(event)
  if (actor) return labelForActor(state, actor)
  return event.teamSide === 'neutral' ? 'Game administration' : teamLabel(state, event.teamSide)
}

function primaryActor(event: BasketballMatchEvent): GameEventActor | undefined {
  const preferredRoles = [
    'shooter', 'assister', 'rebounder', 'stealer', 'blocker', 'committed_by',
    'fouled_player', 'offender', 'ejected_subject', 'player', 'team',
  ]
  return preferredRoles.map(role => event.actors.find(actor => actor.role === role)).find(Boolean) ?? event.actors[0]
}

function labelForActor(state: GameState, actor: GameEventActor): string {
  if (actor.participantId && state.sportGameState?.sportId === 'basketball') {
    const participant = state.sportGameState.projection.participants[actor.participantId]
    if (participant) return participantLabel(participant.displayName, participant.number)
  }
  if (actor.kind === 'player') {
    const player = state.players.find(candidate => candidate.id === actor.playerId)
    if (player) return playerLabel(player)
  }
  return actor.label || 'Unknown participant'
}

function participantIdsForEvent(state: GameState, event: BasketballMatchEvent): string[] {
  const ids = new Set<string>()
  if (event.eventType === 'basketball.match_roster_added') ids.add(event.payload.participant.id)
  if (event.eventType === 'basketball.participant_resolved') ids.add(event.payload.participantId)
  for (const actor of event.actors) {
    if (actor.participantId) {
      ids.add(actor.participantId)
      continue
    }
    if (actor.kind === 'player' && state.sportGameState?.sportId === 'basketball') {
      const projectedParticipant = Object.values(state.sportGameState.projection.participants)
        .find(candidate => candidate.playerId === actor.playerId)
      const setupParticipant = state.sportGameState.setup.participants
        .find(candidate => candidate.playerId === actor.playerId)
      const participantId = projectedParticipant?.participantId ?? setupParticipant?.id
      if (participantId) ids.add(participantId)
    }
  }
  return [...ids]
}

function missingActorWarnings(knownParticipantIds: Set<string>, event: BasketballMatchEvent): string[] {
  return event.actors.flatMap(actor => {
    if (!actor.participantId) return []
    return knownParticipantIds.has(actor.participantId)
      ? []
      : [`${actor.label || 'Event actor'} is unavailable in the authoritative match roster.`]
  })
}

function periodLabel(state: GameState, periodId: string): string {
  if (state.sportGameState?.sportId !== 'basketball') return periodId
  return state.sportGameState.projection.periods.find(period => period.id === periodId)?.label ??
    resolveBasketballPeriodSegment(state.sportGameState.setup.rulesSnapshot, periodId)?.label ?? periodId
}

function teamLabel(state: GameState, side: BasketballMatchEvent['teamSide']): string {
  if (side === 'neutral') return 'Neutral'
  return side === 'tracked'
    ? state.gameInfo?.teamName || 'Tracked team'
    : state.gameInfo?.opponentName || 'Opponent'
}

function playerLabel(player: Player): string {
  const number = player.number.trim()
  return number ? `#${number} ${player.name}` : player.name
}

function participantLabel(name: string, number: string | null): string {
  const normalized = number?.trim()
  return normalized ? `#${normalized} ${name}` : name
}

function fieldGoalOrdinalLabel(activeShots: BasketballShotEvent[], shot: BasketballShotEvent): string {
  if (shot.deletedAt) return 'Removed field goal'
  const index = activeShots.findIndex(candidate => candidate.id === shot.id)
  return index >= 0 ? `Field goal #${index + 1}` : 'Field goal'
}

function freeThrowOrdinalLabel(
  activeTrips: BasketballMatchEvent[],
  shot: BasketballShotEvent
): string {
  if (shot.payload.freeThrowTripId === null || shot.payload.tripAttemptNumber === null) {
    return 'Ungrouped FT'
  }
  const tripIndex = activeTrips.findIndex(candidate => candidate.id === shot.payload.freeThrowTripId)
  return tripIndex >= 0
    ? `FT trip #${tripIndex + 1}, attempt ${shot.payload.tripAttemptNumber}`
    : `FT attempt ${shot.payload.tripAttemptNumber}`
}

function legacyShotTeamLabel(state: GameState, player: Player | undefined): string {
  if (!player) return 'Unknown team'
  if (player.teamSide === 'opponent') return state.gameInfo?.opponentName || 'Opponent'
  return state.gameInfo?.teamName || 'Tracked team'
}

function zoneLabel(zone: ShotZone): string {
  switch (zone) {
    case 'restricted': return 'Restricted area'
    case 'paint': return 'Paint'
    case 'mid_range': return 'Mid-range'
    case 'three': return 'Three-point area'
  }
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function captureCommandId(event: BasketballMatchEvent): string | null {
  return typeof event.payload.captureCommandId === 'string' ? event.payload.captureCommandId : null
}

function groupKey(event: BasketballMatchEvent): string {
  const commandId = captureCommandId(event)
  return commandId ? `command:${commandId}` : `event:${event.id}`
}

function groupCounts(reviews: BasketballTimelineEventReview[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const review of reviews) {
    const key = groupKey(review.event)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function diagnosticsForEvents(diagnostics: GameEventDiagnostic[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const diagnostic of diagnostics) {
    if (!diagnostic.eventId) continue
    const messages = result.get(diagnostic.eventId) ?? []
    messages.push(diagnostic.message)
    result.set(diagnostic.eventId, messages)
  }
  return result
}

function isRelatedStat(event: BasketballMatchEvent): event is Extract<
  BasketballMatchEvent,
  { eventType: 'basketball.assist' | 'basketball.rebound' | 'basketball.steal' | 'basketball.block' }
> {
  return event.eventType === 'basketball.assist' ||
    event.eventType === 'basketball.rebound' ||
    event.eventType === 'basketball.steal' ||
    event.eventType === 'basketball.block'
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
}

function compareLegacyShots(left: ShotRecord, right: ShotRecord): number {
  return left.timestamp - right.timestamp || left.id.localeCompare(right.id)
}

function compareMarkerChoices(left: ShotRecord, right: ShotRecord): number {
  return right.timestamp - left.timestamp || left.id.localeCompare(right.id)
}

function emptyTimelineReview(): BasketballTimelineReview {
  return {
    complete: false,
    diagnostics: [],
    globalWarnings: [],
    activeGroups: [],
    removedGroups: [],
    periods: [],
    participants: [],
    defaultPeriodId: 'all',
    eventById: new Map(),
  }
}

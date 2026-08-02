import type { GameState } from '../../types'
import type {
  GameEvent,
  GameEventActor,
  GameEventEditableFields,
  GameEventInspection,
  GameEventLocation,
  GameEventPeriod,
} from '../gameEvents/types'
import {
  addGameEvent,
  addGameEvents,
  deleteGameEvent,
  restoreGameEvent,
  updateGameEvent,
} from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createSoccerEvent, nextSoccerEventSequence, type SoccerEventPayloadByType } from './events'
import { requireSoccerEventGameState, type SoccerEventGameState } from './gameState'
import { createSoccerUuid } from './id'
import { orderedSoccerSegments } from './rules'
import { soccerLifecycleAction, soccerShootoutPeriod } from './shootout'
import { elapsedSoccerClockMs } from './state'
import type {
  SoccerAttackingDirection,
  SoccerMatchEndedPayload,
  SoccerMatchEvent,
  SoccerMatchParticipant,
  SoccerMatchProjection,
  SoccerMatchRules,
  SoccerRole,
  SoccerCardSanction,
  SoccerDisciplineReason,
  SoccerShootoutEligibilityChangeReason,
  SoccerShootoutGoalkeeperChangeReason,
  SoccerShootoutKickOutcome,
  SoccerShotOutcome,
  SoccerShotSituation,
  SoccerSubstitutionChange,
  SoccerTeamSide,
} from './types'

export interface SoccerLiveOptions {
  recorderUserId: string | null
  nowMs?: number
  eventIds?: string[]
}

export type SoccerCaptureActorSelection =
  | { kind: 'participant'; participantId: string }
  | { kind: 'unknown'; label: string }
  | { kind: 'team'; label: string }

export interface SoccerShotCaptureInput {
  teamSide: SoccerTeamSide
  outcome: SoccerShotOutcome
  situation: SoccerShotSituation
  location: GameEventLocation | null
  shooter: SoccerCaptureActorSelection
  primaryCreator?: SoccerCaptureActorSelection | null
  secondaryCreator?: SoccerCaptureActorSelection | null
  goalkeeper?: SoccerCaptureActorSelection | null
  blocker?: SoccerCaptureActorSelection | null
  sourceEventId?: string | null
}

export interface SoccerOwnGoalCaptureInput {
  teamSide: SoccerTeamSide
  location: GameEventLocation | null
  ownGoalBy: SoccerCaptureActorSelection
  goalkeeper?: SoccerCaptureActorSelection | null
}

export interface SoccerScoreAdjustmentInput {
  teamSide: SoccerTeamSide
  delta: 1 | -1
  reason: string
}

export interface SoccerShootoutStartInput {
  firstKickingSide: SoccerTeamSide
  trackedEligibleParticipantIds: string[]
  trackedExcludedParticipantIds: string[]
  opponentEligibleCount: number
  trackedGoalkeeperParticipantId: string
  opponentGoalkeeperLabel: string
}

export interface SoccerShootoutKickInput {
  outcome: SoccerShootoutKickOutcome
  kicker: SoccerCaptureActorSelection
  goalkeeper: SoccerCaptureActorSelection
  anonymousKickerSlot: number | null
}

export interface SoccerShootoutEligibilityInput {
  reason: SoccerShootoutEligibilityChangeReason
  trackedEligibleParticipantIds: string[]
  trackedExcludedParticipantIds: string[]
  opponentEligibleCount: number
  actors?: GameEventActor[]
}

export interface SoccerShootoutGoalkeeperInput {
  teamSide: SoccerTeamSide
  reason: SoccerShootoutGoalkeeperChangeReason
  goalkeeperOut: SoccerCaptureActorSelection
  goalkeeperIn: SoccerCaptureActorSelection
  eligibility?: SoccerShootoutEligibilityInput | null
}

export interface SoccerShootoutCardInput {
  teamSide: SoccerTeamSide
  sanction: SoccerCardSanction
  reason: SoccerDisciplineReason
  note: string | null
  recipient: GameEventActor
  eligibility?: SoccerShootoutEligibilityInput | null
}

export interface SoccerEventMoment {
  period: GameEventPeriod
  elapsedMs: number
}

export interface SoccerPeriodTiming {
  period: GameEventPeriod
  label: string
  startElapsedMs: number
  endElapsedMs: number
}

export type SoccerLiveResult =
  | { ok: true; state: SoccerEventGameState; inspection: GameEventInspection }
  | { ok: false; state: GameState; message: string }

export type SoccerCaptureSaveOperation = 'record_live' | 'record_historical' | 'revise'

export function resolveSoccerCaptureSaveOperation(
  mode: 'live' | 'historical' | 'edit',
  intendedEventType: 'soccer.shot' | 'soccer.own_goal',
  existingEventType: string | null,
  hasMoment: boolean
): { ok: true; operation: SoccerCaptureSaveOperation } | { ok: false; message: string } {
  if (mode === 'live') return { ok: true, operation: 'record_live' }
  if (!hasMoment) return { ok: false, message: 'A recorded match time is required.' }
  if (mode === 'historical') return { ok: true, operation: 'record_historical' }
  if (existingEventType !== intendedEventType) {
    return {
      ok: false,
      message: 'The event type cannot be changed during correction. Remove the event and add a replacement instead.',
    }
  }
  return { ok: true, operation: 'revise' }
}

export interface SoccerClockDisplayValue {
  primary: string
  overrun: string | null
  canonicalElapsedMs: number
  periodElapsedMs: number
}

interface EventSpec<TType extends keyof SoccerEventPayloadByType = keyof SoccerEventPayloadByType> {
  eventType: TType
  payload: SoccerEventPayloadByType[TType]
  period?: GameEventPeriod
  elapsedMs?: number | null
  teamSide?: SoccerTeamSide
  location?: GameEventLocation | null
  actors?: GameEventActor[]
}

export type SoccerSoc4EventType =
  | 'soccer.defensive_action'
  | 'soccer.foul'
  | 'soccer.card'
  | 'soccer.team_event'
  | 'soccer.shootout_started'
  | 'soccer.shootout_eligibility_changed'
  | 'soccer.shootout_goalkeeper_changed'
  | 'soccer.shootout_kick'

export interface SoccerCheckedEventInput<TType extends SoccerSoc4EventType> {
  eventType: TType
  payload: SoccerEventPayloadByType[TType]
  period?: GameEventPeriod
  elapsedMs?: number | null
  teamSide?: SoccerTeamSide
  location?: GameEventLocation | null
  actors?: GameEventActor[]
}

export function recordCheckedSoccerEvent<TType extends SoccerSoc4EventType>(
  state: GameState,
  input: SoccerCheckedEventInput<TType>,
  options: SoccerLiveOptions
): SoccerLiveResult {
  return appendSpecs(state, options, [input])
}

export function startSoccerShootout(
  state: GameState,
  input: SoccerShootoutStartInput,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  if (soccerLifecycleAction(context.projection).kind !== 'start_shootout') {
    return failure(state, 'The match is not ready to start a shootout.')
  }
  const period = soccerShootoutPeriod(context.projection)
  const specs: EventSpec[] = [{
    eventType: 'soccer.shootout_started',
    payload: {
      firstKickingSide: input.firstKickingSide,
      initialKicksPerSide: context.projection.currentRules.shootoutInitialKicksPerSide,
      trackedEligibleParticipantIds: input.trackedEligibleParticipantIds,
      trackedExcludedParticipantIds: input.trackedExcludedParticipantIds,
      opponentEligibleCount: input.opponentEligibleCount,
      trackedGoalkeeperParticipantId: input.trackedGoalkeeperParticipantId,
    },
    period,
    elapsedMs: null,
  }]
  const opponentGoalkeeperLabel = input.opponentGoalkeeperLabel.trim()
  if (opponentGoalkeeperLabel && opponentGoalkeeperLabel.toLowerCase() !== 'unknown') {
    specs.push({
      eventType: 'soccer.shootout_goalkeeper_changed',
      payload: { reason: 'tactical' },
      period,
      elapsedMs: null,
      teamSide: 'opponent',
      actors: [
        { role: 'goalkeeper_out', kind: 'unknown', label: 'Unknown' },
        { role: 'goalkeeper_in', kind: 'unknown', label: opponentGoalkeeperLabel },
      ],
    })
  }
  return appendSpecs(state, options, specs)
}

export function recordSoccerShootoutKick(
  state: GameState,
  input: SoccerShootoutKickInput,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  const shootout = context.projection.shootout
  if (context.projection.status !== 'shootout' || !shootout || shootout.decided) {
    return failure(state, 'A kick requires an active undecided shootout.')
  }
  const actors = buildCaptureActors(context.projection, [
    ['kicker', input.kicker],
    ['goalkeeper', input.goalkeeper],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return appendSpecs(state, options, [{
    eventType: 'soccer.shootout_kick',
    payload: { outcome: input.outcome, anonymousKickerSlot: input.anonymousKickerSlot },
    period: soccerShootoutPeriod(context.projection),
    elapsedMs: null,
    teamSide: shootout.nextSide,
    actors: actors.value,
  }])
}

export function reviseSoccerShootoutKick(
  state: GameState,
  eventId: string,
  teamSide: SoccerTeamSide,
  input: SoccerShootoutKickInput,
  now = new Date().toISOString()
): SoccerLiveResult {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') return failure(state, 'Soccer match state is unavailable.')
  const actors = buildCaptureActors(sportState.projection, [
    ['kicker', input.kicker],
    ['goalkeeper', input.goalkeeper],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return updateSoccerHistoryEvent(state, eventId, {
    payload: { outcome: input.outcome, anonymousKickerSlot: input.anonymousKickerSlot },
    period: soccerShootoutPeriod(sportState.projection),
    elapsedMs: null,
    teamSide,
    location: null,
    actors: actors.value,
  }, now)
}

export function recordSoccerShootoutEligibility(
  state: GameState,
  input: SoccerShootoutEligibilityInput,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  return appendSpecs(state, options, [shootoutEligibilitySpec(context.projection, input)])
}

export function recordSoccerShootoutGoalkeeperChange(
  state: GameState,
  input: SoccerShootoutGoalkeeperInput,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  const actors = buildCaptureActors(context.projection, [
    ['goalkeeper_out', input.goalkeeperOut],
    ['goalkeeper_in', input.goalkeeperIn],
  ])
  if (!actors.ok) return failure(state, actors.message)
  const specs: EventSpec[] = []
  if (input.eligibility) specs.push(shootoutEligibilitySpec(context.projection, input.eligibility))
  specs.push({
    eventType: 'soccer.shootout_goalkeeper_changed',
    payload: { reason: input.reason },
    period: soccerShootoutPeriod(context.projection),
    elapsedMs: null,
    teamSide: input.teamSide,
    actors: actors.value,
  })
  return appendSpecs(state, options, specs)
}

export function recordSoccerShootoutCard(
  state: GameState,
  input: SoccerShootoutCardInput,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  const specs: EventSpec[] = [{
    eventType: 'soccer.card',
    payload: {
      sanction: input.sanction,
      reason: input.reason,
      note: input.note?.trim() || null,
      lineupResolution: null,
    },
    period: soccerShootoutPeriod(context.projection),
    elapsedMs: null,
    teamSide: input.teamSide,
    actors: [{ ...input.recipient, role: 'recipient' }],
  }]
  if (input.eligibility) specs.push(shootoutEligibilitySpec(context.projection, input.eligibility))
  return appendSpecs(state, options, specs)
}

export function recordSoccerShot(
  state: GameState,
  input: SoccerShotCaptureInput,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  if (context.projection.status !== 'in_progress' || !context.projection.currentPeriodId) {
    return failure(state, 'Shots can only be recorded during an active period.')
  }
  const actors = buildCaptureActors(context.projection, [
    ['shooter', input.shooter],
    ['creator_primary', input.primaryCreator],
    ['creator_secondary', input.secondaryCreator],
    ['goalkeeper', input.goalkeeper],
    ['blocker', input.blocker],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return appendSpecs(state, options, [{
    eventType: 'soccer.shot',
    payload: {
      outcome: input.outcome,
      situation: input.situation,
      sourceEventId: input.sourceEventId ?? null,
    },
    elapsedMs: context.elapsedMs,
    teamSide: input.teamSide,
    location: input.location,
    actors: actors.value,
  }])
}

export function recordSoccerOwnGoal(
  state: GameState,
  input: SoccerOwnGoalCaptureInput,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  if (context.projection.status !== 'in_progress' || !context.projection.currentPeriodId) {
    return failure(state, 'Own goals can only be recorded during an active period.')
  }
  const actors = buildCaptureActors(context.projection, [
    ['own_goal_by', input.ownGoalBy],
    ['goalkeeper', input.goalkeeper],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return appendSpecs(state, options, [{
    eventType: 'soccer.own_goal',
    payload: {},
    elapsedMs: context.elapsedMs,
    teamSide: input.teamSide,
    location: input.location,
    actors: actors.value,
  }])
}

export function recordHistoricalSoccerShot(
  state: GameState,
  input: SoccerShotCaptureInput,
  moment: SoccerEventMoment,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = historicalContext(state, moment, options.nowMs)
  if (!context.ok) return context
  const actors = buildCaptureActors(context.projection, [
    ['shooter', input.shooter],
    ['creator_primary', input.primaryCreator],
    ['creator_secondary', input.secondaryCreator],
    ['goalkeeper', input.goalkeeper],
    ['blocker', input.blocker],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return appendSpecs(state, options, [{
    eventType: 'soccer.shot',
    payload: {
      outcome: input.outcome,
      situation: input.situation,
      sourceEventId: input.sourceEventId ?? null,
    },
    period: moment.period,
    elapsedMs: moment.elapsedMs,
    teamSide: input.teamSide,
    location: input.location,
    actors: actors.value,
  }])
}

export function recordHistoricalSoccerOwnGoal(
  state: GameState,
  input: SoccerOwnGoalCaptureInput,
  moment: SoccerEventMoment,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = historicalContext(state, moment, options.nowMs)
  if (!context.ok) return context
  const actors = buildCaptureActors(context.projection, [
    ['own_goal_by', input.ownGoalBy],
    ['goalkeeper', input.goalkeeper],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return appendSpecs(state, options, [{
    eventType: 'soccer.own_goal',
    payload: {},
    period: moment.period,
    elapsedMs: moment.elapsedMs,
    teamSide: input.teamSide,
    location: input.location,
    actors: actors.value,
  }])
}

export function reviseSoccerShot(
  state: GameState,
  eventId: string,
  input: SoccerShotCaptureInput,
  moment: SoccerEventMoment,
  now = new Date().toISOString()
): SoccerLiveResult {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') return failure(state, 'Soccer match state is unavailable.')
  const actors = buildCaptureActors(sportState.projection, [
    ['shooter', input.shooter],
    ['creator_primary', input.primaryCreator],
    ['creator_secondary', input.secondaryCreator],
    ['goalkeeper', input.goalkeeper],
    ['blocker', input.blocker],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return updateSoccerHistoryEvent(state, eventId, {
    payload: {
      outcome: input.outcome,
      situation: input.situation,
      sourceEventId: input.sourceEventId ?? null,
    },
    period: moment.period,
    elapsedMs: moment.elapsedMs,
    teamSide: input.teamSide,
    location: input.location,
    actors: actors.value,
  }, now)
}

export function reviseSoccerOwnGoal(
  state: GameState,
  eventId: string,
  input: SoccerOwnGoalCaptureInput,
  moment: SoccerEventMoment,
  now = new Date().toISOString()
): SoccerLiveResult {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') return failure(state, 'Soccer match state is unavailable.')
  const actors = buildCaptureActors(sportState.projection, [
    ['own_goal_by', input.ownGoalBy],
    ['goalkeeper', input.goalkeeper],
  ])
  if (!actors.ok) return failure(state, actors.message)
  return updateSoccerHistoryEvent(state, eventId, {
    payload: {},
    period: moment.period,
    elapsedMs: moment.elapsedMs,
    teamSide: input.teamSide,
    location: input.location,
    actors: actors.value,
  }, now)
}

export function recordSoccerScoreAdjustment(
  state: GameState,
  input: SoccerScoreAdjustmentInput,
  moment: SoccerEventMoment,
  options: SoccerLiveOptions
): SoccerLiveResult {
  if (hasSoccerShootout(state)) {
    return failure(state, 'Remove the shootout events before correcting the normal match score.')
  }
  const context = historicalContext(state, moment, options.nowMs)
  if (!context.ok) return context
  const reason = input.reason.trim()
  if (!reason) return failure(state, 'A score adjustment reason is required.')
  return appendSpecs(state, options, [{
    eventType: 'soccer.score_adjustment',
    payload: { delta: input.delta, reason },
    period: moment.period,
    elapsedMs: moment.elapsedMs,
    teamSide: input.teamSide,
    location: null,
    actors: [],
  }])
}

export function reviseSoccerScoreAdjustment(
  state: GameState,
  eventId: string,
  input: SoccerScoreAdjustmentInput,
  moment: SoccerEventMoment,
  now = new Date().toISOString()
): SoccerLiveResult {
  if (hasSoccerShootout(state)) {
    return failure(state, 'Remove the shootout events before correcting the normal match score.')
  }
  const reason = input.reason.trim()
  if (!reason) return failure(state, 'A score adjustment reason is required.')
  return updateSoccerHistoryEvent(state, eventId, {
    payload: { delta: input.delta, reason },
    period: moment.period,
    elapsedMs: moment.elapsedMs,
    teamSide: input.teamSide,
    location: null,
    actors: [],
  }, now)
}

export function soccerPeriodTimings(state: GameState, nowMs = Date.now()): SoccerPeriodTiming[] {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') return []
  const projection = sportState.projection
  const liveElapsedMs = elapsedSoccerClockMs(projection, nowMs)
  return orderedSoccerSegments(projection.currentRules)
    .filter(segment => projection.startedPeriodIds.includes(segment.id))
    .map(segment => {
      const startElapsedMs = currentPeriodStartElapsedMs(state, segment.id)
      const endElapsedMs = projection.periodEndElapsedMsById[segment.id]
        ?? (projection.currentPeriodId === segment.id ? liveElapsedMs : startElapsedMs)
      return {
        period: { id: segment.id, order: segment.order },
        label: segment.label,
        startElapsedMs,
        endElapsedMs: Math.max(startElapsedMs, endElapsedMs),
      }
    })
}

export function soccerAttackingDirectionAt(
  state: GameState,
  moment: SoccerEventMoment
): SoccerAttackingDirection {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') return 'left_to_right'
  const segments = orderedSoccerSegments(sportState.projection.currentRules)
  const segmentIndex = segments.findIndex(segment => segment.id === moment.period.id)
  const base = sportState.projection.firstPeriodAttackingDirection
  let direction: SoccerAttackingDirection = segmentIndex >= 0 && segmentIndex % 2 === 1
    ? oppositeDirection(base)
    : base
  const changes = inspectSoccerHistory(state).activeEvents
    .filter(event => event.eventType === 'soccer.attacking_direction_changed' &&
      event.period.id === moment.period.id &&
      event.elapsedMs !== null &&
      event.elapsedMs <= moment.elapsedMs)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  for (const event of changes) {
    const payload = event.payload as { direction?: unknown }
    if (payload.direction === 'left_to_right' || payload.direction === 'right_to_left') {
      direction = payload.direction
    }
  }
  return direction
}

export function toggleSoccerClock(
  state: GameState,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  const { projection, elapsedMs } = context
  if (projection.status !== 'in_progress' || !projection.currentPeriodId) {
    return failure(state, 'The clock requires an active period.')
  }
  return appendSpecs(state, options, [projection.clock.running
    ? {
        eventType: 'soccer.clock_paused',
        payload: { elapsedMs },
        elapsedMs,
      }
    : {
        eventType: 'soccer.clock_started',
        payload: { anchorElapsedMs: projection.clock.elapsedMs },
        elapsedMs: projection.clock.elapsedMs,
      }])
}

export function endSoccerPeriod(
  state: GameState,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  const { projection, elapsedMs, period } = context
  if (projection.status !== 'in_progress' || !projection.currentPeriodId) {
    return failure(state, 'There is no active period to end.')
  }
  const specs: EventSpec[] = []
  if (projection.clock.running) {
    specs.push({
      eventType: 'soccer.clock_paused',
      payload: { elapsedMs },
      elapsedMs,
      period,
    })
  }
  specs.push({
    eventType: 'soccer.period_ended',
    payload: { periodId: projection.currentPeriodId },
    elapsedMs,
    period,
  })
  return appendSpecs(state, options, specs)
}

export function startNextSoccerPeriod(
  state: GameState,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  const { projection } = context
  if (projection.status !== 'period_break' || projection.currentPeriodId) {
    return failure(state, 'The next period can only start from a period break.')
  }
  const action = soccerLifecycleAction(projection)
  if (action.kind !== 'start_period') return failure(state, 'No playable period remains.')
  const next = action.segment
  const period = { id: next.id, order: next.order }
  const elapsedMs = projection.clock.elapsedMs
  return appendSpecs(state, options, [
    {
      eventType: 'soccer.period_started',
      payload: { periodId: next.id },
      period,
      elapsedMs,
    },
    {
      eventType: 'soccer.clock_started',
      payload: { anchorElapsedMs: elapsedMs },
      period,
      elapsedMs,
    },
  ])
}

export function adjustSoccerClock(
  state: GameState,
  toElapsedMs: number,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  if (!Number.isInteger(toElapsedMs) || toElapsedMs < 0) {
    return failure(state, 'Corrected match time must be zero or greater.')
  }
  return appendSpecs(state, options, [{
    eventType: 'soccer.clock_adjusted',
    payload: { fromElapsedMs: context.elapsedMs, toElapsedMs },
    elapsedMs: toElapsedMs,
  }])
}

export function recordSoccerSubstitution(
  state: GameState,
  changes: SoccerSubstitutionChange[],
  halftime: boolean,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  return appendSpecs(state, options, [{
    eventType: 'soccer.substitution_window',
    payload: { changes, halftime },
    elapsedMs: context.elapsedMs,
  }])
}

export function recordSoccerRoleChange(
  state: GameState,
  participantId: string,
  role: SoccerRole,
  options: SoccerLiveOptions
): SoccerLiveResult {
  return recordSoccerRoleChanges(state, [{ participantId, role }], options)
}

export function recordSoccerRoleChanges(
  state: GameState,
  changes: Array<{ participantId: string; role: SoccerRole }>,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  return appendSpecs(state, options, [{
    eventType: 'soccer.role_changed',
    payload: { changes },
    elapsedMs: context.elapsedMs,
  }])
}

export function recordSoccerDirectionChange(
  state: GameState,
  direction: SoccerAttackingDirection,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  return appendSpecs(state, options, [{
    eventType: 'soccer.attacking_direction_changed',
    payload: { direction },
    elapsedMs: context.elapsedMs,
  }])
}

export function recordSoccerRulesChange(
  state: GameState,
  rules: SoccerMatchRules,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  return appendSpecs(state, options, [{
    eventType: 'soccer.match_rules_changed',
    payload: { rules },
    elapsedMs: context.elapsedMs,
  }])
}

export function addSoccerMatchParticipant(
  state: GameState,
  participant: SoccerMatchParticipant,
  destination: 'bench' | 'on_field',
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  return appendSpecs(state, options, [{
    eventType: 'soccer.match_roster_added',
    payload: { participant, destination },
    elapsedMs: context.elapsedMs,
  }])
}

export function resolveSoccerParticipant(
  state: GameState,
  participantId: string,
  playerId: string,
  displayName: string,
  number: string | null,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  return appendSpecs(state, options, [{
    eventType: 'soccer.participant_resolved',
    payload: { participantId, playerId, displayName, number },
    elapsedMs: context.elapsedMs,
  }])
}

export function endSoccerMatch(
  state: GameState,
  reason: SoccerMatchEndedPayload['reason'],
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  const { projection, elapsedMs, period } = context
  if (
    projection.status !== 'in_progress' &&
    projection.status !== 'period_break' &&
    projection.status !== 'shootout' &&
    projection.status !== 'suspended'
  ) {
    return failure(state, 'Only an active match can be ended.')
  }
  if (projection.status === 'shootout' && reason !== 'completed' && reason !== 'abandoned') {
    return failure(state, 'An active shootout can only be completed or abandoned.')
  }
  const specs: EventSpec[] = []
  if (projection.clock.running) {
    specs.push({
      eventType: 'soccer.clock_paused',
      payload: { elapsedMs },
      elapsedMs,
      period,
    })
  }
  specs.push({
    eventType: 'soccer.match_ended',
    payload: { reason },
    elapsedMs,
    period,
  })
  return appendSpecs(state, options, specs)
}

export function reopenSoccerMatch(
  state: GameState,
  reason: string | null,
  options: SoccerLiveOptions
): SoccerLiveResult {
  const context = liveContext(state, options)
  if (!context.ok) return context
  if (context.projection.status === 'ended' && context.projection.endReason === 'abandoned' && !reason?.trim()) {
    return failure(state, 'A reason is required to reopen an abandoned match.')
  }
  return appendSpecs(state, options, [{
    eventType: 'soccer.match_reopened',
    payload: { reason: reason?.trim() || null },
    elapsedMs: context.elapsedMs,
  }])
}

export function updateSoccerHistoryEvent(
  state: GameState,
  eventId: string,
  changes: Partial<GameEventEditableFields>,
  now = new Date().toISOString()
): SoccerLiveResult {
  return mutationResult(updateGameEvent(
    state,
    eventId,
    changes,
    now,
    gameEventRegistry,
    gameEventProjectors
  ))
}

export function deleteSoccerHistoryEvent(
  state: GameState,
  eventId: string,
  now = new Date().toISOString()
): SoccerLiveResult {
  return mutationResult(deleteGameEvent(
    state,
    eventId,
    now,
    gameEventRegistry,
    gameEventProjectors
  ))
}

export function restoreSoccerHistoryEvent(
  state: GameState,
  eventId: string,
  now = new Date().toISOString()
): SoccerLiveResult {
  return mutationResult(restoreGameEvent(
    state,
    eventId,
    now,
    gameEventRegistry,
    gameEventProjectors
  ))
}

export function inspectSoccerHistory(state: GameState): GameEventInspection<SoccerMatchEvent> {
  return rebuildGameEventProjection(
    state,
    gameEventRegistry,
    gameEventProjectors
  ).inspection as GameEventInspection<SoccerMatchEvent>
}

export function isSoccerHalftimeBreak(projection: SoccerMatchProjection): boolean {
  const firstRegulationId = projection.currentRules.regulationSegments[0]?.id
  return Boolean(
    firstRegulationId &&
    projection.status === 'period_break' &&
    projection.completedPeriodIds.length === 1 &&
    projection.completedPeriodIds[0] === firstRegulationId
  )
}

export function soccerClockDisplayValue(
  state: GameState,
  nowMs = Date.now()
): SoccerClockDisplayValue | null {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') return null
  const projection = sportState.projection
  const canonicalElapsedMs = elapsedSoccerClockMs(projection, nowMs)
  const displayPeriodId = projection.currentPeriodId
    ?? projection.completedPeriodIds[projection.completedPeriodIds.length - 1]
    ?? projection.currentRules.regulationSegments[0]?.id
    ?? null
  const periodStartMs = currentPeriodStartElapsedMs(state, displayPeriodId)
  const periodElapsedMs = Math.max(0, canonicalElapsedMs - periodStartMs)
  const currentSegment = orderedSoccerSegments(projection.currentRules)
    .find(segment => segment.id === displayPeriodId) ?? null
  const continuous = projection.currentRules.clockDisplay === 'continuous'
  const countDown = projection.currentRules.clockDirection === 'count_down'
  const extraTimeIds = new Set(projection.currentRules.extraTimeSegments.map(segment => segment.id))
  const extraTimeBegan = Boolean(
    (displayPeriodId && extraTimeIds.has(displayPeriodId)) ||
    projection.completedPeriodIds.some(periodId => extraTimeIds.has(periodId))
  )
  const continuousSegments = extraTimeBegan
    ? orderedSoccerSegments(projection.currentRules)
    : projection.currentRules.regulationSegments
  const nominalMs = continuous
    ? continuousSegments.reduce((total, segment) => total + segment.durationMs, 0)
    : currentSegment?.durationMs ?? 0
  const displayElapsedMs = continuous ? canonicalElapsedMs : periodElapsedMs
  const primaryMs = countDown ? Math.max(0, nominalMs - displayElapsedMs) : displayElapsedMs
  const overrunMs = countDown ? Math.max(0, displayElapsedMs - nominalMs) : 0
  return {
    primary: formatSoccerDuration(primaryMs),
    overrun: overrunMs > 0 ? `+${formatSoccerDuration(overrunMs)}` : null,
    canonicalElapsedMs,
    periodElapsedMs,
  }
}

export function formatSoccerDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function liveContext(state: GameState, options: SoccerLiveOptions):
  | {
      ok: true
      projection: SoccerMatchProjection
      elapsedMs: number
      period: GameEventPeriod
    }
  | { ok: false; state: GameState; message: string } {
  const sportState = state.sportGameState
  if (state.sport?.id !== 'soccer' || !sportState || sportState.sportId !== 'soccer' || !state.eventStream) {
    return failure(state, 'An initialized soccer match is required.')
  }
  const projection = sportState.projection
  const elapsedMs = elapsedSoccerClockMs(projection, options.nowMs ?? Date.now())
  return {
    ok: true,
    projection,
    elapsedMs,
    period: eventPeriod(projection.currentRules, projection.currentPeriodId, projection.completedPeriodIds),
  }
}

function historicalContext(
  state: GameState,
  moment: SoccerEventMoment,
  nowMs = Date.now()
):
  | { ok: true; projection: SoccerMatchProjection }
  | { ok: false; state: GameState; message: string } {
  const sportState = state.sportGameState
  if (state.sport?.id !== 'soccer' || !sportState || sportState.sportId !== 'soccer' || !state.eventStream) {
    return failure(state, 'An initialized soccer match is required.')
  }
  const timing = soccerPeriodTimings(state, nowMs)
    .find(item => item.period.id === moment.period.id && item.period.order === moment.period.order)
  if (!timing) return failure(state, 'The selected period has not started.')
  if (!Number.isInteger(moment.elapsedMs) || moment.elapsedMs < timing.startElapsedMs || moment.elapsedMs > timing.endElapsedMs) {
    return failure(state, 'The selected time is outside the recorded period bounds.')
  }
  return { ok: true, projection: sportState.projection }
}

function appendSpecs(
  state: GameState,
  options: SoccerLiveOptions,
  specs: EventSpec[]
): SoccerLiveResult {
  if (!state.eventStream) return failure(state, 'An initialized soccer match is required.')
  const nowMs = options.nowMs ?? Date.now()
  const occurredAt = new Date(nowMs).toISOString()
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') {
    return failure(state, 'Soccer match state is unavailable.')
  }
  const defaultPeriod = eventPeriod(
    sportState.projection.currentRules,
    sportState.projection.currentPeriodId,
    sportState.projection.completedPeriodIds
  )
  const firstSequence = nextSoccerEventSequence(state.eventStream.events, options.recorderUserId)
  const events = specs.map((spec, index) => createSoccerEvent({
    id: options.eventIds?.[index] ?? createSoccerUuid(),
    eventType: spec.eventType,
    payload: spec.payload,
    recorderUserId: options.recorderUserId,
    sequence: firstSequence + index,
    period: spec.period ?? defaultPeriod,
    elapsedMs: spec.elapsedMs === undefined
      ? elapsedSoccerClockMs(sportState.projection, nowMs)
      : spec.elapsedMs,
    occurredAt,
    teamSide: spec.teamSide,
    location: spec.location,
    actors: spec.actors,
  }) as GameEvent)
  const result = events.length === 1
    ? addGameEvent(state, events[0], gameEventRegistry, gameEventProjectors)
    : addGameEvents(state, events, gameEventRegistry, gameEventProjectors)
  return mutationResult(result)
}

function hasSoccerShootout(state: GameState): boolean {
  return state.sportGameState?.sportId === 'soccer' && Boolean(state.sportGameState.projection.shootout)
}

function shootoutEligibilitySpec(
  projection: SoccerMatchProjection,
  input: SoccerShootoutEligibilityInput
): EventSpec<'soccer.shootout_eligibility_changed'> {
  return {
    eventType: 'soccer.shootout_eligibility_changed',
    payload: {
      reason: input.reason,
      trackedEligibleParticipantIds: input.trackedEligibleParticipantIds,
      trackedExcludedParticipantIds: input.trackedExcludedParticipantIds,
      opponentEligibleCount: input.opponentEligibleCount,
    },
    period: soccerShootoutPeriod(projection),
    elapsedMs: null,
    actors: input.actors ?? [],
  }
}

function buildCaptureActors(
  projection: SoccerMatchProjection,
  selections: Array<[string, SoccerCaptureActorSelection | null | undefined]>
): { ok: true; value: GameEventActor[] } | { ok: false; message: string } {
  const actors: GameEventActor[] = []
  for (const [role, selection] of selections) {
    if (!selection) continue
    if (selection.kind === 'participant') {
      const participant = projection.participants[selection.participantId]
      if (!participant) return { ok: false, message: 'A selected match participant is unavailable.' }
      actors.push(participant.playerId
        ? {
            role,
            kind: 'player',
            participantId: participant.participantId,
            playerId: participant.playerId,
            label: participant.displayName,
          }
        : {
            role,
            kind: 'unknown',
            participantId: participant.participantId,
            label: participant.displayName,
          })
      continue
    }
    const label = selection.label.trim()
    if (!label) return { ok: false, message: 'Actor labels cannot be empty.' }
    actors.push({ role, kind: selection.kind, label })
  }
  return { ok: true, value: actors }
}

function eventPeriod(
  rules: SoccerMatchRules,
  currentPeriodId: string | null,
  completedPeriodIds: string[]
): GameEventPeriod {
  const segments = orderedSoccerSegments(rules)
  const id = currentPeriodId
    ?? completedPeriodIds[completedPeriodIds.length - 1]
    ?? segments[0]?.id
  const segment = segments.find(candidate => candidate.id === id) ?? segments[0]
  return segment
    ? { id: segment.id, order: segment.order }
    : { id: 'match', order: 0 }
}

function oppositeDirection(direction: SoccerAttackingDirection): SoccerAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

function currentPeriodStartElapsedMs(state: GameState, periodId: string | null): number {
  if (!periodId || !state.eventStream) return 0
  let latestSequence = -1
  let elapsedMs = 0
  for (const raw of state.eventStream.events) {
    const event = raw as Partial<GameEvent>
    if (
      event.deletedAt !== null ||
      event.eventType !== 'soccer.period_started' ||
      event.sequence === undefined ||
      event.elapsedMs === null ||
      event.elapsedMs === undefined
    ) continue
    const payload = event.payload as { periodId?: unknown } | undefined
    if (payload?.periodId !== periodId || event.sequence < latestSequence) continue
    latestSequence = event.sequence
    elapsedMs = event.elapsedMs
  }
  return elapsedMs
}

function mutationResult(result: ReturnType<typeof addGameEvent>): SoccerLiveResult {
  return result.ok
    ? {
        ok: true,
        state: requireSoccerEventGameState(result.state),
        inspection: result.inspection,
      }
    : { ok: false, state: result.state, message: result.error.message }
}

function failure(state: GameState, message: string): SoccerLiveResult & { ok: false } {
  return { ok: false, state, message }
}

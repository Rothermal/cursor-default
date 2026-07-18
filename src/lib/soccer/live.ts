import type { GameState } from '../../types'
import type {
  GameEvent,
  GameEventActor,
  GameEventEditableFields,
  GameEventInspection,
  GameEventLocation,
  GameEventPeriod,
  GameEventTeamSide,
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
import { createSoccerUuid } from './id'
import { orderedSoccerSegments } from './rules'
import { elapsedSoccerClockMs } from './state'
import type {
  SoccerAttackingDirection,
  SoccerMatchEndedPayload,
  SoccerMatchParticipant,
  SoccerMatchProjection,
  SoccerMatchRules,
  SoccerRole,
  SoccerShotOutcome,
  SoccerShotSituation,
  SoccerSubstitutionChange,
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
  teamSide: GameEventTeamSide
  outcome: SoccerShotOutcome
  situation: SoccerShotSituation
  location: GameEventLocation | null
  shooter: SoccerCaptureActorSelection
  primaryCreator?: SoccerCaptureActorSelection | null
  secondaryCreator?: SoccerCaptureActorSelection | null
  goalkeeper?: SoccerCaptureActorSelection | null
  blocker?: SoccerCaptureActorSelection | null
}

export interface SoccerOwnGoalCaptureInput {
  teamSide: GameEventTeamSide
  location: GameEventLocation | null
  ownGoalBy: SoccerCaptureActorSelection
  goalkeeper?: SoccerCaptureActorSelection | null
}

export type SoccerLiveResult =
  | { ok: true; state: GameState; inspection: GameEventInspection }
  | { ok: false; state: GameState; message: string }

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
  teamSide?: GameEventTeamSide
  location?: GameEventLocation | null
  actors?: GameEventActor[]
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
    payload: { outcome: input.outcome, situation: input.situation },
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
  const next = orderedSoccerSegments(projection.currentRules)
    .find(segment => !projection.completedPeriodIds.includes(segment.id))
  if (!next) return failure(state, 'No configured period remains.')
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
  if (projection.status !== 'in_progress' && projection.status !== 'period_break') {
    return failure(state, 'Only an active match can be ended.')
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
  return appendSpecs(state, options, [{
    eventType: 'soccer.match_reopened',
    payload: { reason },
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

export function inspectSoccerHistory(state: GameState): GameEventInspection {
  return rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors).inspection
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
      projection: NonNullable<GameState['sportGameState']>['projection']
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
    ? { ok: true, state: result.state, inspection: result.inspection }
    : { ok: false, state: result.state, message: result.error.message }
}

function failure(state: GameState, message: string): SoccerLiveResult & { ok: false } {
  return { ok: false, state, message }
}

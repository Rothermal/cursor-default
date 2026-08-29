import type { GameState } from '../../types'
import { addGameEvent, addGameEvents } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import {
  basketballActorForSelection,
  basketballCaptureTargetForPlayerId,
  createBasketballCaptureCommandId,
  getBasketballCommandContext,
  type BasketballCaptureActorSelection,
  type BasketballCommandErrorCode,
} from './commands'
import { createBasketballUuid } from './id'
import { createBasketballStatEvent } from './statEvents'
import type {
  BasketballFoulClass,
  BasketballFoulContext,
  BasketballFoulCountingOverride,
  BasketballFoulEvent,
  BasketballMatchEvent,
  BasketballTeamSide,
} from './types'
import { basketballRulesAllowOneAndOne } from './rules'

export type BasketballFoulOffender =
  | { kind: 'player'; playerId: string }
  | { kind: 'team' }
  | { kind: 'staff'; label: string }

export type BasketballFoulDrawnBy =
  | { kind: 'player'; playerId: string }
  | { kind: 'unknown'; label: string }

export interface BasketballFreeThrowAward {
  maximumAttempts: 1 | 2 | 3
  oneAndOne: boolean
  technical: boolean
  possessionRetained: boolean
}

export interface BasketballFoulCaptureOptions {
  recorderUserId: string | null
  teamSide: BasketballTeamSide
  offender: BasketballFoulOffender
  class: BasketballFoulClass
  context: BasketballFoulContext
  teamControlSide?: BasketballTeamSide | null
  incidentId?: string | null
  drawnBy?: BasketballFoulDrawnBy | null
  countingOverride?: BasketballFoulCountingOverride | null
  freeThrows?: BasketballFreeThrowAward | null
  occurredAt?: string
  eventIds?: string[]
  captureCommandId?: string
}

export interface BasketballFreeThrowAttemptOptions {
  recorderUserId: string | null
  tripEventId: string
  shooterPlayerId: string
  made: boolean
  occurredAt?: string
  eventId?: string
}

export type BasketballFoulFreeThrowCommandResult =
  | {
      ok: true
      state: GameState
      eventIds: string[]
      foulEventId?: string
      tripEventId?: string
      attemptNumber?: number
      tripComplete?: boolean
    }
  | {
      ok: false
      state: GameState
      code: BasketballCommandErrorCode
      message: string
    }

export interface BasketballFreeThrowAttemptStatus {
  eventId: string
  attemptNumber: number
  made: boolean
  deleted: boolean
  shooterPlayerId: string | null
}

export interface BasketballFreeThrowTripStatus {
  eventId: string
  teamSide: BasketballTeamSide
  periodId: string
  periodOrder: number
  maximumAttempts: 1 | 2 | 3
  oneAndOne: boolean
  technical: boolean
  possessionRetained: boolean
  sourceFoulEventId: string | null
  attempts: BasketballFreeThrowAttemptStatus[]
  nextAttemptNumber: number | null
  open: boolean
  closedReason: 'positions_complete' | 'first_attempt_ended' | null
}

export function basketballFreeThrowTripStatuses(
  state: GameState
): BasketballFreeThrowTripStatus[] {
  const inspected = basketballEvents(state)
  if (!inspected.ok) return []
  const allAttempts = [...inspected.active, ...inspected.deleted]
    .filter((event): event is Extract<BasketballMatchEvent, { eventType: 'basketball.shot' }> =>
      event.eventType === 'basketball.shot' &&
      event.payload.attempt === 'free_throw' &&
      event.payload.freeThrowTripId !== null &&
      event.payload.tripAttemptNumber !== null
    )
  return inspected.active
    .filter((event): event is Extract<BasketballMatchEvent, { eventType: 'basketball.free_throw_trip' }> =>
      event.eventType === 'basketball.free_throw_trip'
    )
    .sort((left, right) => compareGameEventCaptureOrder(right, left))
    .map(trip => {
      const historicalAttempts = allAttempts.filter(event =>
        event.payload.freeThrowTripId === trip.id
      )
      const progress = freeThrowTripProgress(trip, historicalAttempts)
      return {
        eventId: trip.id,
        teamSide: trip.teamSide,
        periodId: trip.period.id,
        periodOrder: trip.period.order,
        maximumAttempts: trip.payload.maximumAttempts,
        oneAndOne: trip.payload.oneAndOne,
        technical: trip.payload.technical,
        possessionRetained: trip.payload.possessionRetained,
        sourceFoulEventId: trip.payload.sourceFoulEventId,
        attempts: historicalAttempts
          .sort((left, right) => left.payload.tripAttemptNumber! - right.payload.tripAttemptNumber!)
          .map(event => {
            const shooter = event.actors.find(actor => actor.role === 'shooter')
            return {
              eventId: event.id,
              attemptNumber: event.payload.tripAttemptNumber!,
              made: event.payload.made,
              deleted: event.deletedAt !== null,
              shooterPlayerId: shooter?.kind === 'player' ? shooter.playerId : null,
            }
          }),
        ...progress,
      }
    })
}

export function captureBasketballFoul(
  state: GameState,
  options: BasketballFoulCaptureOptions
): BasketballFoulFreeThrowCommandResult {
  const guarded = commandContext(state, options.recorderUserId, options.occurredAt)
  if (!guarded.ok) return guarded
  const offender = foulOffenderActor(state, options.teamSide, options.offender)
  if (!offender.ok) return offender
  const drawnBy = foulDrawnByActor(state, options.teamSide, options.drawnBy ?? null)
  if (!drawnBy.ok) return drawnBy
  const override = normalizeCountingOverride(state, options.countingOverride ?? null)
  if (!override.ok) return override
  if (
    options.context === 'offensive' &&
    options.teamControlSide != null &&
    options.teamControlSide !== options.teamSide
  ) {
    return failure(state, 'command_failed', 'An offensive foul must use the committing side as team control.')
  }

  const incidentId = options.incidentId?.trim() || null
  const commandId = options.freeThrows
    ? options.captureCommandId ?? createBasketballCaptureCommandId()
    : options.captureCommandId ?? null
  const foulId = options.eventIds?.[0] ?? createBasketballUuid()
  const foul = createBasketballAdministrativeEvent({
    id: foulId,
    eventType: 'basketball.foul',
    payload: {
      class: options.class,
      context: options.context,
      teamControlSide: options.context === 'offensive'
        ? options.teamSide
        : options.teamControlSide ?? null,
      incidentId,
      countingOverride: override.value,
      captureCommandId: commandId,
    },
    recorderUserId: options.recorderUserId,
    sequence: guarded.context.nextSequence,
    period: guarded.context.period,
    elapsedMs: guarded.context.elapsedMs,
    occurredAt: guarded.context.occurredAt,
    teamSide: options.teamSide,
    actors: drawnBy.actor ? [offender.actor, drawnBy.actor] : [offender.actor],
  })
  const awardError = validateFreeThrowAward(state, foul, options.freeThrows ?? null)
  if (awardError) return failure(state, 'command_failed', awardError)

  const events: BasketballMatchEvent[] = [foul]
  let tripId: string | undefined
  if (options.freeThrows) {
    tripId = options.eventIds?.[1] ?? createBasketballUuid()
    events.push(createBasketballStatEvent({
      id: tripId,
      eventType: 'basketball.free_throw_trip',
      payload: {
        ...options.freeThrows,
        sourceFoulEventId: foulId,
        captureCommandId: commandId,
      },
      recorderUserId: options.recorderUserId,
      sequence: guarded.context.nextSequence + 1,
      period: guarded.context.period,
      elapsedMs: guarded.context.elapsedMs,
      occurredAt: guarded.context.occurredAt,
      teamSide: oppositeSide(options.teamSide),
      actors: [],
    }))
  }

  const candidate = withCaptureTarget(
    state,
    options.teamSide,
    offender.selection
  )
  const appended = appendEvents(state, candidate, events)
  return appended.ok
    ? { ...appended, foulEventId: foulId, tripEventId: tripId }
    : appended
}

export function captureBasketballFreeThrowAttempt(
  state: GameState,
  options: BasketballFreeThrowAttemptOptions
): BasketballFoulFreeThrowCommandResult {
  const guarded = commandContext(state, options.recorderUserId, options.occurredAt)
  if (!guarded.ok) return guarded
  const inspected = basketballEvents(state)
  if (!inspected.ok) return failure(state, 'command_failed', inspected.message)
  const trip = inspected.active.find(event =>
    event.id === options.tripEventId && event.eventType === 'basketball.free_throw_trip'
  )
  if (!trip || trip.eventType !== 'basketball.free_throw_trip') {
    return failure(state, 'command_failed', 'The Basketball free-throw trip is unavailable.')
  }
  if (trip.period.id !== guarded.context.period.id) {
    return failure(state, 'invalid_period', 'Free throws must be recorded in their awarded period.')
  }

  const shooterTarget = basketballCaptureTargetForPlayerId(state, options.shooterPlayerId)
  if (!shooterTarget.ok) return failure(state, shooterTarget.code, shooterTarget.message)
  if (
    shooterTarget.value.teamSide !== trip.teamSide ||
    shooterTarget.value.selection.kind !== 'participant'
  ) {
    return failure(state, 'invalid_actor', 'The free-throw shooter must belong to the awarded side.')
  }
  const participant = guarded.context.sportState.projection.participants[
    shooterTarget.value.selection.participantId
  ]
  if (!participant || participant.disqualified || participant.ejected) {
    return failure(state, 'invalid_actor', 'The selected Basketball shooter is unavailable.')
  }
  const shooter = basketballActorForSelection(
    state,
    'shooter',
    trip.teamSide,
    shooterTarget.value.selection
  )
  if (!shooter.ok || shooter.value.kind !== 'player') {
    return failure(
      state,
      shooter.ok ? 'invalid_actor' : shooter.code,
      shooter.ok ? 'Free throws require a resolved Basketball player.' : shooter.message
    )
  }

  const historicalAttempts = [...inspected.active, ...inspected.deleted]
    .filter((event): event is Extract<BasketballMatchEvent, { eventType: 'basketball.shot' }> =>
      event.eventType === 'basketball.shot' &&
      event.payload.attempt === 'free_throw' &&
      event.payload.freeThrowTripId === trip.id &&
      event.payload.tripAttemptNumber !== null
    )
  const progress = freeThrowTripProgress(trip, historicalAttempts)
  if (progress.closedReason === 'first_attempt_ended') {
    return failure(state, 'command_failed', 'The one-and-one trip ended after its first attempt.')
  }
  const attemptNumber = progress.nextAttemptNumber
  if (attemptNumber === null) {
    return failure(state, 'command_failed', 'Every awarded free-throw position has already been recorded.')
  }

  const event = createBasketballStatEvent({
    id: options.eventId,
    eventType: 'basketball.shot',
    payload: {
      value: 1,
      made: options.made,
      attempt: 'free_throw',
      valueSource: 'free_throw',
      freeThrowTripId: trip.id,
      tripAttemptNumber: attemptNumber,
      captureCommandId: null,
    },
    recorderUserId: options.recorderUserId,
    sequence: guarded.context.nextSequence,
    period: guarded.context.period,
    elapsedMs: guarded.context.elapsedMs,
    occurredAt: guarded.context.occurredAt,
    teamSide: trip.teamSide,
    actors: [shooter.value],
  })
  const appended = appendEvents(
    state,
    withCaptureTarget(state, trip.teamSide, shooterTarget.value.selection),
    [event]
  )
  if (!appended.ok) return appended
  const tripComplete = !options.made && trip.payload.oneAndOne && attemptNumber === 1
    ? true
    : attemptNumber === trip.payload.maximumAttempts
  return { ...appended, attemptNumber, tripComplete }
}

function foulOffenderActor(
  state: GameState,
  teamSide: BasketballTeamSide,
  offender: BasketballFoulOffender
):
  | { ok: true; actor: GameEventActor; selection: BasketballCaptureActorSelection }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string } {
  if (offender.kind === 'staff') {
    const label = offender.label.trim()
    return label
      ? {
          ok: true,
          actor: { role: 'committed_by', kind: 'staff', label },
          selection: { kind: 'team' },
        }
      : failure(state, 'invalid_actor', 'Enter a Basketball staff label.')
  }
  if (offender.kind === 'team') {
    const actor = basketballActorForSelection(state, 'committed_by', teamSide, { kind: 'team' })
    return actor.ok
      ? { ok: true, actor: actor.value, selection: { kind: 'team' } }
      : failure(state, actor.code, actor.message)
  }
  const target = basketballCaptureTargetForPlayerId(state, offender.playerId)
  if (!target.ok) return failure(state, target.code, target.message)
  if (target.value.teamSide !== teamSide || target.value.selection.kind !== 'participant') {
    return failure(state, 'invalid_actor', 'The foul offender must belong to the selected side.')
  }
  const participant = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.participants[target.value.selection.participantId]
    : null
  if (!participant || participant.disqualified || participant.ejected) {
    return failure(state, 'invalid_actor', 'The selected Basketball foul offender is unavailable.')
  }
  const actor = basketballActorForSelection(
    state,
    'committed_by',
    teamSide,
    target.value.selection
  )
  if (!actor.ok || actor.value.kind !== 'player') {
    return failure(
      state,
      actor.ok ? 'invalid_actor' : actor.code,
      actor.ok ? 'Player fouls require a resolved Basketball player.' : actor.message
    )
  }
  return { ok: true, actor: actor.value, selection: target.value.selection }
}

function foulDrawnByActor(
  state: GameState,
  foulSide: BasketballTeamSide,
  drawnBy: BasketballFoulDrawnBy | null
):
  | { ok: true; actor: GameEventActor | null }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string } {
  if (!drawnBy) return { ok: true, actor: null }
  const side = oppositeSide(foulSide)
  if (drawnBy.kind === 'unknown') {
    const actor = basketballActorForSelection(
      state,
      'drawn_by',
      side,
      { kind: 'unknown', label: drawnBy.label }
    )
    return actor.ok ? { ok: true, actor: actor.value } : failure(state, actor.code, actor.message)
  }
  const target = basketballCaptureTargetForPlayerId(state, drawnBy.playerId)
  if (!target.ok) return failure(state, target.code, target.message)
  if (target.value.teamSide !== side || target.value.selection.kind !== 'participant') {
    return failure(state, 'invalid_actor', 'The player drawing the foul must belong to the opposite side.')
  }
  const participant = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.participants[target.value.selection.participantId]
    : null
  if (!participant || participant.disqualified || participant.ejected) {
    return failure(state, 'invalid_actor', 'The selected Basketball player drawing the foul is unavailable.')
  }
  const actor = basketballActorForSelection(state, 'drawn_by', side, target.value.selection)
  return actor.ok ? { ok: true, actor: actor.value } : failure(state, actor.code, actor.message)
}

function normalizeCountingOverride(
  state: GameState,
  override: BasketballFoulCountingOverride | null
):
  | { ok: true; value: BasketballFoulCountingOverride | null }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string } {
  if (!override) return { ok: true, value: null }
  const reason = override.reason.trim()
  return reason
    ? { ok: true, value: { ...override, reason } }
    : failure(state, 'command_failed', 'Exceptional foul counting requires a reason.')
}

function validateFreeThrowAward(
  state: GameState,
  foul: BasketballFoulEvent,
  award: BasketballFreeThrowAward | null
): string | null {
  if (!award) return null
  if (award.oneAndOne && award.maximumAttempts !== 2) {
    return 'A one-and-one Basketball trip must award at most two attempts.'
  }
  const technicalFoul = foul.payload.countingOverride?.technical ?? foul.payload.class === 'technical'
  if (award.technical !== technicalFoul) {
    return 'The free-throw technical flag must match the foul counting context.'
  }
  if (!award.oneAndOne) return null
  const countsAsTeamFoul = foul.payload.countingOverride?.teamFoul ?? true
  if (!countsAsTeamFoul || technicalFoul) {
    return 'A one-and-one trip requires a nontechnical foul that counts toward the team bonus.'
  }
  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  if (!sportState || !basketballRulesAllowOneAndOne(
    sportState.setup.rulesSnapshot,
    foul.period.id
  )) {
    return 'The Basketball rules snapshot does not allow one-and-one free throws.'
  }
  const projected = addGameEvent(state, foul, gameEventRegistry, gameEventProjectors)
  const projectedState = projected.ok && projected.inspection.complete &&
    projected.state.sportGameState?.sportId === 'basketball'
    ? projected.state.sportGameState
    : null
  if (!projectedState) {
    return 'The Basketball foul could not be projected before awarding free throws.'
  }
  const bonus = projectedState.projection.bonusStatusByPeriod[foul.period.id]?.[foul.teamSide]
    ?? 'none'
  if (bonus !== 'one_and_one') {
    return 'A one-and-one trip requires the committing side to be in the one-and-one bonus window.'
  }
  return null
}

function freeThrowTripProgress(
  trip: Extract<BasketballMatchEvent, { eventType: 'basketball.free_throw_trip' }>,
  historicalAttempts: Extract<BasketballMatchEvent, { eventType: 'basketball.shot' }>[]
): Pick<BasketballFreeThrowTripStatus, 'nextAttemptNumber' | 'open' | 'closedReason'> {
  const firstAttempt = historicalAttempts.find(event => event.payload.tripAttemptNumber === 1)
  if (
    trip.payload.oneAndOne &&
    firstAttempt &&
    (firstAttempt.deletedAt !== null || !firstAttempt.payload.made)
  ) {
    return { nextAttemptNumber: null, open: false, closedReason: 'first_attempt_ended' }
  }
  const usedPositions = new Set(historicalAttempts.map(event => event.payload.tripAttemptNumber!))
  for (let position = 1; position <= trip.payload.maximumAttempts; position += 1) {
    if (!usedPositions.has(position)) {
      return { nextAttemptNumber: position, open: true, closedReason: null }
    }
  }
  return { nextAttemptNumber: null, open: false, closedReason: 'positions_complete' }
}

function commandContext(
  state: GameState,
  recorderUserId: string | null,
  occurredAt?: string
):
  | { ok: true; context: Exclude<ReturnType<typeof getBasketballCommandContext>, { ok: false }>['value'] }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string } {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballCommandContext(state, recorderUserId, occurredAt)
  return context.ok ? { ok: true, context: context.value } : failure(state, context.code, context.message)
}

function appendEvents(
  originalState: GameState,
  candidateState: GameState,
  events: BasketballMatchEvent[]
): BasketballFoulFreeThrowCommandResult {
  const appended = events.length === 1
    ? addGameEvent(candidateState, events[0], gameEventRegistry, gameEventProjectors)
    : addGameEvents(candidateState, events, gameEventRegistry, gameEventProjectors)
  if (!appended.ok || !appended.inspection.complete) {
    return failure(
      originalState,
      'command_failed',
      appended.ok
        ? 'Basketball foul/free-throw capture did not produce a complete event projection.'
        : appended.error.message
    )
  }
  return { ok: true, state: appended.state, eventIds: events.map(event => event.id) }
}

function basketballEvents(state: GameState):
  | { ok: true; active: BasketballMatchEvent[]; deleted: BasketballMatchEvent[] }
  | { ok: false; message: string } {
  if (!state.eventStream) return { ok: false, message: 'Basketball event history is unavailable.' }
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    return { ok: false, message: 'Basketball event history is incomplete.' }
  }
  return {
    ok: true,
    active: inspection.activeEvents.filter(isBasketballMatchEvent),
    deleted: inspection.deletedEvents.filter(isBasketballMatchEvent),
  }
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
}

function withCaptureTarget(
  state: GameState,
  teamSide: BasketballTeamSide,
  selection: BasketballCaptureActorSelection
): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
  return {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      capturePreferences: {
        ...state.sportGameState.capturePreferences,
        teamSide,
        selectedParticipantId: selection.kind === 'participant' ? selection.participantId : null,
        selectionInitialized: true,
        lastCourtUndo: null,
      },
    },
  }
}

function oppositeSide(side: BasketballTeamSide): BasketballTeamSide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballFoulFreeThrowCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}

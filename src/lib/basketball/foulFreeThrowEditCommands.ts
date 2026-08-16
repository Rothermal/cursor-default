import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventAppendsAndMutations } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor, GameEventMutation } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import {
  basketballActorForSelection,
  createBasketballCaptureCommandId,
  nextBasketballEventSequence,
  type BasketballCaptureActorSelection,
  type BasketballCommandErrorCode,
  type BasketballCommandResult,
} from './commands'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import { createBasketballUuid } from './id'
import {
  basketballShotActorOptions,
  type BasketballShotActorOption,
} from './shotEditCommands'
import { createBasketballStatEvent } from './statEvents'
import type {
  BasketballFoulClass,
  BasketballFoulContext,
  BasketballFoulCountingOverride,
  BasketballFoulEvent,
  BasketballFreeThrowTripEvent,
  BasketballMatchEvent,
  BasketballShotEvent,
  BasketballTeamSide,
} from './types'

export type BasketballFoulFreeThrowDraftType =
  | 'basketball.foul'
  | 'basketball.free_throw_trip'
  | 'basketball.free_throw_attempt'

export type BasketballFoulOffenderDraft =
  | { kind: 'participant'; participantId: string }
  | { kind: 'team' }
  | { kind: 'staff'; label: string }

export type BasketballFoulDrawnByDraft =
  | { kind: 'participant'; participantId: string }
  | { kind: 'unknown'; label: string }
  | { kind: 'none' }

export interface BasketballFoulFreeThrowDraft {
  eventId: string
  sourceFingerprint: string
  eventType: BasketballFoulFreeThrowDraftType
  period: { id: string; order: number }
  teamSide: BasketballTeamSide
  offender: BasketballFoulOffenderDraft
  foulClass: BasketballFoulClass
  foulContext: BasketballFoulContext
  teamControlSide: BasketballTeamSide | null
  incidentId: string
  drawnBy: BasketballFoulDrawnByDraft
  countingOverride: BasketballFoulCountingOverride | null
  maximumAttempts: 1 | 2 | 3
  oneAndOne: boolean
  sourceFoulEventId: string | null
  technical: boolean
  possessionRetained: boolean
  shooter: BasketballCaptureActorSelection
  made: boolean
  freeThrowTripId: string | null
  tripAttemptNumber: number | null
  addLinkedTrip: boolean
  newTripEventId: string
  captureCommandId: string
}

export interface BasketballFoulFreeThrowPreview {
  draft: BasketballFoulFreeThrowDraft
  mode: 'edit' | 'add'
  streamFingerprint: string
  occurredAt: string
  recorderUserId: string | null
  consequenceLines: string[]
  affectedEventIds: string[]
  appendedEventIds: string[]
  requiresConfirmation: true
}

export interface BasketballRelationshipOption {
  eventId: string | null
  label: string
}

export interface BasketballFoulFreeThrowEditorOptions {
  foulSources: BasketballRelationshipOption[]
  tripOptions: BasketballRelationshipOption[]
  positionOptions: number[]
}

export interface BasketballFoulFreeThrowOptionContext {
  eventId: string
  periodId: string
  teamSide: BasketballTeamSide
  freeThrowTripId: string | null
}

export type BasketballFoulFreeThrowCommandResult =
  | { ok: true; state: GameState; highlightEventId: string }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string }

interface PreparedState {
  state: GameState
  active: BasketballMatchEvent[]
  deleted: BasketballMatchEvent[]
}

interface EditPlan {
  appendedEvents: BasketballMatchEvent[]
  mutations: GameEventMutation[]
  consequenceLines: string[]
  validateTripEventIds: string[]
}

export function isBasketballEditableFoulFreeThrowEvent(
  event: BasketballMatchEvent
): event is BasketballFoulEvent | BasketballFreeThrowTripEvent | BasketballShotEvent {
  return event.eventType === 'basketball.foul' ||
    event.eventType === 'basketball.free_throw_trip' ||
    (event.eventType === 'basketball.shot' && event.payload.attempt === 'free_throw')
}

export function basketballResolvedPlayerOptions(
  state: GameState,
  side: BasketballTeamSide
): BasketballShotActorOption[] {
  const participants = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.participants
    : {}
  return basketballShotActorOptions(state, side).filter(option =>
    option.selection.kind === 'participant' &&
    Boolean(participants[option.selection.participantId]?.playerId)
  )
}

export function basketballFoulParticipantOptions(
  state: GameState,
  side: BasketballTeamSide
): BasketballShotActorOption[] {
  return basketballResolvedPlayerOptions(state, side)
}

export function basketballFoulFreeThrowEditorOptions(
  state: GameState,
  context: BasketballFoulFreeThrowOptionContext | null
): BasketballFoulFreeThrowEditorOptions {
  if (!context) return unavailableEditorOptions()
  const prepared = prepareState(state)
  if (!prepared.ok) return unavailableEditorOptions()
  return {
    foulSources: foulSourceOptions(prepared.value, context),
    tripOptions: freeThrowTripOptions(prepared.value, context),
    positionOptions: freeThrowPositionOptions(prepared.value, context),
  }
}

function unavailableEditorOptions(): BasketballFoulFreeThrowEditorOptions {
  return {
    foulSources: [{ eventId: null, label: 'No source foul' }],
    tripOptions: [{ eventId: null, label: 'Ungrouped free throw' }],
    positionOptions: [],
  }
}

function foulSourceOptions(
  prepared: PreparedState,
  context: BasketballFoulFreeThrowOptionContext
): BasketballRelationshipOption[] {
  const original = prepared.active.find(event => event.id === context.eventId)
  return [
    { eventId: null, label: 'No source foul' },
    ...prepared.active
      .filter((event): event is BasketballFoulEvent => event.eventType === 'basketball.foul')
      .filter(event =>
        event.period.id === context.periodId &&
        event.teamSide === oppositeSide(context.teamSide) &&
        (!original || compareGameEventCaptureOrder(event, original) < 0)
      )
      .map(event => ({ eventId: event.id, label: eventOptionLabel(prepared.state, event) })),
  ]
}

function freeThrowTripOptions(
  prepared: PreparedState,
  context: BasketballFoulFreeThrowOptionContext
): BasketballRelationshipOption[] {
  const original = prepared.active.find(event => event.id === context.eventId)
  return [
    { eventId: null, label: 'Ungrouped free throw' },
    ...prepared.active
      .filter((event): event is BasketballFreeThrowTripEvent => event.eventType === 'basketball.free_throw_trip')
      .filter(event =>
        event.period.id === context.periodId &&
        event.teamSide === context.teamSide &&
        (!original || compareGameEventCaptureOrder(event, original) < 0)
      )
      .map(event => ({ eventId: event.id, label: eventOptionLabel(prepared.state, event) })),
  ]
}

function freeThrowPositionOptions(
  prepared: PreparedState,
  context: BasketballFoulFreeThrowOptionContext
): number[] {
  if (!context.freeThrowTripId) return []
  const trip = prepared.active.find((event): event is BasketballFreeThrowTripEvent =>
    event.id === context.freeThrowTripId && event.eventType === 'basketball.free_throw_trip'
  )
  if (!trip) return []
  const occupied = new Set(
    [...prepared.active, ...prepared.deleted]
      .filter((event): event is BasketballShotEvent =>
        event.id !== context.eventId &&
        event.eventType === 'basketball.shot' &&
        event.payload.attempt === 'free_throw' &&
        event.payload.freeThrowTripId === trip.id &&
        event.payload.tripAttemptNumber !== null
      )
      .map(event => event.payload.tripAttemptNumber!)
  )
  return Array.from({ length: trip.payload.maximumAttempts }, (_, index) => index + 1)
    .filter(position => !occupied.has(position))
}

export function buildBasketballFoulFreeThrowEditDraft(
  state: GameState,
  eventId: string
): BasketballCommandResult<BasketballFoulFreeThrowDraft> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const event = prepared.value.active.find(candidate => candidate.id === eventId)
  if (!event || !isBasketballEditableFoulFreeThrowEvent(event)) {
    return commandFailure('command_failed', 'This active Basketball foul or free-throw event is unavailable for editing.')
  }
  const base = defaultDraft(prepared.value.state, event.period, event.teamSide, event.id)
  if (event.eventType === 'basketball.foul') {
    const committed = event.actors.find(actor => actor.role === 'committed_by')!
    const drawn = event.actors.find(actor => actor.role === 'drawn_by')
    return {
      ok: true,
      value: {
        ...base,
        eventType: 'basketball.foul',
        offender: foulOffenderToDraft(committed),
        foulClass: event.payload.class,
        foulContext: event.payload.context,
        teamControlSide: event.payload.teamControlSide,
        incidentId: event.payload.incidentId ?? '',
        drawnBy: drawnByToDraft(drawn),
        countingOverride: event.payload.countingOverride,
      },
    }
  }
  if (event.eventType === 'basketball.free_throw_trip') {
    return {
      ok: true,
      value: {
        ...base,
        eventType: 'basketball.free_throw_trip',
        maximumAttempts: event.payload.maximumAttempts,
        oneAndOne: event.payload.oneAndOne,
        sourceFoulEventId: event.payload.sourceFoulEventId,
        technical: event.payload.technical,
        possessionRetained: event.payload.possessionRetained,
      },
    }
  }
  const shooter = event.actors.find(actor => actor.role === 'shooter')!
  return {
    ok: true,
    value: {
      ...base,
      eventType: 'basketball.free_throw_attempt',
      shooter: actorToSelection(shooter),
      made: event.payload.made,
      freeThrowTripId: event.payload.freeThrowTripId,
      tripAttemptNumber: event.payload.tripAttemptNumber,
    },
  }
}

export function buildBasketballHistoricalFoulFreeThrowDraft(
  state: GameState,
  eventType: BasketballFoulFreeThrowDraftType
): BasketballCommandResult<BasketballFoulFreeThrowDraft> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const sportState = prepared.value.state.sportGameState
  if (sportState?.sportId !== 'basketball') {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const period = sportState.projection.periods.find(candidate => candidate.id === sportState.projection.currentPeriodId) ??
    sportState.projection.periods.find(candidate => sportState.projection.startedPeriodIds.includes(candidate.id))
  if (!period) return commandFailure('invalid_period', 'Start a Basketball period before adding an event.')
  const defaultSide: BasketballTeamSide = 'tracked'
  const participant = basketballFoulParticipantOptions(prepared.value.state, defaultSide)[0]?.selection
  const shooter = basketballResolvedPlayerOptions(prepared.value.state, defaultSide)[0]?.selection
  if (eventType === 'basketball.free_throw_attempt' && !shooter) {
    return commandFailure('invalid_actor', 'Add a resolved Basketball participant before adding a free throw.')
  }
  return {
    ok: true,
    value: {
      ...defaultDraft(prepared.value.state, period, defaultSide, createBasketballUuid()),
      eventType,
      offender: participant?.kind === 'participant' ? participant : { kind: 'team' },
      shooter: shooter ?? { kind: 'team' },
    },
  }
}

export function previewBasketballFoulFreeThrowEdit(
  state: GameState,
  draft: BasketballFoulFreeThrowDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballFoulFreeThrowPreview> {
  return previewChange(state, draft, 'edit', recorderUserId, now)
}

export function previewBasketballHistoricalFoulFreeThrow(
  state: GameState,
  draft: BasketballFoulFreeThrowDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballFoulFreeThrowPreview> {
  return previewChange(state, draft, 'add', recorderUserId, now)
}

export function applyBasketballFoulFreeThrowChange(
  state: GameState,
  preview: BasketballFoulFreeThrowPreview
): BasketballFoulFreeThrowCommandResult {
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the event again before saving.')
  }
  const prepared = prepareState(state)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const plan = buildPlan(prepared.value, preview.draft, preview.mode, preview.recorderUserId, preview.occurredAt)
  if (!plan.ok) return failure(state, plan.code, plan.message)
  if (
    !sameStringSet(plan.value.mutations.map(item => item.eventId), preview.affectedEventIds) ||
    !sameStringSet(plan.value.appendedEvents.map(event => event.id), preview.appendedEventIds)
  ) {
    return failure(state, 'command_failed', 'The event consequences changed. Review them again before saving.')
  }
  const applied = applyPlan(prepared.value.state, plan.value, preview.occurredAt)
  if (!applied.ok) return failure(state, applied.code, applied.message)
  return {
    ok: true,
    state: reconcileBasketballPlayerRows(applied.value),
    highlightEventId: preview.draft.eventId,
  }
}

function previewChange(
  state: GameState,
  draft: BasketballFoulFreeThrowDraft,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  now: string
): BasketballCommandResult<BasketballFoulFreeThrowPreview> {
  const occurredAt = validTimestamp(now)
  if (!occurredAt) return commandFailure('invalid_timestamp', 'Basketball correction timestamp is invalid.')
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const fingerprint = eventStreamFingerprint(prepared.value.state)
  if (fingerprint !== draft.sourceFingerprint) {
    return commandFailure('command_failed', 'The Timeline changed. Reopen the event editor before saving.')
  }
  const plan = buildPlan(prepared.value, draft, mode, recorderUserId, occurredAt)
  if (!plan.ok) return plan
  if (plan.value.appendedEvents.length === 0 && plan.value.mutations.length === 0) {
    return commandFailure('command_failed', 'Change at least one event field before saving.')
  }
  const applied = applyPlan(prepared.value.state, plan.value, occurredAt)
  if (!applied.ok) return applied
  return {
    ok: true,
    value: {
      draft,
      mode,
      streamFingerprint: fingerprint,
      occurredAt,
      recorderUserId,
      consequenceLines: plan.value.consequenceLines,
      affectedEventIds: plan.value.mutations.map(item => item.eventId),
      appendedEventIds: plan.value.appendedEvents.map(event => event.id),
      requiresConfirmation: true,
    },
  }
}

function buildPlan(
  prepared: PreparedState,
  draft: BasketballFoulFreeThrowDraft,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<EditPlan> {
  const period = prepared.state.sportGameState?.sportId === 'basketball'
    ? prepared.state.sportGameState.projection.periods.find(candidate =>
        candidate.id === draft.period.id && candidate.order === draft.period.order
      )
    : null
  if (!period || !prepared.state.sportGameState?.projection.startedPeriodIds.includes(period.id)) {
    return commandFailure('invalid_period', 'Select a Basketball period that has already started.')
  }
  const existing = mode === 'edit'
    ? prepared.active.find(event => event.id === draft.eventId)
    : null
  if (mode === 'edit' && (!existing || draftTypeForEvent(existing) !== draft.eventType)) {
    return commandFailure('command_failed', 'The selected Basketball event is unavailable or changed type.')
  }
  if (draft.eventType === 'basketball.foul') {
    return buildFoulPlan(prepared, draft, existing as BasketballFoulEvent | null, mode, recorderUserId, occurredAt)
  }
  if (draft.eventType === 'basketball.free_throw_trip') {
    return buildTripPlan(prepared, draft, existing as BasketballFreeThrowTripEvent | null, mode, recorderUserId, occurredAt)
  }
  return buildAttemptPlan(prepared, draft, existing as BasketballShotEvent | null, mode, recorderUserId, occurredAt)
}

function buildFoulPlan(
  prepared: PreparedState,
  draft: BasketballFoulFreeThrowDraft,
  existing: BasketballFoulEvent | null,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<EditPlan> {
  const offender = buildFoulOffender(prepared.state, draft.teamSide, draft.offender)
  if (!offender.ok) return offender
  const drawnBy = buildDrawnBy(prepared.state, draft.teamSide, draft.drawnBy)
  if (!drawnBy.ok) return drawnBy
  if (draft.foulContext === 'offensive' && draft.teamControlSide !== null && draft.teamControlSide !== draft.teamSide) {
    return commandFailure('command_failed', 'An offensive foul must use the committing side as team control.')
  }
  const override = draft.countingOverride
    ? { ...draft.countingOverride, reason: draft.countingOverride.reason.trim() }
    : null
  if (override && !override.reason) {
    return commandFailure('command_failed', 'Exceptional foul counting requires a reason.')
  }
  const payload = {
    class: draft.foulClass,
    context: draft.foulContext,
    teamControlSide: draft.foulContext === 'offensive' ? draft.teamSide : draft.teamControlSide,
    incidentId: draft.incidentId.trim() || null,
    countingOverride: override,
    captureCommandId: existing?.payload.captureCommandId ?? (draft.addLinkedTrip ? draft.captureCommandId : null),
  }
  const actors = drawnBy.value ? [offender.value, drawnBy.value] : [offender.value]
  const appendedEvents: BasketballMatchEvent[] = []
  const mutations: GameEventMutation[] = []
  const lines: string[] = []
  let nextSequence = nextBasketballEventSequence(prepared.state.eventStream!.events, recorderUserId)
  if (mode === 'add') {
    const foulEvent = createBasketballAdministrativeEvent({
      id: draft.eventId,
      eventType: 'basketball.foul',
      payload,
      recorderUserId,
      sequence: nextSequence++,
      period: draft.period,
      occurredAt,
      teamSide: draft.teamSide,
      actors,
    })
    appendedEvents.push(foulEvent)
    lines.push(`Add a foul to ${periodLabel(prepared.state, draft.period.id)}.`)
    if (draft.addLinkedTrip) {
      const tripError = validateTripFields(prepared.state, draft, foulEvent)
      if (tripError) return commandFailure('command_failed', tripError)
      appendedEvents.push(createBasketballStatEvent({
        id: draft.newTripEventId,
        eventType: 'basketball.free_throw_trip',
        payload: {
          maximumAttempts: draft.maximumAttempts,
          oneAndOne: draft.oneAndOne,
          sourceFoulEventId: draft.eventId,
          technical: draft.technical,
          possessionRetained: draft.possessionRetained,
          captureCommandId: draft.captureCommandId,
        },
        recorderUserId,
        sequence: nextSequence,
        period: draft.period,
        occurredAt,
        teamSide: oppositeSide(draft.teamSide),
      }))
      lines.push(`Add a linked ${draft.maximumAttempts}-position free-throw award.`)
    }
  } else if (existing) {
    if (!sameJson({ payload: existing.payload, actors: existing.actors, teamSide: existing.teamSide }, { payload, actors, teamSide: draft.teamSide })) {
      mutations.push({ type: 'update', eventId: existing.id, changes: { payload, actors, teamSide: draft.teamSide } })
      lines.push('Update the foul attribution and structured ruling fields.')
    }
    const dependents = foulDependencyRepairs(prepared, existing, draft.teamSide, offender.value, payload)
    mutations.push(...dependents.mutations)
    lines.push(...dependents.lines)
  }
  return {
    ok: true,
    value: {
      appendedEvents,
      mutations,
      consequenceLines: lines,
      validateTripEventIds: draft.addLinkedTrip ? [draft.newTripEventId] : [],
    },
  }
}

function buildTripPlan(
  prepared: PreparedState,
  draft: BasketballFoulFreeThrowDraft,
  existing: BasketballFreeThrowTripEvent | null,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<EditPlan> {
  const source = draft.sourceFoulEventId
    ? prepared.active.find((event): event is BasketballFoulEvent =>
        event.id === draft.sourceFoulEventId && event.eventType === 'basketball.foul'
      ) ?? null
    : null
  if (draft.sourceFoulEventId && !source) {
    return commandFailure('command_failed', 'The selected source foul is unavailable.')
  }
  if (source && !sourceFoulCompatible(source, draft, existing)) {
    return commandFailure('command_failed', 'The selected foul is not compatible with this free-throw award.')
  }
  const fieldError = validateTripFields(prepared.state, draft, source)
  if (fieldError) return commandFailure('command_failed', fieldError)
  const payload = {
    maximumAttempts: draft.maximumAttempts,
    oneAndOne: draft.oneAndOne,
    sourceFoulEventId: draft.sourceFoulEventId,
    technical: draft.technical,
    possessionRetained: draft.possessionRetained,
    captureCommandId: existing?.payload.captureCommandId ?? null,
  }
  const appendedEvents: BasketballMatchEvent[] = []
  const mutations: GameEventMutation[] = []
  const lines: string[] = []
  if (mode === 'add') {
    appendedEvents.push(createBasketballStatEvent({
      id: draft.eventId,
      eventType: 'basketball.free_throw_trip',
      payload,
      recorderUserId,
      sequence: nextBasketballEventSequence(prepared.state.eventStream!.events, recorderUserId),
      period: draft.period,
      occurredAt,
      teamSide: draft.teamSide,
    }))
    lines.push(`Add a ${draft.maximumAttempts}-position free-throw award to ${periodLabel(prepared.state, draft.period.id)}.`)
  } else if (existing) {
    if (!sameJson({ payload: existing.payload, teamSide: existing.teamSide }, { payload, teamSide: draft.teamSide })) {
      mutations.push({ type: 'update', eventId: existing.id, changes: { payload, teamSide: draft.teamSide } })
      lines.push('Update the free-throw award fields without renumbering attempts.')
    }
    const repairs = tripAttemptRepairs(prepared, existing.id, draft)
    mutations.push(...repairs.mutations)
    lines.push(...repairs.lines)
  }
  return {
    ok: true,
    value: {
      appendedEvents,
      mutations,
      consequenceLines: lines,
      validateTripEventIds: [draft.eventId],
    },
  }
}

function buildAttemptPlan(
  prepared: PreparedState,
  draft: BasketballFoulFreeThrowDraft,
  existing: BasketballShotEvent | null,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<EditPlan> {
  const shooter = basketballActorForSelection(
    prepared.state,
    'shooter',
    draft.teamSide,
    draft.shooter,
    { allowUnavailable: true }
  )
  if (!shooter.ok || shooter.value.kind !== 'player') {
    return commandFailure(
      shooter.ok ? 'invalid_actor' : shooter.code,
      shooter.ok ? 'Free throws require a resolved Basketball player.' : shooter.message
    )
  }
  const trip = draft.freeThrowTripId
    ? prepared.active.find((event): event is BasketballFreeThrowTripEvent =>
        event.id === draft.freeThrowTripId && event.eventType === 'basketball.free_throw_trip'
      )
    : null
  if (draft.freeThrowTripId && !trip) {
    return commandFailure('command_failed', 'The selected free-throw award is unavailable.')
  }
  if (trip) {
    if (
      trip.teamSide !== draft.teamSide ||
      trip.period.id !== draft.period.id ||
      (existing && compareGameEventCaptureOrder(trip, existing) >= 0)
    ) {
      return commandFailure('command_failed', 'The selected free-throw award is not compatible with this attempt.')
    }
    if (!draft.tripAttemptNumber || draft.tripAttemptNumber > trip.payload.maximumAttempts) {
      return commandFailure('command_failed', 'Select an available position in the free-throw award.')
    }
    const collision = [...prepared.active, ...prepared.deleted].some(event =>
      event.id !== draft.eventId &&
      event.eventType === 'basketball.shot' &&
      event.payload.attempt === 'free_throw' &&
      event.payload.freeThrowTripId === trip.id &&
      event.payload.tripAttemptNumber === draft.tripAttemptNumber
    )
    if (collision) return commandFailure('command_failed', 'That free-throw position is already consumed.')
    if (trip.payload.oneAndOne && draft.tripAttemptNumber === 2) {
      const first = prepared.active.find(event =>
        event.eventType === 'basketball.shot' &&
        event.payload.attempt === 'free_throw' &&
        event.payload.freeThrowTripId === trip.id &&
        event.payload.tripAttemptNumber === 1 &&
        event.id !== draft.eventId
      )
      if (!first || first.eventType !== 'basketball.shot' || !first.payload.made) {
        return commandFailure('command_failed', 'A one-and-one second attempt requires a made active first attempt.')
      }
    }
  } else if (draft.tripAttemptNumber !== null) {
    return commandFailure('command_failed', 'An ungrouped free throw cannot keep a trip position.')
  }
  const payload = {
    value: 1 as const,
    made: draft.made,
    attempt: 'free_throw' as const,
    valueSource: 'free_throw' as const,
    freeThrowTripId: trip?.id ?? null,
    tripAttemptNumber: trip ? draft.tripAttemptNumber : null,
    captureCommandId: existing?.payload.captureCommandId ?? null,
  }
  const appendedEvents: BasketballMatchEvent[] = []
  const mutations: GameEventMutation[] = []
  const lines: string[] = []
  if (mode === 'add') {
    appendedEvents.push(createBasketballStatEvent({
      id: draft.eventId,
      eventType: 'basketball.shot',
      payload,
      recorderUserId,
      sequence: nextBasketballEventSequence(prepared.state.eventStream!.events, recorderUserId),
      period: draft.period,
      occurredAt,
      teamSide: draft.teamSide,
      actors: [shooter.value],
    }))
    lines.push(`Add a ${draft.made ? 'made' : 'missed'} free throw to ${periodLabel(prepared.state, draft.period.id)}.`)
  } else if (existing) {
    if (!sameJson({ payload: existing.payload, teamSide: existing.teamSide, actors: existing.actors }, { payload, teamSide: draft.teamSide, actors: [shooter.value] })) {
      mutations.push({ type: 'update', eventId: existing.id, changes: { payload, teamSide: draft.teamSide, actors: [shooter.value] } })
      lines.push('Update the free-throw shooter, result, or stable trip position.')
    }
    const oneAndOneTripsToRepair = new Set<string>()
    const previousTrip = existing.payload.freeThrowTripId
      ? prepared.active.find((event): event is BasketballFreeThrowTripEvent =>
          event.id === existing.payload.freeThrowTripId && event.eventType === 'basketball.free_throw_trip'
        )
      : null
    if (
      previousTrip?.payload.oneAndOne &&
      existing.payload.tripAttemptNumber === 1 &&
      (
        trip?.id !== previousTrip.id ||
        draft.tripAttemptNumber !== 1 ||
        !draft.made
      )
    ) {
      oneAndOneTripsToRepair.add(previousTrip.id)
    }
    if (trip?.payload.oneAndOne && draft.tripAttemptNumber === 1 && !draft.made) {
      oneAndOneTripsToRepair.add(trip.id)
    }
    for (const tripId of oneAndOneTripsToRepair) {
      for (const second of prepared.active.filter((event): event is BasketballShotEvent =>
        event.eventType === 'basketball.shot' &&
        event.payload.attempt === 'free_throw' &&
        event.payload.freeThrowTripId === tripId &&
        event.payload.tripAttemptNumber === 2 &&
        event.id !== draft.eventId
      )) {
        mutations.push(ungroupAttemptMutation(second))
        lines.push('The existing second one-and-one attempt will remain recorded but become ungrouped.')
      }
    }
  }
  return {
    ok: true,
    value: { appendedEvents, mutations, consequenceLines: lines, validateTripEventIds: [] },
  }
}

function applyPlan(
  state: GameState,
  plan: EditPlan,
  occurredAt: string
): BasketballCommandResult<GameState> {
  const baseline = clearQuickUndoReceipt(state)
  const candidateError = validateUpdateCandidates(baseline, plan.mutations, occurredAt)
  if (candidateError) return commandFailure('command_failed', candidateError)
  const result = applyGameEventAppendsAndMutations(
    baseline,
    plan.appendedEvents,
    plan.mutations,
    occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return commandFailure('command_failed', result.ok
      ? 'The foul or free-throw change did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return commandFailure('command_failed', `This change would create an invalid relationship: ${warning}`)
  for (const tripId of plan.validateTripEventIds) {
    const oneAndOneError = validateOneAndOneAtCapture(result.state, tripId)
    if (oneAndOneError) return commandFailure('command_failed', oneAndOneError)
  }
  return { ok: true, value: result.state }
}

function validateUpdateCandidates(
  state: GameState,
  mutations: GameEventMutation[],
  occurredAt: string
): string | null {
  if (!state.eventStream) return 'Basketball event history is unavailable.'
  for (const mutation of mutations) {
    if (mutation.type !== 'update') continue
    const raw = state.eventStream.events.find(event =>
      isGameEventEnvelope(event) && event.id === mutation.eventId
    )
    if (!raw) return `Basketball event ${mutation.eventId} is unavailable.`
    const inspected = gameEventRegistry.inspect(raw)
    if (!inspected.ok) return `Basketball event ${mutation.eventId} is quarantined.`
    const candidate = {
      ...inspected.event,
      ...mutation.changes,
      id: inspected.event.id,
      sportId: inspected.event.sportId,
      eventType: inspected.event.eventType,
      recorderUserId: inspected.event.recorderUserId,
      sequence: inspected.event.sequence,
      createdAt: inspected.event.createdAt,
      revision: inspected.event.revision + 1,
      updatedAt: occurredAt,
      deletedAt: null,
    }
    const validation = gameEventRegistry.inspect(candidate)
    if (!validation.ok) {
      return `${inspected.event.eventType} could not be updated: ${validation.diagnostic.message}`
    }
  }
  return null
}

function foulDependencyRepairs(
  prepared: PreparedState,
  original: BasketballFoulEvent,
  teamSide: BasketballTeamSide,
  offender: GameEventActor,
  payload: BasketballFoulEvent['payload']
): { mutations: GameEventMutation[]; lines: string[] } {
  const mutations: GameEventMutation[] = []
  const lines: string[] = []
  for (const event of prepared.active) {
    if (event.eventType === 'basketball.free_throw_trip' && event.payload.sourceFoulEventId === original.id) {
      const compatible = event.teamSide === oppositeSide(teamSide) &&
        event.period.id === original.period.id &&
        event.payload.technical === foulCounts(payload, offender).technical &&
        (!event.payload.oneAndOne || (
          !event.payload.technical &&
          foulCounts(payload, offender).teamFoul &&
          prepared.state.sportGameState?.sportId === 'basketball' &&
          prepared.state.sportGameState.setup.rulesSnapshot.hasOneAndOne
        ))
      if (!compatible) {
        mutations.push({
          type: 'update',
          eventId: event.id,
          changes: {
            payload: {
              ...event.payload,
              sourceFoulEventId: null,
              oneAndOne: false,
            },
          },
        })
        lines.push(event.payload.oneAndOne
          ? 'An incompatible free-throw award will remain recorded without a source-foul link or one-and-one status.'
          : 'An incompatible free-throw award will remain recorded without a source-foul link.')
      }
    }
    if (event.eventType === 'basketball.ejection' && event.payload.relatedFoulEventId === original.id) {
      const subject = event.actors.find(actor => actor.role === 'subject')
      if (event.teamSide === teamSide && sameActor(subject, offender)) {
        if (
          event.payload.source !== 'automatic_threshold' ||
          automaticThresholdSatisfied(prepared, event, original, offender, payload)
        ) continue
        mutations.push({ type: 'delete', eventId: event.id })
        lines.push('An automatic ejection no longer supported by the foul total will also be removed.')
        continue
      }
      if (event.payload.source === 'automatic_threshold') {
        mutations.push({ type: 'delete', eventId: event.id })
        lines.push('An incompatible automatic ejection will also be removed.')
      } else {
        mutations.push({
          type: 'update',
          eventId: event.id,
          changes: { payload: { ...event.payload, relatedFoulEventId: null } },
        })
        lines.push('An incompatible official ejection will remain recorded without a source-foul link.')
      }
    }
  }
  return { mutations, lines }
}

function automaticThresholdSatisfied(
  prepared: PreparedState,
  ejection: Extract<BasketballMatchEvent, { eventType: 'basketball.ejection' }>,
  original: BasketballFoulEvent,
  replacementOffender: GameEventActor,
  replacementPayload: BasketballFoulEvent['payload']
): boolean {
  const subject = ejection.actors.find(actor => actor.role === 'subject')
  if (!subject?.participantId || prepared.state.sportGameState?.sportId !== 'basketball') return false
  let count = 0
  for (const event of [...prepared.active].sort(compareGameEventCaptureOrder)) {
    if (compareGameEventCaptureOrder(event, ejection) >= 0) break
    if (event.eventType !== 'basketball.foul') continue
    const offender = event.id === original.id
      ? replacementOffender
      : event.actors.find(actor => actor.role === 'committed_by')
    const payload = event.id === original.id ? replacementPayload : event.payload
    if (
      offender?.participantId === subject.participantId &&
      foulCounts(payload, offender).personalFoul
    ) count += 1
  }
  return count >= prepared.state.sportGameState.setup.rulesSnapshot.personalFoulLimit
}

function tripAttemptRepairs(
  prepared: PreparedState,
  tripId: string,
  draft: BasketballFoulFreeThrowDraft
): { mutations: GameEventMutation[]; lines: string[] } {
  const linked = prepared.active.filter((event): event is BasketballShotEvent =>
    event.eventType === 'basketball.shot' &&
    event.payload.attempt === 'free_throw' &&
    event.payload.freeThrowTripId === tripId
  )
  const first = linked.find(event => event.payload.tripAttemptNumber === 1)
  const invalid = linked.filter(event =>
    event.teamSide !== draft.teamSide ||
    event.payload.tripAttemptNumber === null ||
    event.payload.tripAttemptNumber > draft.maximumAttempts ||
    (draft.oneAndOne && event.payload.tripAttemptNumber === 2 && (!first || !first.payload.made))
  )
  return {
    mutations: invalid.map(ungroupAttemptMutation),
    lines: invalid.length > 0
      ? [`${invalid.length} incompatible free-throw ${invalid.length === 1 ? 'attempt' : 'attempts'} will remain recorded but become ungrouped; other positions will not renumber.`]
      : [],
  }
}

function ungroupAttemptMutation(event: BasketballShotEvent): GameEventMutation {
  return {
    type: 'update',
    eventId: event.id,
    changes: {
      payload: { ...event.payload, freeThrowTripId: null, tripAttemptNumber: null },
    },
  }
}

function buildFoulOffender(
  state: GameState,
  side: BasketballTeamSide,
  draft: BasketballFoulOffenderDraft
): BasketballCommandResult<GameEventActor> {
  if (draft.kind === 'staff') {
    const label = draft.label.trim()
    return label
      ? { ok: true, value: { role: 'committed_by', kind: 'staff', label } }
      : commandFailure('invalid_actor', 'Enter a Basketball staff label.')
  }
  const selection: BasketballCaptureActorSelection = draft.kind === 'team'
    ? { kind: 'team' }
    : { kind: 'participant', participantId: draft.participantId }
  const actor = basketballActorForSelection(state, 'committed_by', side, selection, { allowUnavailable: true })
  if (!actor.ok) return actor
  if (draft.kind === 'participant' && actor.value.kind !== 'player') {
    return commandFailure('invalid_actor', 'Player fouls require a resolved Basketball player.')
  }
  return actor
}

function buildDrawnBy(
  state: GameState,
  foulSide: BasketballTeamSide,
  draft: BasketballFoulDrawnByDraft
): BasketballCommandResult<GameEventActor | null> {
  if (draft.kind === 'none') return { ok: true, value: null }
  const side = oppositeSide(foulSide)
  const selection: BasketballCaptureActorSelection = draft.kind === 'participant'
    ? { kind: 'participant', participantId: draft.participantId }
    : { kind: 'unknown', label: draft.label.trim() }
  if (draft.kind === 'unknown' && !draft.label.trim()) {
    return commandFailure('invalid_actor', 'Enter an unknown drawn-by label.')
  }
  const actor = basketballActorForSelection(state, 'drawn_by', side, selection, { allowUnavailable: true })
  if (!actor.ok) return actor
  if (draft.kind === 'participant' && actor.value.kind !== 'player') {
    return commandFailure('invalid_actor', 'The player drawing the foul must have resolved identity.')
  }
  return actor
}

function validateTripFields(
  state: GameState,
  draft: BasketballFoulFreeThrowDraft,
  source: BasketballFoulEvent | null
): string | null {
  if (draft.oneAndOne && draft.maximumAttempts !== 2) {
    return 'A one-and-one free-throw award must use two maximum positions.'
  }
  if (source) {
    const offender = source.actors.find(actor => actor.role === 'committed_by')!
    const counts = foulCounts(source.payload, offender)
    if (draft.technical !== counts.technical) {
      return 'The free-throw technical flag must match the source foul.'
    }
    if (draft.oneAndOne && (!counts.teamFoul || counts.technical)) {
      return 'A one-and-one award requires a nontechnical foul that counts as a team foul.'
    }
  } else if (draft.oneAndOne) {
    return 'A one-and-one award requires a compatible source foul.'
  }
  if (draft.oneAndOne && (
    state.sportGameState?.sportId !== 'basketball' ||
    !state.sportGameState.setup.rulesSnapshot.hasOneAndOne
  )) {
    return 'The Basketball rules snapshot does not allow one-and-one free throws.'
  }
  return null
}

function validateOneAndOneAtCapture(state: GameState, tripEventId: string): string | null {
  if (!state.eventStream) return 'Basketball event history is unavailable.'
  const index = state.eventStream.events.findIndex(raw => isGameEventEnvelope(raw) && raw.id === tripEventId)
  if (index < 0) return 'The free-throw award is unavailable after validation.'
  const tripRaw = state.eventStream.events[index]
  const inspected = gameEventRegistry.inspect(tripRaw)
  if (!inspected.ok || inspected.event.eventType !== 'basketball.free_throw_trip') return null
  const trip = inspected.event as BasketballFreeThrowTripEvent
  if (!trip.payload.oneAndOne) return null
  const sourceId = trip.payload.sourceFoulEventId
  if (!sourceId) return 'A one-and-one award requires a source foul.'
  const sourceRaw = state.eventStream.events.find(raw => isGameEventEnvelope(raw) && raw.id === sourceId)
  const sourceInspected = sourceRaw ? gameEventRegistry.inspect(sourceRaw) : null
  if (!sourceInspected?.ok || sourceInspected.event.eventType !== 'basketball.foul') {
    return 'The one-and-one source foul is unavailable.'
  }
  const prefixState = {
    ...state,
    eventStream: { ...state.eventStream, events: state.eventStream.events.slice(0, index + 1) },
  }
  const rebuilt = rebuildGameEventProjection(prefixState, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete || rebuilt.state.sportGameState?.sportId !== 'basketball') {
    return 'The one-and-one award could not be validated at its capture position.'
  }
  const status = rebuilt.state.sportGameState.projection.bonusStatusByPeriod[trip.period.id]?.[
    sourceInspected.event.teamSide as BasketballTeamSide
  ]
  return status === 'one_and_one'
    ? null
    : 'A one-and-one award requires the committing side to be in the one-and-one bonus window.'
}

function sourceFoulCompatible(
  foul: BasketballFoulEvent,
  draft: BasketballFoulFreeThrowDraft,
  existing: BasketballFreeThrowTripEvent | null
): boolean {
  return foul.period.id === draft.period.id &&
    foul.teamSide === oppositeSide(draft.teamSide) &&
    (!existing || compareGameEventCaptureOrder(foul, existing) < 0)
}

function foulCounts(
  payload: BasketballFoulEvent['payload'],
  offender: GameEventActor
): { personalFoul: boolean; teamFoul: boolean; technical: boolean } {
  return payload.countingOverride ?? {
    personalFoul: offender.kind === 'player',
    teamFoul: true,
    technical: payload.class === 'technical',
  }
}

function defaultDraft(
  state: GameState,
  period: { id: string; order: number },
  teamSide: BasketballTeamSide,
  eventId: string
): BasketballFoulFreeThrowDraft {
  const offender = basketballFoulParticipantOptions(state, teamSide)[0]?.selection
  const shooter = basketballResolvedPlayerOptions(state, teamSide)[0]?.selection
  return {
    eventId,
    sourceFingerprint: eventStreamFingerprint(state),
    eventType: 'basketball.foul',
    period: { id: period.id, order: period.order },
    teamSide,
    offender: offender?.kind === 'participant' ? offender : { kind: 'team' },
    foulClass: 'personal',
    foulContext: 'common',
    teamControlSide: null,
    incidentId: '',
    drawnBy: { kind: 'none' },
    countingOverride: null,
    maximumAttempts: 2,
    oneAndOne: false,
    sourceFoulEventId: null,
    technical: false,
    possessionRetained: false,
    shooter: shooter ?? { kind: 'team' },
    made: true,
    freeThrowTripId: null,
    tripAttemptNumber: null,
    addLinkedTrip: false,
    newTripEventId: createBasketballUuid(),
    captureCommandId: createBasketballCaptureCommandId(),
  }
}

function foulOffenderToDraft(actor: GameEventActor): BasketballFoulOffenderDraft {
  if (actor.kind === 'staff') return { kind: 'staff', label: actor.label }
  if (actor.kind === 'team') return { kind: 'team' }
  return actor.participantId
    ? { kind: 'participant', participantId: actor.participantId }
    : { kind: 'team' }
}

function drawnByToDraft(actor: GameEventActor | undefined): BasketballFoulDrawnByDraft {
  if (!actor) return { kind: 'none' }
  if (actor.participantId) return { kind: 'participant', participantId: actor.participantId }
  return { kind: 'unknown', label: actor.label || 'Unknown player' }
}

function actorToSelection(actor: GameEventActor): BasketballCaptureActorSelection {
  if (actor.participantId) return { kind: 'participant', participantId: actor.participantId }
  if (actor.kind === 'team') return { kind: 'team' }
  return { kind: 'unknown', label: actor.label || 'Unknown participant' }
}

function draftTypeForEvent(event: BasketballMatchEvent): BasketballFoulFreeThrowDraftType | null {
  if (event.eventType === 'basketball.foul') return 'basketball.foul'
  if (event.eventType === 'basketball.free_throw_trip') return 'basketball.free_throw_trip'
  if (event.eventType === 'basketball.shot' && event.payload.attempt === 'free_throw') {
    return 'basketball.free_throw_attempt'
  }
  return null
}

function eventOptionLabel(state: GameState, event: BasketballFoulEvent | BasketballFreeThrowTripEvent): string {
  const period = periodLabel(state, event.period.id)
  if (event.eventType === 'basketball.foul') {
    const actor = event.actors.find(candidate => candidate.role === 'committed_by')
    return `${period}: ${actor?.label || 'Team'} - ${event.payload.class.replace(/_/g, ' ')}`
  }
  return `${period}: ${event.payload.maximumAttempts} free throw${event.payload.maximumAttempts === 1 ? '' : 's'}${event.payload.oneAndOne ? ' (1-and-1)' : ''}`
}

function periodLabel(state: GameState, periodId: string): string {
  return state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.periods.find(period => period.id === periodId)?.label ?? periodId
    : periodId
}

function prepareState(state: GameState): BasketballCommandResult<PreparedState> {
  if (
    state.sport?.id !== 'basketball' ||
    state.gameDataAuthority !== 'sport_events' ||
    state.sportGameState?.sportId !== 'basketball' ||
    !state.eventStream
  ) return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  if (isFinalBasketballCloudGame(state)) {
    return commandFailure('cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete || rebuilt.state.sportGameState?.sportId !== 'basketball' || !rebuilt.state.eventStream) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before editing events.')
  }
  const status = rebuilt.state.sportGameState.projection.status
  if (status !== 'in_progress' && status !== 'period_break') {
    return commandFailure('invalid_period', 'Reopen the Basketball game before editing events.')
  }
  const inspection = inspectGameEventStream(rebuilt.state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before editing events.')
  }
  return {
    ok: true,
    value: {
      state: rebuilt.state,
      active: inspection.activeEvents.filter(isBasketballMatchEvent),
      deleted: inspection.deletedEvents.filter(isBasketballMatchEvent),
    },
  }
}

function firstNewRelationshipWarning(before: GameState, after: GameState): string | null {
  if (before.sportGameState?.sportId !== 'basketball' || after.sportGameState?.sportId !== 'basketball') {
    return 'Basketball projection is unavailable.'
  }
  const baseline = new Set(before.sportGameState.projection.relationshipWarnings.map(warning =>
    `${warning.eventId}\u0000${warning.relatedEventId}\u0000${warning.message}`
  ))
  return after.sportGameState.projection.relationshipWarnings.find(warning =>
    !baseline.has(`${warning.eventId}\u0000${warning.relatedEventId}\u0000${warning.message}`)
  )?.message ?? null
}

function clearQuickUndoReceipt(state: GameState): GameState {
  if (state.sportGameState?.sportId !== 'basketball' || !state.sportGameState.capturePreferences.lastCourtUndo) {
    return state
  }
  return {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      capturePreferences: { ...state.sportGameState.capturePreferences, lastCourtUndo: null },
    },
  }
}

function eventStreamFingerprint(state: GameState): string {
  return (state.eventStream?.events ?? []).map(raw =>
    isGameEventEnvelope(raw)
      ? `${raw.id}:${raw.revision}:${raw.updatedAt}:${raw.deletedAt ?? ''}`
      : JSON.stringify(raw)
  ).join('|')
}

function validTimestamp(value: string): string | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function sameActor(left: GameEventActor | undefined, right: GameEventActor | undefined): boolean {
  if (!left || !right) return false
  if (left.participantId || right.participantId) {
    return Boolean(left.participantId && left.participantId === right.participantId)
  }
  return left.kind === right.kind && left.label === right.label
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value))
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function oppositeSide(side: BasketballTeamSide): BasketballTeamSide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
}

function commandFailure<T>(code: BasketballCommandErrorCode, message: string): BasketballCommandResult<T> {
  return { ok: false, code, message }
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballFoulFreeThrowCommandResult {
  return { ok: false, state, code, message }
}

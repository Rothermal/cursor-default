import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventAppendsAndMutations } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor, GameEventMutation } from '../gameEvents/types'
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
import { isBasketballTimelineCorrectionProjection } from './correctionAvailability'
import { createBasketballUuid } from './id'
import { defaultBasketballHistoricalTime, validateBasketballHistoricalTime } from './historicalTime'
import {
  basketballShotActorOptions,
  basketballShotActorSelectionKey,
  type BasketballShotActorOption,
} from './shotEditCommands'
import { createBasketballStatEvent } from './statEvents'
import type {
  BasketballAssistEvent,
  BasketballBlockEvent,
  BasketballMatchEvent,
  BasketballReboundEvent,
  BasketballShotEvent,
  BasketballStealEvent,
  BasketballTeamSide,
  BasketballTurnoverEvent,
} from './types'

export type BasketballEditableRelatedEventType =
  | 'basketball.assist'
  | 'basketball.rebound'
  | 'basketball.steal'
  | 'basketball.block'
  | 'basketball.turnover'

export type BasketballHistoricalRelatedEventType =
  | BasketballEditableRelatedEventType
  | 'basketball.steal_turnover'

export interface BasketballRelatedEventEditDraft {
  eventId: string
  sourceFingerprint: string
  eventType: BasketballEditableRelatedEventType
  period: { id: string; order: number }
  teamSide: BasketballTeamSide
  actor: BasketballCaptureActorSelection
  reboundKind: 'offensive' | 'defensive'
  turnoverKind: 'player' | 'team'
  relatedEventId: string | null
}

export interface BasketballHistoricalRelatedEventDraft {
  eventId: string
  pairedEventId: string
  captureCommandId: string
  sourceFingerprint: string
  eventType: BasketballHistoricalRelatedEventType
  period: { id: string; order: number }
  elapsedMs: number | null
  teamSide: BasketballTeamSide
  actor: BasketballCaptureActorSelection
  reboundKind: 'offensive' | 'defensive'
  turnoverKind: 'player' | 'team'
  relatedEventId: string | null
  pairedTurnoverActor: BasketballCaptureActorSelection
  pairedTurnoverKind: 'player' | 'team'
}

export interface BasketballRelationshipTargetOption {
  eventId: string | null
  label: string
}

export interface BasketballRelatedEventEditorDerivation<TDraft extends
  BasketballRelatedEventEditDraft | BasketballHistoricalRelatedEventDraft> {
  draft: TDraft
  actorOptions: BasketballShotActorOption[]
  targetOptions: BasketballRelationshipTargetOption[]
}

export interface BasketballRelatedEventPreview<TDraft> {
  draft: TDraft
  streamFingerprint: string
  occurredAt: string
  recorderUserId: string | null
  consequenceLines: string[]
  affectedEventIds: string[]
  appendedEventIds: string[]
  requiresConfirmation: true
}

export type BasketballRelatedEventEditPreview =
  BasketballRelatedEventPreview<BasketballRelatedEventEditDraft>
export type BasketballHistoricalRelatedEventPreview =
  BasketballRelatedEventPreview<BasketballHistoricalRelatedEventDraft>

export type BasketballRelatedEventCommandResult =
  | { ok: true; state: GameState; highlightEventId: string }
  | {
      ok: false
      state: GameState
      code: BasketballCommandErrorCode
      message: string
    }

type EditableEvent =
  | BasketballAssistEvent
  | BasketballReboundEvent
  | BasketballStealEvent
  | BasketballBlockEvent
  | BasketballTurnoverEvent

interface PreparedState {
  state: GameState
  active: BasketballMatchEvent[]
  deleted: BasketballMatchEvent[]
}

interface EditPlan {
  mutations: GameEventMutation[]
  consequenceLines: string[]
}

interface HistoricalPlan {
  appendedEvents: BasketballMatchEvent[]
  mutations: GameEventMutation[]
  consequenceLines: string[]
}

export function isBasketballEditableRelatedEvent(
  event: BasketballMatchEvent
): event is EditableEvent {
  return event.eventType === 'basketball.assist' ||
    event.eventType === 'basketball.rebound' ||
    event.eventType === 'basketball.steal' ||
    event.eventType === 'basketball.block' ||
    event.eventType === 'basketball.turnover'
}

export function buildBasketballRelatedEventEditDraft(
  state: GameState,
  eventId: string
): BasketballCommandResult<BasketballRelatedEventEditDraft> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const event = prepared.value.active.find(candidate =>
    candidate.id === eventId && isBasketballEditableRelatedEvent(candidate)
  ) as EditableEvent | undefined
  if (!event) return commandFailure('command_failed', 'This active Basketball event is unavailable for editing.')
  const actor = actorToSelection(event.actors[0])
  const incomingSteal = event.eventType === 'basketball.turnover'
    ? prepared.value.active.find(candidate =>
        candidate.eventType === 'basketball.steal' && candidate.payload.relatedEventId === event.id
      )
    : null
  return {
    ok: true,
    value: {
      eventId: event.id,
      sourceFingerprint: eventStreamFingerprint(prepared.value.state),
      eventType: event.eventType,
      period: event.period,
      teamSide: event.teamSide,
      actor,
      reboundKind: event.eventType === 'basketball.rebound' ? event.payload.kind : 'offensive',
      turnoverKind: event.eventType === 'basketball.turnover' ? event.payload.kind : 'player',
      relatedEventId: event.eventType === 'basketball.turnover'
        ? incomingSteal?.id ?? null
        : event.payload.relatedEventId,
    },
  }
}

export function buildBasketballHistoricalRelatedEventDraft(
  state: GameState,
  eventType: BasketballHistoricalRelatedEventType = 'basketball.assist'
): BasketballCommandResult<BasketballHistoricalRelatedEventDraft> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  if (prepared.value.state.sportGameState?.sportId !== 'basketball') {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const projection = prepared.value.state.sportGameState.projection
  const period = projection.periods.find(candidate => candidate.id === projection.currentPeriodId) ??
    projection.periods.find(candidate => projection.startedPeriodIds.includes(candidate.id))
  if (!period) return commandFailure('invalid_period', 'Start a Basketball period before adding an event.')
  const time = defaultBasketballHistoricalTime(prepared.value.state, period)
  if (!time.ok) return commandFailure('invalid_timestamp', time.message)
  const actor = basketballRelatedEventActorOptions(
    prepared.value.state,
    'tracked',
    eventType,
    'player'
  )[0]?.selection
  if (!actor) return commandFailure('invalid_actor', 'Add a tracked Basketball participant before adding an event.')
  const pairedActor = basketballRelatedEventActorOptions(
    prepared.value.state,
    'opponent',
    'basketball.turnover',
    'player'
  )[0]?.selection ?? { kind: 'unknown', label: 'Unknown player' }
  return {
    ok: true,
    value: {
      eventId: createBasketballUuid(),
      pairedEventId: createBasketballUuid(),
      captureCommandId: createBasketballCaptureCommandId(),
      sourceFingerprint: eventStreamFingerprint(prepared.value.state),
      eventType,
      period: { id: period.id, order: period.order },
      elapsedMs: time.elapsedMs,
      teamSide: 'tracked',
      actor,
      reboundKind: 'offensive',
      turnoverKind: 'player',
      relatedEventId: null,
      pairedTurnoverActor: pairedActor,
      pairedTurnoverKind: 'player',
    },
  }
}

export function basketballRelatedEventActorOptions(
  state: GameState,
  side: BasketballTeamSide,
  eventType: BasketballHistoricalRelatedEventType,
  turnoverKind: 'player' | 'team',
  current?: BasketballCaptureActorSelection
): BasketballShotActorOption[] {
  const options = basketballShotActorOptions(state, side).filter(option => {
    if (eventType !== 'basketball.turnover') return true
    return turnoverKind === 'team'
      ? option.selection.kind === 'team'
      : option.selection.kind !== 'team'
  })
  if (eventType === 'basketball.turnover' && turnoverKind === 'team') return options
  const unknown = current?.kind === 'unknown'
    ? current
    : { kind: 'unknown' as const, label: 'Unknown player' }
  const key = basketballShotActorSelectionKey(unknown, side)
  return options.some(option => option.key === key)
    ? options
    : [...options, { key, label: `${unknown.label} (unknown)`, teamSide: side, selection: unknown }]
}

export function basketballRelatedEventTargetOptions(
  state: GameState,
  draft: BasketballRelatedEventEditDraft | BasketballHistoricalRelatedEventDraft
): BasketballRelationshipTargetOption[] {
  const prepared = prepareState(state)
  if (!prepared.ok) return [{ eventId: null, label: 'Standalone' }]
  return targetOptionsFromPrepared(prepared.value, draft)
}

export function deriveBasketballRelatedEventEditor<TDraft extends
  BasketballRelatedEventEditDraft | BasketballHistoricalRelatedEventDraft>(
  state: GameState,
  draft: TDraft
): BasketballRelatedEventEditorDerivation<TDraft> {
  const prepared = prepareState(state)
  const preparedState = prepared.ok ? prepared.value.state : state
  const targetOptions = prepared.ok
    ? targetOptionsFromPrepared(prepared.value, draft)
    : [{ eventId: null, label: 'Standalone' }]
  const reconciledDraft = targetOptions.some(option => option.eventId === draft.relatedEventId)
    ? draft
    : { ...draft, relatedEventId: null }
  return {
    draft: reconciledDraft,
    actorOptions: basketballRelatedEventActorOptions(
      preparedState,
      reconciledDraft.teamSide,
      reconciledDraft.eventType,
      reconciledDraft.turnoverKind,
      reconciledDraft.actor
    ),
    targetOptions,
  }
}

export function reconcileBasketballRelatedEventDraft<TDraft extends
  BasketballRelatedEventEditDraft | BasketballHistoricalRelatedEventDraft>(
  state: GameState,
  draft: TDraft
): TDraft {
  const options = basketballRelatedEventTargetOptions(state, draft)
  return options.some(option => option.eventId === draft.relatedEventId)
    ? draft
    : { ...draft, relatedEventId: null }
}

export function previewBasketballRelatedEventEdit(
  state: GameState,
  draft: BasketballRelatedEventEditDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballRelatedEventEditPreview> {
  const occurredAt = validTimestamp(now)
  if (!occurredAt) return commandFailure('invalid_timestamp', 'Basketball correction timestamp is invalid.')
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const fingerprint = eventStreamFingerprint(prepared.value.state)
  if (fingerprint !== draft.sourceFingerprint) {
    return commandFailure('command_failed', 'The Timeline changed. Reopen the event editor before saving.')
  }
  const plan = buildEditPlan(prepared.value, draft)
  if (!plan.ok) return plan
  if (plan.value.mutations.length === 0) {
    return commandFailure('command_failed', 'Change at least one event field before saving.')
  }
  const baseline = clearQuickUndoReceipt(prepared.value.state)
  const result = applyGameEventAppendsAndMutations(
    baseline,
    [],
    plan.value.mutations,
    occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return commandFailure('command_failed', result.ok
      ? 'The event edit did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return commandFailure('command_failed', `This edit would create an invalid relationship: ${warning}`)
  return {
    ok: true,
    value: {
      draft,
      streamFingerprint: fingerprint,
      occurredAt,
      recorderUserId,
      consequenceLines: plan.value.consequenceLines,
      affectedEventIds: plan.value.mutations.map(mutation => mutation.eventId),
      appendedEventIds: [],
      requiresConfirmation: true,
    },
  }
}

export function applyBasketballRelatedEventEdit(
  state: GameState,
  preview: BasketballRelatedEventEditPreview
): BasketballRelatedEventCommandResult {
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the event edit again before saving.')
  }
  const prepared = prepareState(state)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const plan = buildEditPlan(prepared.value, preview.draft)
  if (!plan.ok) return failure(state, plan.code, plan.message)
  if (!sameStringSet(plan.value.mutations.map(mutation => mutation.eventId), preview.affectedEventIds)) {
    return failure(state, 'command_failed', 'The event edit consequences changed. Review them again before saving.')
  }
  const baseline = clearQuickUndoReceipt(prepared.value.state)
  const result = applyGameEventAppendsAndMutations(
    baseline,
    [],
    plan.value.mutations,
    preview.occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(state, 'command_failed', result.ok
      ? 'The event edit did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return failure(state, 'command_failed', `This edit would create an invalid relationship: ${warning}`)
  return { ok: true, state: reconcileBasketballPlayerRows(result.state), highlightEventId: preview.draft.eventId }
}

export function previewBasketballHistoricalRelatedEvent(
  state: GameState,
  draft: BasketballHistoricalRelatedEventDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballHistoricalRelatedEventPreview> {
  const occurredAt = validTimestamp(now)
  if (!occurredAt) return commandFailure('invalid_timestamp', 'Basketball event timestamp is invalid.')
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const fingerprint = eventStreamFingerprint(prepared.value.state)
  if (fingerprint !== draft.sourceFingerprint) {
    return commandFailure('command_failed', 'The Timeline changed. Reopen Add Event before saving.')
  }
  const plan = buildHistoricalPlan(prepared.value, draft, recorderUserId, occurredAt)
  if (!plan.ok) return plan
  const baseline = clearQuickUndoReceipt(prepared.value.state)
  const result = applyGameEventAppendsAndMutations(
    baseline,
    plan.value.appendedEvents,
    plan.value.mutations,
    occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return commandFailure('command_failed', result.ok
      ? 'The historical event did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return commandFailure('command_failed', `This event would create an invalid relationship: ${warning}`)
  return {
    ok: true,
    value: {
      draft,
      streamFingerprint: fingerprint,
      occurredAt,
      recorderUserId,
      consequenceLines: plan.value.consequenceLines,
      affectedEventIds: plan.value.mutations.map(mutation => mutation.eventId),
      appendedEventIds: plan.value.appendedEvents.map(event => event.id),
      requiresConfirmation: true,
    },
  }
}

export function applyBasketballHistoricalRelatedEvent(
  state: GameState,
  preview: BasketballHistoricalRelatedEventPreview
): BasketballRelatedEventCommandResult {
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review Add Event again before saving.')
  }
  const prepared = prepareState(state)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const plan = buildHistoricalPlan(prepared.value, preview.draft, preview.recorderUserId, preview.occurredAt)
  if (!plan.ok) return failure(state, plan.code, plan.message)
  if (
    !sameStringSet(plan.value.mutations.map(mutation => mutation.eventId), preview.affectedEventIds) ||
    !sameStringSet(plan.value.appendedEvents.map(event => event.id), preview.appendedEventIds)
  ) {
    return failure(state, 'command_failed', 'The Add Event consequences changed. Review them again before saving.')
  }
  const baseline = clearQuickUndoReceipt(prepared.value.state)
  const result = applyGameEventAppendsAndMutations(
    baseline,
    plan.value.appendedEvents,
    plan.value.mutations,
    preview.occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(state, 'command_failed', result.ok
      ? 'The historical event did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return failure(state, 'command_failed', `This event would create an invalid relationship: ${warning}`)
  return { ok: true, state: reconcileBasketballPlayerRows(result.state), highlightEventId: preview.draft.eventId }
}

function buildEditPlan(
  prepared: PreparedState,
  draft: BasketballRelatedEventEditDraft
): BasketballCommandResult<EditPlan> {
  const event = prepared.active.find(candidate => candidate.id === draft.eventId && isBasketballEditableRelatedEvent(candidate))
  if (!event || event.eventType !== draft.eventType) {
    return commandFailure('command_failed', 'This Basketball event changed or is unavailable.')
  }
  const role = actorRole(draft.eventType)
  const actor = basketballActorForSelection(prepared.state, role, draft.teamSide, draft.actor, { allowUnavailable: true })
  if (!actor.ok) return actor
  const actorKindError = validateActorKind(draft.eventType, draft.turnoverKind, actor.value)
  if (actorKindError) return commandFailure('invalid_actor', actorKindError)
  const targetOptions = targetOptionsFromPrepared(prepared, draft)
  const requestedTarget = targetOptions.find(option => option.eventId === draft.relatedEventId)
  const originalTarget = event.eventType === 'basketball.turnover'
    ? prepared.active.find(candidate => candidate.eventType === 'basketball.steal' && candidate.payload.relatedEventId === event.id)?.id ?? null
    : event.payload.relatedEventId
  const relatedEventId = requestedTarget ? draft.relatedEventId : originalTarget === draft.relatedEventId ? null : undefined
  if (relatedEventId === undefined) {
    return commandFailure('command_failed', 'The selected relationship is not compatible with this event.')
  }
  const payload = event.eventType === 'basketball.turnover'
    ? { ...event.payload, kind: draft.turnoverKind }
    : event.eventType === 'basketball.rebound'
      ? { ...event.payload, kind: draft.reboundKind, relatedEventId }
      : { ...event.payload, relatedEventId }
  const mutations: GameEventMutation[] = []
  const changes = { teamSide: draft.teamSide, actors: [actor.value], payload }
  if (!sameJson({ teamSide: event.teamSide, actors: event.actors, payload: event.payload }, changes)) {
    mutations.push({ type: 'update', eventId: event.id, changes })
  }
  const notes = [`Update ${eventLabel(event.eventType)} attribution and relationship.`]
  if (event.eventType === 'basketball.turnover') {
    const activeIncoming = prepared.active.filter((candidate): candidate is BasketballStealEvent =>
      candidate.eventType === 'basketball.steal' && candidate.payload.relatedEventId === event.id
    )
    for (const steal of activeIncoming) {
      if (steal.id === relatedEventId) continue
      mutations.push({
        type: 'update',
        eventId: steal.id,
        changes: { payload: { ...steal.payload, relatedEventId: null, captureCommandId: null } },
      })
      notes.push(`${actorLabel(steal.actors[0])}'s steal remains as a standalone stat.`)
    }
    if (relatedEventId) {
      const selected = prepared.active.find(candidate => candidate.id === relatedEventId && candidate.eventType === 'basketball.steal') as BasketballStealEvent | undefined
      if (selected && selected.payload.relatedEventId === null) {
        mutations.push({
          type: 'update',
          eventId: selected.id,
          changes: {
            payload: {
              ...selected.payload,
              relatedEventId: event.id,
              captureCommandId: event.payload.captureCommandId,
            },
          },
        })
      }
    }
  }
  return { ok: true, value: { mutations, consequenceLines: [...new Set(notes)] } }
}

function buildHistoricalPlan(
  prepared: PreparedState,
  draft: BasketballHistoricalRelatedEventDraft,
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<HistoricalPlan> {
  if (prepared.state.sportGameState?.sportId !== 'basketball' || !prepared.state.eventStream) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const projection = prepared.state.sportGameState.projection
  const period = projection.periods.find(candidate => candidate.id === draft.period.id)
  if (!period || period.order !== draft.period.order || !projection.startedPeriodIds.includes(period.id)) {
    return commandFailure('invalid_period', 'Select a Basketball period that has already started.')
  }
  const time = validateBasketballHistoricalTime(prepared.state, draft.period, draft.elapsedMs)
  if (!time.ok) return commandFailure('invalid_timestamp', time.message)
  let nextSequence = nextBasketballEventSequence(prepared.state.eventStream.events, recorderUserId)
  const appendedEvents: BasketballMatchEvent[] = []
  const mutations: GameEventMutation[] = []
  if (draft.eventType === 'basketball.steal_turnover') {
    const stealer = basketballActorForSelection(prepared.state, 'stealer', draft.teamSide, draft.actor, { allowUnavailable: true })
    if (!stealer.ok) return stealer
    const turnoverSide = oppositeSide(draft.teamSide)
    const turnoverActor = basketballActorForSelection(
      prepared.state,
      'committed_by',
      turnoverSide,
      draft.pairedTurnoverActor,
      { allowUnavailable: true }
    )
    if (!turnoverActor.ok) return turnoverActor
    const kindError = validateActorKind('basketball.turnover', draft.pairedTurnoverKind, turnoverActor.value)
    if (kindError) return commandFailure('invalid_actor', kindError)
    appendedEvents.push(createBasketballStatEvent({
      id: draft.pairedEventId,
      eventType: 'basketball.turnover',
      payload: {
        kind: draft.pairedTurnoverKind,
        captureCommandId: draft.captureCommandId,
        recordedLater: true,
      },
      recorderUserId,
      sequence: nextSequence++,
      period: draft.period,
      elapsedMs: time.elapsedMs,
      occurredAt,
      teamSide: turnoverSide,
      actors: [turnoverActor.value],
    }))
    appendedEvents.push(createBasketballStatEvent({
      id: draft.eventId,
      eventType: 'basketball.steal',
      payload: {
        relatedEventId: draft.pairedEventId,
        captureCommandId: draft.captureCommandId,
        recordedLater: true,
      },
      recorderUserId,
      sequence: nextSequence++,
      period: draft.period,
      elapsedMs: time.elapsedMs,
      occurredAt,
      teamSide: draft.teamSide,
      actors: [stealer.value],
    }))
    return {
      ok: true,
      value: {
        appendedEvents,
        mutations,
        consequenceLines: [`Add a linked Steal + Turnover to ${period.label}.`],
      },
    }
  }
  const actor = basketballActorForSelection(
    prepared.state,
    actorRole(draft.eventType),
    draft.teamSide,
    draft.actor,
    { allowUnavailable: true }
  )
  if (!actor.ok) return actor
  const kindError = validateActorKind(draft.eventType, draft.turnoverKind, actor.value)
  if (kindError) return commandFailure('invalid_actor', kindError)
  const targetOptions = targetOptionsFromPrepared(prepared, draft)
  if (!targetOptions.some(option => option.eventId === draft.relatedEventId)) {
    return commandFailure('command_failed', 'The selected relationship is not compatible with this event.')
  }
  const common = {
    id: draft.eventId,
    recorderUserId,
    sequence: nextSequence,
    period: draft.period,
    elapsedMs: time.elapsedMs,
    occurredAt,
    teamSide: draft.teamSide,
    actors: [actor.value],
  }
  if (draft.eventType === 'basketball.turnover') {
    appendedEvents.push(createBasketballStatEvent({
      ...common,
      eventType: 'basketball.turnover',
      payload: { kind: draft.turnoverKind, captureCommandId: null, recordedLater: true },
    }))
  } else if (draft.eventType === 'basketball.rebound') {
    appendedEvents.push(createBasketballStatEvent({
      ...common,
      eventType: 'basketball.rebound',
      payload: {
        kind: draft.reboundKind,
        relatedEventId: draft.relatedEventId,
        captureCommandId: null,
        recordedLater: true,
      },
    }))
  } else {
    appendedEvents.push(createBasketballStatEvent({
      ...common,
      eventType: draft.eventType,
      payload: {
        relatedEventId: draft.relatedEventId,
        captureCommandId: null,
        recordedLater: true,
      },
    }))
  }
  return {
    ok: true,
    value: {
      appendedEvents,
      mutations,
      consequenceLines: [`Add ${eventLabel(draft.eventType)} to ${period.label}.`],
    },
  }
}

function targetOptionsFromPrepared(
  prepared: PreparedState,
  draft: BasketballRelatedEventEditDraft | BasketballHistoricalRelatedEventDraft
): BasketballRelationshipTargetOption[] {
  const standalone = [{ eventId: null, label: 'Standalone' }]
  if (draft.eventType === 'basketball.steal_turnover') return standalone
  const existingEvent = prepared.active.find(event => event.id === draft.eventId)
  const currentTargetId = existingEvent?.eventType === 'basketball.turnover'
    ? prepared.active.find(candidate =>
        candidate.eventType === 'basketball.steal' && candidate.payload.relatedEventId === existingEvent.id
      )?.id ?? null
    : existingEvent && isBasketballEditableRelatedEvent(existingEvent)
      ? existingEvent.payload.relatedEventId
      : null
  const capturedBeforeDraft = (event: BasketballMatchEvent) =>
    !existingEvent || compareGameEventCaptureOrder(event, existingEvent) < 0
  const inDraftPeriod = (event: BasketballMatchEvent) =>
    event.period.id === draft.period.id && event.period.order === draft.period.order
  const isCurrentTarget = (event: BasketballMatchEvent) => event.id === currentTargetId
  const targetLabel = buildTargetLabeler(prepared)
  const actor = basketballActorForSelection(
    prepared.state,
    actorRole(draft.eventType),
    draft.teamSide,
    draft.actor,
    { allowUnavailable: true }
  )
  if (!actor.ok) return standalone
  if (draft.eventType === 'basketball.turnover') {
    const existingTurnover = prepared.active.find((event): event is BasketballTurnoverEvent =>
      event.id === draft.eventId && event.eventType === 'basketball.turnover'
    )
    if (!existingTurnover) return standalone
    return [
      ...standalone,
      ...prepared.active
        .filter((event): event is BasketballStealEvent => event.eventType === 'basketball.steal')
        .filter(event =>
          event.teamSide !== draft.teamSide &&
          (inDraftPeriod(event) || isCurrentTarget(event)) &&
          compareGameEventCaptureOrder(event, existingTurnover) > 0 &&
          (event.payload.relatedEventId === null || event.payload.relatedEventId === draft.eventId)
        )
        .map(event => ({ eventId: event.id, label: targetLabel(event) })),
    ]
  }
  const shots = prepared.active.filter((event): event is BasketballShotEvent => event.eventType === 'basketball.shot')
  if (draft.eventType === 'basketball.steal') {
    return [
      ...standalone,
      ...prepared.active
        .filter((event): event is BasketballTurnoverEvent => event.eventType === 'basketball.turnover')
        .filter(event =>
          event.teamSide !== draft.teamSide &&
          (inDraftPeriod(event) || isCurrentTarget(event)) &&
          capturedBeforeDraft(event) &&
          !prepared.active.some(candidate =>
            candidate.id !== draft.eventId &&
            candidate.eventType === 'basketball.steal' &&
            candidate.payload.relatedEventId === event.id
          )
        )
        .map(event => ({ eventId: event.id, label: targetLabel(event) })),
    ]
  }
  return [
    ...standalone,
    ...shots.filter(shot =>
      (inDraftPeriod(shot) || isCurrentTarget(shot)) &&
      capturedBeforeDraft(shot) &&
      relationshipCompatible(draft, actor.value, shot) &&
      !prepared.active.some(candidate =>
        candidate.id !== draft.eventId &&
        candidate.eventType === draft.eventType &&
        'relatedEventId' in candidate.payload &&
        candidate.payload.relatedEventId === shot.id
      )
    )
      .map(shot => ({ eventId: shot.id, label: targetLabel(shot) })),
  ]
}

function buildTargetLabeler(prepared: PreparedState) {
  const periodLabels = new Map(prepared.state.sportGameState?.sportId === 'basketball'
    ? prepared.state.sportGameState.projection.periods.map(period => [period.id, period.label])
    : [])
  const ordinals = new Map<string, number>()
  const counts = new Map<string, number>()
  for (const event of [...prepared.active].sort(compareGameEventCaptureOrder)) {
    const key = event.eventType === 'basketball.shot'
      ? `${event.eventType}:${event.payload.attempt}`
      : event.eventType
    const ordinal = (counts.get(key) ?? 0) + 1
    counts.set(key, ordinal)
    ordinals.set(event.id, ordinal)
  }
  return (event: BasketballShotEvent | BasketballStealEvent | BasketballTurnoverEvent): string => {
    const periodLabel = periodLabels.get(event.period.id) ?? event.period.id
    const ordinal = ordinals.get(event.id) ?? 0
    const familyLabel = event.eventType === 'basketball.shot'
      ? `${event.payload.attempt === 'field_goal' ? 'Field goal' : 'Free throw'} #${ordinal}: ${event.payload.made ? 'Made' : 'Missed'} ${event.payload.value}PT`
      : event.eventType === 'basketball.steal'
        ? `Steal #${ordinal}`
        : `Turnover #${ordinal}`
    return `${periodLabel} - ${familyLabel}: ${actorLabel(event.actors[0])}`
  }
}

function relationshipCompatible(
  draft: BasketballRelatedEventEditDraft | BasketballHistoricalRelatedEventDraft,
  actor: GameEventActor,
  shot: BasketballShotEvent
): boolean {
  if (draft.eventType === 'basketball.assist') {
    return shot.payload.attempt === 'field_goal' && shot.payload.made &&
      shot.teamSide === draft.teamSide && !sameActor(actor, shot.actors[0])
  }
  if (draft.eventType === 'basketball.rebound') {
    const expectedShotSide = draft.reboundKind === 'offensive' ? draft.teamSide : oppositeSide(draft.teamSide)
    return !shot.payload.made && shot.teamSide === expectedShotSide
  }
  if (draft.eventType === 'basketball.block') {
    return shot.payload.attempt === 'field_goal' && !shot.payload.made && shot.teamSide !== draft.teamSide
  }
  return false
}

function prepareState(state: GameState): BasketballCommandResult<PreparedState> {
  if (
    state.sport?.id !== 'basketball' ||
    state.gameDataAuthority !== 'sport_events' ||
    state.sportGameState?.sportId !== 'basketball' ||
    !state.eventStream
  ) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  if (isFinalBasketballCloudGame(state)) {
    return commandFailure('cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete || rebuilt.state.sportGameState?.sportId !== 'basketball' || !rebuilt.state.eventStream) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before editing events.')
  }
  const projection = rebuilt.state.sportGameState.projection
  if (!isBasketballTimelineCorrectionProjection(projection)) {
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

function actorRole(eventType: BasketballHistoricalRelatedEventType): string {
  if (eventType === 'basketball.assist') return 'assister'
  if (eventType === 'basketball.rebound') return 'rebounder'
  if (eventType === 'basketball.steal' || eventType === 'basketball.steal_turnover') return 'stealer'
  if (eventType === 'basketball.block') return 'blocker'
  return 'committed_by'
}

function validateActorKind(
  eventType: BasketballEditableRelatedEventType,
  turnoverKind: 'player' | 'team',
  actor: GameEventActor
): string | null {
  if (eventType !== 'basketball.turnover') return null
  if (turnoverKind === 'team' && actor.kind !== 'team') return 'A team turnover requires a team actor.'
  if (turnoverKind === 'player' && actor.kind !== 'player' && actor.kind !== 'unknown') {
    return 'A player turnover requires a player or unknown actor.'
  }
  return null
}

function actorToSelection(actor: GameEventActor): BasketballCaptureActorSelection {
  if (actor.participantId) return { kind: 'participant', participantId: actor.participantId }
  if (actor.kind === 'team') return { kind: 'team' }
  return { kind: 'unknown', label: actor.label || 'Unknown participant' }
}

function actorLabel(actor: GameEventActor | undefined): string {
  return actor?.label?.trim() || (actor?.kind === 'team' ? 'Team' : 'Unknown participant')
}

function eventLabel(eventType: BasketballHistoricalRelatedEventType): string {
  if (eventType === 'basketball.assist') return 'an assist'
  if (eventType === 'basketball.rebound') return 'a rebound'
  if (eventType === 'basketball.steal') return 'a steal'
  if (eventType === 'basketball.block') return 'a block'
  if (eventType === 'basketball.turnover') return 'a turnover'
  return 'a Steal + Turnover capture'
}

function sameActor(left: GameEventActor | undefined, right: GameEventActor | undefined): boolean {
  if (!left || !right) return false
  if (left.participantId || right.participantId) {
    return Boolean(left.participantId && left.participantId === right.participantId)
  }
  return left.kind === right.kind && left.label === right.label
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
  return (state.eventStream?.events ?? []).map(raw => {
    if (!isGameEventEnvelope(raw)) return JSON.stringify(raw)
    return `${raw.id}:${raw.revision}:${raw.updatedAt}:${raw.deletedAt ?? ''}`
  }).join('|')
}

function validTimestamp(value: string): string | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
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
): BasketballRelatedEventCommandResult {
  return { ok: false, state, code, message }
}

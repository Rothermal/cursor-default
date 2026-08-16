import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventAppendsAndMutations } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor, GameEventMutation } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import {
  basketballActorForSelection,
  nextBasketballEventSequence,
  type BasketballCaptureActorSelection,
  type BasketballCommandErrorCode,
  type BasketballCommandResult,
} from './commands'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import { createBasketballUuid } from './id'
import { basketballRecoverableScoreAdjustmentId } from './scoreAdjustmentRecovery'
import { basketballShotActorOptions, type BasketballShotActorOption } from './shotEditCommands'
import { createBasketballStatEvent } from './statEvents'
import type {
  BasketballMatchEvent,
  BasketballMinutesAdjustmentPayload,
  BasketballMinutesAdjustmentEvent,
  BasketballScoreAdjustmentEvent,
  BasketballScoreAdjustmentPayload,
  BasketballTeamSide,
} from './types'

export type BasketballEditableValueEventType =
  | 'basketball.score_adjustment'
  | 'basketball.minutes_adjustment'

export interface BasketballValueEventDraft {
  eventId: string
  sourceFingerprint: string
  eventType: BasketballEditableValueEventType
  period: { id: string; order: number }
  teamSide: BasketballTeamSide
  actor: BasketballCaptureActorSelection
  delta: number
  reason: BasketballScoreAdjustmentPayload['reason']
  note: string
}

export interface BasketballValueEventPreview {
  draft: BasketballValueEventDraft
  mode: 'edit' | 'add'
  streamFingerprint: string
  occurredAt: string
  recorderUserId: string | null
  consequenceLines: string[]
  affectedEventIds: string[]
  appendedEventIds: string[]
  requiresConfirmation: true
}

export type BasketballValueEventCommandResult =
  | { ok: true; state: GameState; highlightEventId: string }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string }

type EditableValueEvent = BasketballScoreAdjustmentEvent | BasketballMinutesAdjustmentEvent

interface PreparedState {
  state: GameState
  active: BasketballMatchEvent[]
  recoveryEventId: string | null
}

interface ValuePlan {
  appendedEvents: BasketballMatchEvent[]
  mutations: GameEventMutation[]
  consequenceLines: string[]
}

export function isBasketballEditableValueEvent(
  event: BasketballMatchEvent
): event is EditableValueEvent {
  return event.eventType === 'basketball.score_adjustment' ||
    event.eventType === 'basketball.minutes_adjustment'
}

export function basketballMinutesActorOptions(
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

export function basketballManualMinutesAvailable(state: GameState): boolean {
  return state.sportGameState?.sportId === 'basketball' &&
    state.sportGameState.setup.rulesSnapshot.clockModel === 'none'
}

export function buildBasketballValueEventEditDraft(
  state: GameState,
  eventId: string
): BasketballCommandResult<BasketballValueEventDraft> {
  const prepared = prepareState(state, eventId)
  if (!prepared.ok) return prepared
  const event = prepared.value.active.find(candidate =>
    candidate.id === eventId && isBasketballEditableValueEvent(candidate)
  ) as EditableValueEvent | undefined
  if (!event) return commandFailure('command_failed', 'This active Basketball event is unavailable for editing.')
  if (event.eventType === 'basketball.minutes_adjustment' && !basketballManualMinutesAvailable(prepared.value.state)) {
    return commandFailure('command_failed', 'Manual Basketball minutes are unavailable when the game clock is authoritative.')
  }
  return {
    ok: true,
    value: {
      eventId: event.id,
      sourceFingerprint: eventStreamFingerprint(prepared.value.state),
      eventType: event.eventType,
      period: event.period,
      teamSide: event.teamSide,
      actor: event.eventType === 'basketball.minutes_adjustment'
        ? actorToSelection(event.actors[0])
        : { kind: 'team' },
      delta: event.eventType === 'basketball.score_adjustment'
        ? event.payload.delta
        : event.payload.deltaMinutes,
      reason: event.eventType === 'basketball.score_adjustment'
        ? event.payload.reason
        : 'scoreboard_control',
      note: event.eventType === 'basketball.score_adjustment'
        ? event.payload.note ?? ''
        : '',
    },
  }
}

export function buildBasketballHistoricalValueEventDraft(
  state: GameState,
  eventType: BasketballEditableValueEventType
): BasketballCommandResult<BasketballValueEventDraft> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  if (eventType === 'basketball.minutes_adjustment' && !basketballManualMinutesAvailable(prepared.value.state)) {
    return commandFailure('command_failed', 'Manual Basketball minutes are unavailable when the game clock is authoritative.')
  }
  const projection = prepared.value.state.sportGameState?.sportId === 'basketball'
    ? prepared.value.state.sportGameState.projection
    : null
  const period = projection?.periods.find(candidate => candidate.id === projection.currentPeriodId) ??
    projection?.periods.find(candidate => projection.startedPeriodIds.includes(candidate.id))
  if (!period) return commandFailure('invalid_period', 'Start a Basketball period before adding an event.')
  const trackedActor = basketballMinutesActorOptions(prepared.value.state, 'tracked')[0]
  const opponentActor = basketballMinutesActorOptions(prepared.value.state, 'opponent')[0]
  const defaultMinutesActor = trackedActor ?? opponentActor
  const actor = eventType === 'basketball.minutes_adjustment'
    ? defaultMinutesActor?.selection
    : { kind: 'team' as const }
  if (!actor) return commandFailure('invalid_actor', 'Add a resolved Basketball participant before adding minutes.')
  return {
    ok: true,
    value: {
      eventId: createBasketballUuid(),
      sourceFingerprint: eventStreamFingerprint(prepared.value.state),
      eventType,
      period: { id: period.id, order: period.order },
      teamSide: eventType === 'basketball.minutes_adjustment'
        ? defaultMinutesActor?.teamSide ?? 'tracked'
        : 'tracked',
      actor,
      delta: 1,
      reason: 'scoreboard_control',
      note: '',
    },
  }
}

export function previewBasketballValueEventEdit(
  state: GameState,
  draft: BasketballValueEventDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballValueEventPreview> {
  return previewValueEvent(state, draft, 'edit', recorderUserId, now)
}

export function previewBasketballHistoricalValueEvent(
  state: GameState,
  draft: BasketballValueEventDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballValueEventPreview> {
  return previewValueEvent(state, draft, 'add', recorderUserId, now)
}

export function applyBasketballValueEvent(
  state: GameState,
  preview: BasketballValueEventPreview
): BasketballValueEventCommandResult {
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the event again before saving.')
  }
  const prepared = prepareState(state, preview.mode === 'edit' ? preview.draft.eventId : undefined)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const plan = buildPlan(prepared.value, preview.draft, preview.mode, preview.recorderUserId, preview.occurredAt)
  if (!plan.ok) return failure(state, plan.code, plan.message)
  if (
    !sameStringSet(plan.value.mutations.map(mutation => mutation.eventId), preview.affectedEventIds) ||
    !sameStringSet(plan.value.appendedEvents.map(event => event.id), preview.appendedEventIds)
  ) {
    return failure(state, 'command_failed', 'The event consequences changed. Review them again before saving.')
  }
  const result = applyPlan(prepared.value.state, plan.value, preview.occurredAt)
  if (!result.ok) return failure(state, result.code, result.message)
  return {
    ok: true,
    state: reconcileBasketballPlayerRows(result.value),
    highlightEventId: preview.draft.eventId,
  }
}

function previewValueEvent(
  state: GameState,
  draft: BasketballValueEventDraft,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  now: string
): BasketballCommandResult<BasketballValueEventPreview> {
  const occurredAt = validTimestamp(now)
  if (!occurredAt) return commandFailure('invalid_timestamp', 'Basketball event timestamp is invalid.')
  const prepared = prepareState(state, mode === 'edit' ? draft.eventId : undefined)
  if (!prepared.ok) return prepared
  const fingerprint = eventStreamFingerprint(prepared.value.state)
  if (fingerprint !== draft.sourceFingerprint) {
    return commandFailure('command_failed', 'The Timeline changed. Reopen the event editor before saving.')
  }
  const plan = buildPlan(prepared.value, draft, mode, recorderUserId, occurredAt)
  if (!plan.ok) return plan
  if (mode === 'edit' && plan.value.mutations.length === 0) {
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
      affectedEventIds: plan.value.mutations.map(mutation => mutation.eventId),
      appendedEventIds: plan.value.appendedEvents.map(event => event.id),
      requiresConfirmation: true,
    },
  }
}

function buildPlan(
  prepared: PreparedState,
  draft: BasketballValueEventDraft,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<ValuePlan> {
  const validation = validateDraft(prepared.state, draft)
  if (!validation.ok) return validation
  const existing = mode === 'edit'
    ? prepared.active.find(candidate => candidate.id === draft.eventId && isBasketballEditableValueEvent(candidate))
    : null
  if (mode === 'edit' && (!existing || existing.eventType !== draft.eventType)) {
    return commandFailure('command_failed', 'This Basketball event changed or is unavailable.')
  }
  if (mode === 'add' && prepared.active.some(candidate => candidate.id === draft.eventId)) {
    return commandFailure('command_failed', 'This Basketball event id is already in use.')
  }
  const actor = draft.eventType === 'basketball.score_adjustment'
    ? basketballActorForSelection(prepared.state, 'team', draft.teamSide, { kind: 'team' })
    : basketballActorForSelection(prepared.state, 'player', draft.teamSide, draft.actor, { allowUnavailable: true })
  if (!actor.ok) return actor
  if (draft.eventType === 'basketball.minutes_adjustment' && actor.value.kind !== 'player') {
    return commandFailure('invalid_actor', 'Minutes require a resolved Basketball player.')
  }
  const totalError = prepared.recoveryEventId === draft.eventId
    ? null
    : validateProjectedTotals(
        prepared.state,
        existing && isBasketballEditableValueEvent(existing) ? existing : null,
        draft,
        actor.value
      )
  if (totalError) return commandFailure('command_failed', totalError)
  const payload: BasketballScoreAdjustmentPayload | BasketballMinutesAdjustmentPayload =
    draft.eventType === 'basketball.score_adjustment'
    ? {
        delta: draft.delta,
        reason: draft.reason,
        note: draft.note.trim() || null,
        captureCommandId: existing?.payload.captureCommandId ?? null,
      }
    : {
        deltaMinutes: draft.delta,
        captureCommandId: existing?.payload.captureCommandId ?? null,
      }
  if (existing) {
    const changes = { period: draft.period, teamSide: draft.teamSide, actors: [actor.value], payload }
    const original = {
      period: existing.period,
      teamSide: existing.teamSide,
      actors: existing.actors,
      payload: existing.payload,
    }
    return {
      ok: true,
      value: {
        appendedEvents: [],
        mutations: sameJson(original, changes)
          ? []
          : [{ type: 'update', eventId: existing.id, changes }],
        consequenceLines: [draft.eventType === 'basketball.score_adjustment'
          ? `Update the ${sideLabel(draft.teamSide)} score by ${signed(draft.delta)}.`
          : `Update ${actor.value.label ?? 'the selected player'} minutes by ${signed(draft.delta)}.`],
      },
    }
  }
  const common = {
    id: draft.eventId,
    recorderUserId,
    sequence: nextBasketballEventSequence(prepared.state.eventStream?.events ?? [], recorderUserId),
    period: draft.period,
    occurredAt,
    teamSide: draft.teamSide,
    actors: [actor.value],
  }
  const event = draft.eventType === 'basketball.score_adjustment'
    ? createBasketballStatEvent({
        ...common,
        eventType: draft.eventType,
        payload: payload as BasketballScoreAdjustmentPayload,
      })
    : createBasketballAdministrativeEvent({
        ...common,
        eventType: draft.eventType,
        payload: payload as BasketballMinutesAdjustmentPayload,
      })
  return {
    ok: true,
    value: {
      appendedEvents: [event],
      mutations: [],
      consequenceLines: [draft.eventType === 'basketball.score_adjustment'
        ? `Add a ${sideLabel(draft.teamSide)} score adjustment of ${signed(draft.delta)} to the selected period.`
        : `Add ${signed(draft.delta)} minute${Math.abs(draft.delta) === 1 ? '' : 's'} for ${actor.value.label ?? 'the selected player'} to the selected period.`],
    },
  }
}

function validateDraft(
  state: GameState,
  draft: BasketballValueEventDraft
): BasketballCommandResult<true> {
  if (!Number.isInteger(draft.delta) || draft.delta === 0) {
    return commandFailure('command_failed', 'Basketball adjustments must be non-zero whole numbers.')
  }
  if (draft.eventType === 'basketball.score_adjustment') {
    if (!['scoreboard_control', 'unattributed_score', 'official_correction'].includes(draft.reason)) {
      return commandFailure('command_failed', 'Select a valid Basketball score-adjustment reason.')
    }
    if (draft.reason === 'official_correction' && !draft.note.trim()) {
      return commandFailure('command_failed', 'Official Basketball score corrections require a note.')
    }
  } else {
    if (!basketballManualMinutesAvailable(state)) {
      return commandFailure('command_failed', 'Manual Basketball minutes are unavailable when the game clock is authoritative.')
    }
    if (draft.actor.kind !== 'participant') {
      return commandFailure('invalid_actor', 'Minutes require an individual Basketball participant.')
    }
  }
  const projection = state.sportGameState?.sportId === 'basketball' ? state.sportGameState.projection : null
  const period = projection?.periods.find(candidate => candidate.id === draft.period.id)
  if (!period || period.order !== draft.period.order || !projection?.startedPeriodIds.includes(period.id)) {
    return commandFailure('invalid_period', 'Select a Basketball period that has started.')
  }
  return { ok: true, value: true }
}

function validateProjectedTotals(
  state: GameState,
  existing: EditableValueEvent | null,
  draft: BasketballValueEventDraft,
  actor: GameEventActor
): string | null {
  if (state.sportGameState?.sportId !== 'basketball') return 'Basketball projection is unavailable.'
  const projection = state.sportGameState.projection
  if (draft.eventType === 'basketball.score_adjustment') {
    const totals = { ...projection.score }
    if (existing?.eventType === 'basketball.score_adjustment') {
      totals[existing.teamSide] -= existing.payload.delta
    }
    totals[draft.teamSide] += draft.delta
    return totals.tracked < 0 || totals.opponent < 0
      ? 'Basketball score cannot be adjusted below zero.'
      : null
  }

  const totals = Object.fromEntries(Object.values(projection.participants).map(participant => [
    participant.participantId,
    participant.stats.min,
  ])) as Record<string, number>
  if (existing?.eventType === 'basketball.minutes_adjustment') {
    const oldParticipantId = existing.actors[0]?.participantId
    if (oldParticipantId) totals[oldParticipantId] = (totals[oldParticipantId] ?? 0) - existing.payload.deltaMinutes
  }
  if (!actor.participantId) return 'Minutes require an individual Basketball participant.'
  totals[actor.participantId] = (totals[actor.participantId] ?? 0) + draft.delta
  return Object.values(totals).some(total => total < 0)
    ? 'Basketball minutes cannot be adjusted below zero.'
    : null
}

function applyPlan(
  state: GameState,
  plan: ValuePlan,
  occurredAt: string
): BasketballCommandResult<GameState> {
  const result = applyGameEventAppendsAndMutations(
    clearQuickUndoReceipt(state),
    plan.appendedEvents,
    plan.mutations,
    occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return commandFailure('command_failed', result.ok
      ? 'The event change did not produce a complete Basketball projection.'
      : result.error.message)
  }
  return { ok: true, value: result.state }
}

function prepareState(
  state: GameState,
  requestedRecoveryEventId?: string
): BasketballCommandResult<PreparedState> {
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
  const recoveryEventId = basketballRecoverableScoreAdjustmentId(
    state,
    rebuilt.inspection.diagnostics
  )
  const recovering = Boolean(
    requestedRecoveryEventId && recoveryEventId === requestedRecoveryEventId
  )
  if (
    (!rebuilt.inspection.complete && !recovering) ||
    rebuilt.state.sportGameState?.sportId !== 'basketball' ||
    !rebuilt.state.eventStream
  ) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before editing events.')
  }
  const status = rebuilt.state.sportGameState.projection.status
  if (!recovering && status !== 'in_progress' && status !== 'period_break') {
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
      recoveryEventId: recovering ? recoveryEventId : null,
    },
  }
}

function actorToSelection(actor: GameEventActor): BasketballCaptureActorSelection {
  if (actor.participantId) return { kind: 'participant', participantId: actor.participantId }
  return { kind: 'unknown', label: actor.label || 'Unknown participant' }
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

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function sideLabel(side: BasketballTeamSide): string {
  return side === 'tracked' ? 'tracked-team' : 'opponent'
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
): BasketballValueEventCommandResult {
  return { ok: false, state, code, message }
}

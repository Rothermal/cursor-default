import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventAppendsAndMutations } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor, GameEventMutation } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import { normalizeBasketballActorLabel, sameBasketballActorIdentity } from './actorIdentity'
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
import { defaultBasketballHistoricalTime, validateBasketballHistoricalTime } from './historicalTime'
import {
  basketballTimeoutKindLimit,
  basketballTimeoutUsageByPool,
  resolveBasketballTimeoutPool,
  resolveBasketballTimeoutPoolWithCarryover,
} from './rules'
import { basketballShotActorOptions, type BasketballShotActorOption } from './shotEditCommands'
import type {
  BasketballEjectionEvent,
  BasketballEjectionSource,
  BasketballFoulEvent,
  BasketballMatchEvent,
  BasketballTeamSide,
  BasketballTimeoutEvent,
  BasketballTimeoutKind,
} from './types'

export type BasketballEditableAdministrationEventType =
  | 'basketball.ejection'
  | 'basketball.timeout'

export type BasketballAdministrationSubjectDraft =
  | { kind: 'participant'; participantId: string }
  | { kind: 'staff'; label: string }

export interface BasketballAdministrationDraft {
  eventId: string
  sourceFingerprint: string
  eventType: BasketballEditableAdministrationEventType
  period: { id: string; order: number }
  elapsedMs: number | null
  teamSide: BasketballTeamSide | 'neutral'
  subject: BasketballAdministrationSubjectDraft
  reason: string
  ejectionSource: BasketballEjectionSource
  relatedFoulEventId: string | null
  timeoutKind: BasketballTimeoutKind
  timeoutLabel: string
}

export interface BasketballAdministrationPreview {
  draft: BasketballAdministrationDraft
  mode: 'edit' | 'add'
  streamFingerprint: string
  occurredAt: string
  recorderUserId: string | null
  consequenceLines: string[]
  affectedEventIds: string[]
  appendedEventIds: string[]
  requiresConfirmation: true
}

export interface BasketballAdministrationRelationshipOption {
  eventId: string | null
  label: string
}

export interface BasketballEjectionFoulOptionContext {
  eventId: string
  periodId: string
  teamSide: BasketballTeamSide | 'neutral'
  subject: BasketballAdministrationSubjectDraft
}

export type BasketballAdministrationCommandResult =
  | { ok: true; state: GameState; highlightEventId: string }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string }

interface PreparedState {
  state: GameState
  active: BasketballMatchEvent[]
}

interface AdministrationPlan {
  appendedEvents: BasketballMatchEvent[]
  mutations: GameEventMutation[]
  consequenceLines: string[]
}

type AdministrationEventFields =
  | {
      eventType: 'basketball.ejection'
      teamSide: BasketballTeamSide
      actors: GameEventActor[]
      payload: BasketballEjectionEvent['payload']
    }
  | {
      eventType: 'basketball.timeout'
      teamSide: BasketballTeamSide | 'neutral'
      actors: GameEventActor[]
      payload: BasketballTimeoutEvent['payload']
    }

const TIMEOUT_LABELS: Record<BasketballTimeoutKind, string> = {
  full: 'Full timeout',
  thirty_second: '30-second timeout',
  media: 'Media timeout',
  official: 'Official timeout',
}

export function isBasketballEditableAdministrationEvent(
  event: BasketballMatchEvent
): event is BasketballEjectionEvent | BasketballTimeoutEvent {
  return event.eventType === 'basketball.ejection' || event.eventType === 'basketball.timeout'
}

export function basketballEjectionParticipantOptions(
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

export function basketballEjectionFoulOptions(
  state: GameState,
  context: BasketballEjectionFoulOptionContext | null
): BasketballAdministrationRelationshipOption[] {
  const none = [{ eventId: null, label: 'No source foul' }]
  if (!context || context.teamSide === 'neutral') return none
  const prepared = prepareState(state)
  if (!prepared.ok) return none
  const original = prepared.value.active.find(event => event.id === context.eventId)
  return [
    ...none,
    ...prepared.value.active
      .filter((event): event is BasketballFoulEvent => event.eventType === 'basketball.foul')
      .filter(event =>
        event.period.id === context.periodId &&
        event.teamSide === context.teamSide &&
        (!original || compareGameEventCaptureOrder(event, original) < 0) &&
        sameSubjectDraft(event.actors.find(actor => actor.role === 'committed_by'), context.subject)
      )
      .map(event => ({
        eventId: event.id,
        label: `${periodLabel(prepared.value.state, event.period.id)}: ${event.actors[0]?.label || 'Team'} - ${event.payload.class.replace(/_/g, ' ')}`,
      })),
  ]
}

export function buildBasketballAdministrationEditDraft(
  state: GameState,
  eventId: string
): BasketballCommandResult<BasketballAdministrationDraft> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const event = prepared.value.active.find(candidate =>
    candidate.id === eventId && isBasketballEditableAdministrationEvent(candidate)
  ) as BasketballEjectionEvent | BasketballTimeoutEvent | undefined
  if (!event) return commandFailure('command_failed', 'This active Basketball administration event is unavailable for editing.')
  const base = { ...defaultDraft(prepared.value.state, event.period, event.id), elapsedMs: event.elapsedMs }
  if (event.eventType === 'basketball.ejection') {
    const subject = event.actors.find(actor => actor.role === 'subject')
    if (!subject) return commandFailure('invalid_actor', 'The ejection subject is unavailable.')
    return {
      ok: true,
      value: {
        ...base,
        eventType: event.eventType,
        teamSide: event.teamSide,
        subject: actorToSubjectDraft(subject),
        reason: event.payload.reason,
        ejectionSource: event.payload.source,
        relatedFoulEventId: event.payload.relatedFoulEventId,
      },
    }
  }
  return {
    ok: true,
    value: {
      ...base,
      eventType: event.eventType,
      teamSide: event.teamSide,
      timeoutKind: event.payload.kind,
      timeoutLabel: event.payload.label ?? TIMEOUT_LABELS[event.payload.kind],
    },
  }
}

export function buildBasketballHistoricalAdministrationDraft(
  state: GameState,
  eventType: BasketballEditableAdministrationEventType
): BasketballCommandResult<BasketballAdministrationDraft> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const projection = prepared.value.state.sportGameState?.sportId === 'basketball'
    ? prepared.value.state.sportGameState.projection
    : null
  const period = projection?.periods.find(candidate => candidate.id === projection.currentPeriodId) ??
    projection?.periods.find(candidate => projection.startedPeriodIds.includes(candidate.id))
  if (!period) return commandFailure('invalid_period', 'Start a Basketball period before adding an event.')
  const time = defaultBasketballHistoricalTime(prepared.value.state, period)
  if (!time.ok) return commandFailure('invalid_timestamp', time.message)
  const draft = {
    ...defaultDraft(prepared.value.state, period, createBasketballUuid()),
    elapsedMs: time.elapsedMs,
  }
  return { ok: true, value: { ...draft, eventType } }
}

export function previewBasketballAdministrationEdit(
  state: GameState,
  draft: BasketballAdministrationDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballAdministrationPreview> {
  return previewAdministration(state, draft, 'edit', recorderUserId, now)
}

export function previewBasketballHistoricalAdministration(
  state: GameState,
  draft: BasketballAdministrationDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballAdministrationPreview> {
  return previewAdministration(state, draft, 'add', recorderUserId, now)
}

export function applyBasketballAdministrationChange(
  state: GameState,
  preview: BasketballAdministrationPreview
): BasketballAdministrationCommandResult {
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the event again before saving.')
  }
  const prepared = prepareState(state)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const plan = buildPlan(prepared.value, preview.draft, preview.mode, preview.recorderUserId, preview.occurredAt)
  if (!plan.ok) return failure(state, plan.code, plan.message)
  if (
    !sameStringSet(plan.value.mutations.map(mutation => mutation.eventId), preview.affectedEventIds) ||
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

function previewAdministration(
  state: GameState,
  draft: BasketballAdministrationDraft,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  now: string
): BasketballCommandResult<BasketballAdministrationPreview> {
  const occurredAt = validTimestamp(now)
  if (!occurredAt) return commandFailure('invalid_timestamp', 'Basketball event timestamp is invalid.')
  const prepared = prepareState(state)
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
  draft: BasketballAdministrationDraft,
  mode: 'edit' | 'add',
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<AdministrationPlan> {
  const period = startedPeriod(prepared.state, draft.period)
  if (!period.ok) return period
  const existing = mode === 'edit'
    ? prepared.active.find(event => event.id === draft.eventId && isBasketballEditableAdministrationEvent(event))
    : null
  if (mode === 'edit' && (!existing || existing.eventType !== draft.eventType)) {
    return commandFailure('command_failed', 'This Basketball administration event changed or is unavailable.')
  }
  if (mode === 'add' && prepared.active.some(event => event.id === draft.eventId)) {
    return commandFailure('command_failed', 'This Basketball event id is already in use.')
  }
  return draft.eventType === 'basketball.ejection'
    ? buildEjectionPlan(prepared, draft, existing as BasketballEjectionEvent | null, recorderUserId, occurredAt)
    : buildTimeoutPlan(prepared, draft, existing as BasketballTimeoutEvent | null, recorderUserId, occurredAt)
}

function buildEjectionPlan(
  prepared: PreparedState,
  draft: BasketballAdministrationDraft,
  existing: BasketballEjectionEvent | null,
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<AdministrationPlan> {
  if (draft.teamSide === 'neutral') return commandFailure('command_failed', 'Ejections require a Basketball team side.')
  const reason = draft.reason.trim()
  if (!reason) return commandFailure('command_failed', 'Basketball ejections require a reason.')
  const subject = subjectActor(prepared.state, draft.teamSide, draft.subject)
  if (!subject.ok) return subject
  if (draft.ejectionSource === 'automatic_threshold' && subject.value.kind !== 'player') {
    return commandFailure('invalid_actor', 'Automatic Basketball ejections require a resolved player.')
  }
  if (
    prepared.active.some(event =>
      event.id !== draft.eventId &&
      event.eventType === 'basketball.ejection' &&
      event.teamSide === draft.teamSide &&
      sameBasketballActorIdentity(event.actors.find(actor => actor.role === 'subject'), subject.value)
    )
  ) {
    return commandFailure('invalid_actor', 'That Basketball player or staff member is already ejected.')
  }
  if (draft.relatedFoulEventId) {
    const foul = prepared.active.find((event): event is BasketballFoulEvent =>
      event.id === draft.relatedFoulEventId && event.eventType === 'basketball.foul'
    )
    if (
      !foul ||
      foul.period.id !== draft.period.id ||
      foul.teamSide !== draft.teamSide ||
      !sameBasketballActorIdentity(foul.actors.find(actor => actor.role === 'committed_by'), subject.value) ||
      (existing && compareGameEventCaptureOrder(foul, existing) >= 0)
    ) {
      return commandFailure('command_failed', 'The linked foul must be an earlier same-period foul for the ejected subject.')
    }
  }
  const payload: BasketballEjectionEvent['payload'] = {
    reason,
    source: draft.ejectionSource,
    relatedFoulEventId: draft.relatedFoulEventId,
    captureCommandId: existing?.payload.captureCommandId ?? null,
    ...(!existing || existing.payload.recordedLater === true
      ? { recordedLater: true as const }
      : {}),
  }
  return eventPlan(prepared, draft, existing, recorderUserId, occurredAt, {
    eventType: 'basketball.ejection',
    teamSide: draft.teamSide,
    actors: [subject.value],
    payload,
  }, `${existing ? 'Update' : 'Add'} the ${draft.ejectionSource === 'official_ruling' ? 'official' : 'automatic'} ejection for ${subject.value.label || 'the selected player'} in ${periodLabel(prepared.state, draft.period.id)}.`)
}

function buildTimeoutPlan(
  prepared: PreparedState,
  draft: BasketballAdministrationDraft,
  existing: BasketballTimeoutEvent | null,
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<AdministrationPlan> {
  const neutral = draft.teamSide === 'neutral'
  const chargedSide = neutral ? null : draft.teamSide as BasketballTeamSide
  const kindValid = neutral
    ? draft.timeoutKind === 'media' || draft.timeoutKind === 'official'
    : draft.timeoutKind === 'full' || draft.timeoutKind === 'thirty_second'
  if (!kindValid) return commandFailure('command_failed', 'Select a timeout kind compatible with its owner.')
  let actors: GameEventActor[] = []
  if (chargedSide) {
    const team = basketballActorForSelection(prepared.state, 'team', chargedSide, { kind: 'team' })
    if (!team.ok) return team
    actors = [team.value]
    const rules = prepared.state.sportGameState?.sportId === 'basketball'
      ? prepared.state.sportGameState.setup.rulesSnapshot
      : null
    if (!rules) return commandFailure('invalid_period', 'Basketball timeout inventory is unavailable.')
    const activeWithoutEdited = prepared.active.filter(event => event.id !== draft.eventId)
    const pool = resolveBasketballTimeoutPoolWithCarryover(
      rules,
      draft.period.id,
      basketballTimeoutUsageByPool(activeWithoutEdited, rules, chargedSide)
    )
    if (!pool) return commandFailure('invalid_period', 'Basketball timeout inventory is unavailable.')
    const charged = prepared.active.filter(event =>
      event.id !== draft.eventId &&
      event.eventType === 'basketball.timeout' &&
      event.teamSide === chargedSide &&
      (event.payload.kind === 'full' || event.payload.kind === 'thirty_second') &&
      resolveBasketballTimeoutPool(rules, event.period.id)?.id === pool.id
    )
    if (pool.totalLimit !== null && charged.length >= pool.totalLimit) {
      return commandFailure('command_failed', `The ${periodLabel(prepared.state, draft.period.id)} charged-timeout inventory is exhausted for that team.`)
    }
    if (draft.timeoutKind === 'full' || draft.timeoutKind === 'thirty_second') {
      const kindLimit = basketballTimeoutKindLimit(pool, draft.timeoutKind)
      const kindUsed = charged.filter(event => event.payload.kind === draft.timeoutKind).length
      if (kindLimit !== null && kindUsed >= kindLimit) {
        return commandFailure('command_failed', `The ${periodLabel(prepared.state, draft.period.id)} ${TIMEOUT_LABELS[draft.timeoutKind].toLowerCase()} inventory is exhausted for that team.`)
      }
    }
  }
  const label = neutral
    ? draft.timeoutLabel.trim() || TIMEOUT_LABELS[draft.timeoutKind]
    : TIMEOUT_LABELS[draft.timeoutKind]
  const payload: BasketballTimeoutEvent['payload'] = {
    kind: draft.timeoutKind,
    chargedSide,
    label,
    captureCommandId: existing?.payload.captureCommandId ?? null,
    ...(!existing || existing.payload.recordedLater === true
      ? { recordedLater: true as const }
      : {}),
  }
  const owner = neutral ? 'game administration' : sideLabel(chargedSide!)
  return eventPlan(prepared, draft, existing, recorderUserId, occurredAt, {
    eventType: 'basketball.timeout',
    teamSide: draft.teamSide,
    actors,
    payload,
  }, `${existing ? 'Update' : 'Add'} the ${label} for ${owner} in ${periodLabel(prepared.state, draft.period.id)}.`)
}

function eventPlan(
  prepared: PreparedState,
  draft: BasketballAdministrationDraft,
  existing: BasketballEjectionEvent | BasketballTimeoutEvent | null,
  recorderUserId: string | null,
  occurredAt: string,
  fields: AdministrationEventFields,
  consequence: string
): BasketballCommandResult<AdministrationPlan> {
  if (existing) {
    const changes = {
      period: draft.period,
      teamSide: fields.teamSide,
      actors: fields.actors,
      payload: fields.payload,
    }
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
        consequenceLines: [consequence],
      },
    }
  }
  const time = validateBasketballHistoricalTime(prepared.state, draft.period, draft.elapsedMs)
  if (!time.ok) return commandFailure('invalid_timestamp', time.message)
  const common = {
    id: draft.eventId,
    recorderUserId,
    sequence: nextBasketballEventSequence(prepared.state.eventStream!.events, recorderUserId),
    period: draft.period,
    elapsedMs: time.elapsedMs,
    occurredAt,
    teamSide: fields.teamSide,
    actors: fields.actors,
  }
  const event: BasketballMatchEvent = fields.eventType === 'basketball.ejection'
    ? createBasketballAdministrativeEvent({
        ...common,
        eventType: fields.eventType,
        teamSide: fields.teamSide,
        payload: fields.payload,
      })
    : createBasketballAdministrativeEvent({
        ...common,
        eventType: fields.eventType,
        payload: fields.payload,
      })
  return {
    ok: true,
    value: { appendedEvents: [event], mutations: [], consequenceLines: [consequence] },
  }
}

function applyPlan(
  state: GameState,
  plan: AdministrationPlan,
  occurredAt: string
): BasketballCommandResult<GameState> {
  const baseline = clearQuickUndoReceipt(state)
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
      ? 'The administration change did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return commandFailure('command_failed', `This change would create an invalid relationship: ${warning}`)
  return { ok: true, value: result.state }
}

function defaultDraft(
  state: GameState,
  period: { id: string; order: number },
  eventId: string
): BasketballAdministrationDraft {
  const tracked = basketballEjectionParticipantOptions(state, 'tracked')[0]
  const opponent = basketballEjectionParticipantOptions(state, 'opponent')[0]
  const participant = tracked ?? opponent
  return {
    eventId,
    sourceFingerprint: eventStreamFingerprint(state),
    eventType: 'basketball.ejection',
    period: { id: period.id, order: period.order },
    elapsedMs: null,
    teamSide: participant?.teamSide ?? 'tracked',
    subject: participant?.selection.kind === 'participant'
      ? participant.selection
      : { kind: 'staff', label: '' },
    reason: '',
    ejectionSource: 'official_ruling',
    relatedFoulEventId: null,
    timeoutKind: 'full',
    timeoutLabel: TIMEOUT_LABELS.full,
  }
}

function subjectActor(
  state: GameState,
  side: BasketballTeamSide,
  subject: BasketballAdministrationSubjectDraft
): BasketballCommandResult<GameEventActor> {
  if (subject.kind === 'staff') {
    const label = subject.label.trim()
    return label
      ? { ok: true, value: { role: 'subject', kind: 'staff', label } }
      : commandFailure('invalid_actor', 'Enter a coach or staff label for the ejection.')
  }
  const selection: BasketballCaptureActorSelection = {
    kind: 'participant',
    participantId: subject.participantId,
  }
  const actor = basketballActorForSelection(state, 'subject', side, selection, { allowUnavailable: true })
  if (!actor.ok || actor.value.kind !== 'player') {
    return commandFailure('invalid_actor', 'The ejected player must be a resolved participant on the selected side.')
  }
  return actor
}

function startedPeriod(
  state: GameState,
  draftPeriod: { id: string; order: number }
): BasketballCommandResult<true> {
  const projection = state.sportGameState?.sportId === 'basketball' ? state.sportGameState.projection : null
  const period = projection?.periods.find(candidate => candidate.id === draftPeriod.id)
  return period && period.order === draftPeriod.order && projection?.startedPeriodIds.includes(period.id)
    ? { ok: true, value: true }
    : commandFailure('invalid_period', 'Select a Basketball period that has started.')
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
  if (!inspection.complete) return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before editing events.')
  return {
    ok: true,
    value: {
      state: rebuilt.state,
      active: inspection.activeEvents.filter(isBasketballMatchEvent),
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

function actorToSubjectDraft(actor: GameEventActor): BasketballAdministrationSubjectDraft {
  return actor.kind === 'player' && actor.participantId
    ? { kind: 'participant', participantId: actor.participantId }
    : { kind: 'staff', label: actor.label ?? '' }
}

function sameSubjectDraft(actor: GameEventActor | undefined, subject: BasketballAdministrationSubjectDraft): boolean {
  if (!actor) return false
  return subject.kind === 'participant'
    ? actor.participantId === subject.participantId
    : actor.kind === 'staff' &&
      normalizeBasketballActorLabel(actor.label) === normalizeBasketballActorLabel(subject.label)
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

function periodLabel(state: GameState, periodId: string): string {
  return state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.periods.find(period => period.id === periodId)?.label ?? periodId
    : periodId
}

function sideLabel(side: BasketballTeamSide): string {
  return side === 'tracked' ? 'tracked team' : 'opponent'
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
): BasketballAdministrationCommandResult {
  return { ok: false, state, code, message }
}

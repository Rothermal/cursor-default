import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventAppendsAndMutations } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor, GameEventMutation } from '../gameEvents/types'
import {
  basketballActorForSelection,
  createBasketballCaptureCommandId,
  nextBasketballEventSequence,
  normalizeBasketballCourtLocation,
  type BasketballCaptureActorSelection,
  type BasketballCommandErrorCode,
  type BasketballCommandResult,
} from './commands'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import { isBasketballTimelineCorrectionProjection } from './correctionAvailability'
import {
  isThreePointer,
  normalizedCourtLocationToFeet,
  type BasketballCourtPoint,
} from './courtGeometry'
import { createBasketballUuid } from './id'
import { defaultBasketballHistoricalTime, validateBasketballHistoricalTime } from './historicalTime'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import { createBasketballStatEvent } from './statEvents'
import type {
  BasketballAssistEvent,
  BasketballBlockEvent,
  BasketballMatchEvent,
  BasketballReboundEvent,
  BasketballShotEvent,
  BasketballShotValueSource,
  BasketballTeamSide,
} from './types'

export type BasketballShotRelationshipKind = 'assist' | 'rebound' | 'block'

export type BasketballShotRelationshipSelection =
  | { mode: 'none' }
  | { mode: 'event'; eventId: string }
  | {
      mode: 'new'
      teamSide: BasketballTeamSide
      actor: BasketballCaptureActorSelection
    }

export interface BasketballShotEditDraft {
  eventId: string
  sourceFingerprint: string
  attempt: BasketballShotEvent['payload']['attempt']
  teamSide: BasketballTeamSide
  shooter: BasketballCaptureActorSelection
  made: boolean
  value: 1 | 2 | 3
  location: BasketballCourtPoint | null
  relationships: Record<BasketballShotRelationshipKind, BasketballShotRelationshipSelection>
  newRelationshipEventIds: Record<BasketballShotRelationshipKind, string>
  correctionCaptureCommandId: string
}

export interface BasketballShotActorOption {
  key: string
  label: string
  teamSide: BasketballTeamSide
  selection: BasketballCaptureActorSelection
}

export interface BasketballShotRelationshipOption {
  key: string
  label: string
  selection: BasketballShotRelationshipSelection
  removed: boolean
}

export interface BasketballShotEditPreview {
  draft: BasketballShotEditDraft
  streamFingerprint: string
  occurredAt: string
  recorderUserId: string | null
  consequenceLines: string[]
  affectedEventIds: string[]
  appendedEventIds: string[]
  requiresConfirmation: true
}

export interface BasketballHistoricalShotDraft {
  eventId: string
  sourceFingerprint: string
  period: { id: string; order: number }
  elapsedMs: number | null
  teamSide: BasketballTeamSide
  shooter: BasketballCaptureActorSelection
  made: boolean
  value: 2 | 3
  location: BasketballCourtPoint | null
  relationships: Record<BasketballShotRelationshipKind, BasketballShotRelationshipSelection>
  relationshipEventIds: Record<BasketballShotRelationshipKind, string>
  captureCommandId: string
}

export interface BasketballHistoricalShotPreview {
  draft: BasketballHistoricalShotDraft
  streamFingerprint: string
  occurredAt: string
  recorderUserId: string | null
  consequenceLines: string[]
  appendedEventIds: string[]
  requiresConfirmation: true
}

export type BasketballShotEditResult =
  | { ok: true; state: GameState; highlightEventId: string }
  | {
      ok: false
      state: GameState
      code: BasketballCommandErrorCode
      message: string
    }

interface PreparedShotEditState {
  state: GameState
  active: BasketballMatchEvent[]
  deleted: BasketballMatchEvent[]
  shot: BasketballShotEvent
}

interface ShotEditPlan {
  appendedEvents: BasketballMatchEvent[]
  mutations: GameEventMutation[]
  consequenceLines: string[]
}

type RelatedEvent = BasketballAssistEvent | BasketballReboundEvent | BasketballBlockEvent

export function buildBasketballShotEditDraft(
  state: GameState,
  eventId: string
): BasketballCommandResult<BasketballShotEditDraft> {
  const prepared = prepareShotEditState(state, eventId)
  if (!prepared.ok) return prepared
  const { shot, active } = prepared.value
  const shooter = actorToSelection(actorForRole(shot, 'shooter'))
  const relationships = Object.fromEntries(
    (['assist', 'rebound', 'block'] as const).map(kind => {
      const linked = active
        .filter(event => relationshipKindForEvent(event) === kind)
        .find(event => event.payload.relatedEventId === shot.id)
      return [kind, linked
        ? { mode: 'event' as const, eventId: linked.id }
        : { mode: 'none' as const }]
    })
  ) as BasketballShotEditDraft['relationships']
  return {
    ok: true,
    value: {
      eventId: shot.id,
      sourceFingerprint: eventStreamFingerprint(prepared.value.state),
      attempt: shot.payload.attempt,
      teamSide: shot.teamSide,
      shooter,
      made: shot.payload.made,
      value: shot.payload.value,
      location: shot.location ? normalizedCourtLocationToFeet(shot.location) : null,
      relationships,
      newRelationshipEventIds: {
        assist: createBasketballUuid(),
        rebound: createBasketballUuid(),
        block: createBasketballUuid(),
      },
      correctionCaptureCommandId: createBasketballCaptureCommandId(),
    },
  }
}

export function buildBasketballHistoricalShotDraft(
  state: GameState
): BasketballCommandResult<BasketballHistoricalShotDraft> {
  const prepared = prepareHistoricalShotState(state)
  if (!prepared.ok) return prepared
  const sportState = prepared.value.sportGameState
  if (sportState?.sportId !== 'basketball') {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const currentPeriod = sportState.projection.periods.find(period =>
    period.id === sportState.projection.currentPeriodId
  ) ?? sportState.projection.periods.find(period =>
    sportState.projection.startedPeriodIds.includes(period.id)
  )
  if (!currentPeriod) return commandFailure('invalid_period', 'Start a Basketball period before adding a shot.')
  const time = defaultBasketballHistoricalTime(prepared.value, currentPeriod)
  if (!time.ok) return commandFailure('invalid_timestamp', time.message)
  const shooter = basketballShotActorOptions(prepared.value, 'tracked')[0]
  if (!shooter) return commandFailure('invalid_actor', 'Add a tracked Basketball participant before adding a shot.')
  return {
    ok: true,
    value: {
      eventId: createBasketballUuid(),
      sourceFingerprint: eventStreamFingerprint(prepared.value),
      period: { id: currentPeriod.id, order: currentPeriod.order },
      elapsedMs: time.elapsedMs,
      teamSide: 'tracked',
      shooter: shooter.selection,
      made: true,
      value: 2,
      location: null,
      relationships: {
        assist: { mode: 'none' },
        rebound: { mode: 'none' },
        block: { mode: 'none' },
      },
      relationshipEventIds: {
        assist: createBasketballUuid(),
        rebound: createBasketballUuid(),
        block: createBasketballUuid(),
      },
      captureCommandId: createBasketballCaptureCommandId(),
    },
  }
}

export function previewBasketballHistoricalShot(
  state: GameState,
  draft: BasketballHistoricalShotDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballHistoricalShotPreview> {
  const occurredAt = validTimestamp(now)
  if (!occurredAt) return commandFailure('invalid_timestamp', 'Basketball shot timestamp is invalid.')
  const prepared = prepareHistoricalShotState(state)
  if (!prepared.ok) return prepared
  const fingerprint = eventStreamFingerprint(prepared.value)
  if (fingerprint !== draft.sourceFingerprint) {
    return commandFailure('command_failed', 'The Timeline changed. Reopen Add Shot before saving.')
  }
  const events = buildHistoricalShotEvents(prepared.value, draft, recorderUserId, occurredAt)
  if (!events.ok) return events
  const baseline = clearQuickUndoReceipt(prepared.value)
  const result = applyGameEventAppendsAndMutations(
    baseline,
    events.value,
    [],
    occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return commandFailure('command_failed', result.ok
      ? 'The historical shot did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return commandFailure('command_failed', `This shot would create an invalid relationship: ${warning}`)
  const periodLabel = prepared.value.sportGameState?.sportId === 'basketball'
    ? prepared.value.sportGameState.projection.periods.find(period => period.id === draft.period.id)?.label ?? draft.period.id
    : draft.period.id
  const relationCount = events.value.length - 1
  return {
    ok: true,
    value: {
      draft,
      streamFingerprint: fingerprint,
      occurredAt,
      recorderUserId,
      consequenceLines: [
        `Add a ${draft.made ? 'made' : 'missed'} ${draft.value}-point field goal to ${periodLabel}.`,
        draft.location
          ? `Court location: ${draft.location.x.toFixed(1)}, ${draft.location.y.toFixed(1)} ft.`
          : 'The field goal will remain unlocated.',
        ...(relationCount > 0
          ? [`Record ${relationCount} linked related ${relationCount === 1 ? 'stat' : 'stats'}.`]
          : []),
      ],
      appendedEventIds: events.value.map(event => event.id),
      requiresConfirmation: true,
    },
  }
}

export function applyBasketballHistoricalShot(
  state: GameState,
  preview: BasketballHistoricalShotPreview
): BasketballShotEditResult {
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review Add Shot again before saving.')
  }
  const prepared = prepareHistoricalShotState(state)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const events = buildHistoricalShotEvents(
    prepared.value,
    preview.draft,
    preview.recorderUserId,
    preview.occurredAt
  )
  if (!events.ok) return failure(state, events.code, events.message)
  if (!sameStringSet(events.value.map(event => event.id), preview.appendedEventIds)) {
    return failure(state, 'command_failed', 'The Add Shot consequences changed. Review them again before saving.')
  }
  const baseline = clearQuickUndoReceipt(prepared.value)
  const result = applyGameEventAppendsAndMutations(
    baseline,
    events.value,
    [],
    preview.occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(state, 'command_failed', result.ok
      ? 'The historical shot did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return failure(state, 'command_failed', `This shot would create an invalid relationship: ${warning}`)
  return {
    ok: true,
    state: reconcileBasketballPlayerRows(result.state),
    highlightEventId: preview.draft.eventId,
  }
}

export function basketballShotActorOptions(
  state: GameState,
  teamSide?: BasketballTeamSide
): BasketballShotActorOption[] {
  if (state.sportGameState?.sportId !== 'basketball') return []
  const participantOptions = Object.values(state.sportGameState.projection.participants)
    .filter(participant => !teamSide || participant.teamSide === teamSide)
    .sort((left, right) =>
      left.teamSide.localeCompare(right.teamSide) ||
      left.displayName.localeCompare(right.displayName) ||
      left.participantId.localeCompare(right.participantId)
    )
    .map(participant => ({
      key: `participant:${participant.participantId}`,
      label: participant.number?.trim()
        ? `#${participant.number.trim()} ${participant.displayName}`
        : participant.displayName,
      teamSide: participant.teamSide,
      selection: { kind: 'participant' as const, participantId: participant.participantId },
    }))
  const sides: BasketballTeamSide[] = teamSide ? [teamSide] : ['tracked', 'opponent']
  const teamOptions = sides.map(side => ({
    key: `team:${side}`,
    label: side === 'tracked'
      ? `${state.gameInfo?.teamName || 'Tracked team'} (team)`
      : `${state.gameInfo?.opponentName || 'Opponent'} (team)`,
    teamSide: side,
    selection: { kind: 'team' as const },
  }))
  return [...participantOptions, ...teamOptions]
}

export function basketballShotActorSelectionKey(
  selection: BasketballCaptureActorSelection,
  teamSide: BasketballTeamSide
): string {
  if (selection.kind === 'participant') return `participant:${selection.participantId}`
  if (selection.kind === 'team') return `team:${teamSide}`
  return `unknown:${teamSide}:${selection.label}`
}

export function basketballShotRelationshipSelectionKey(
  selection: BasketballShotRelationshipSelection
): string {
  if (selection.mode === 'none') return 'none'
  if (selection.mode === 'event') return `event:${selection.eventId}`
  return `new:${selection.teamSide}:${basketballShotActorSelectionKey(selection.actor, selection.teamSide)}`
}

export function reconcileBasketballShotEditDraftRelationships(
  state: GameState,
  draft: BasketballShotEditDraft
): BasketballShotEditDraft {
  const optionsByKind = basketballShotRelationshipOptionsByKind(state, draft)
  const relationships = { ...draft.relationships }
  for (const kind of ['assist', 'rebound', 'block'] as const) {
    const selectedKey = basketballShotRelationshipSelectionKey(relationships[kind])
    const remainsAvailable = optionsByKind[kind]
      .some(option => option.key === selectedKey)
    if (!remainsAvailable) relationships[kind] = { mode: 'none' }
  }
  return { ...draft, relationships }
}

export function reconcileBasketballHistoricalShotDraftRelationships(
  state: GameState,
  draft: BasketballHistoricalShotDraft
): BasketballHistoricalShotDraft {
  const shooter = basketballActorForSelection(
    state,
    'shooter',
    draft.teamSide,
    draft.shooter,
    { allowUnavailable: true }
  )
  const relationships = { ...draft.relationships }
  for (const kind of ['assist', 'rebound', 'block'] as const) {
    const selection = relationships[kind]
    if (selection.mode === 'none') continue
    if (
      selection.mode === 'event' ||
      !shooter.ok ||
      !newRelationshipSideAllowed(kind, selection.teamSide, draft)
    ) {
      relationships[kind] = { mode: 'none' }
      continue
    }
    const actor = basketballActorForSelection(
      state,
      relationshipRole(kind),
      selection.teamSide,
      selection.actor,
      { allowUnavailable: true }
    )
    if (!actor.ok || (kind === 'assist' && sameActor(actor.value, shooter.value))) {
      relationships[kind] = { mode: 'none' }
    }
  }
  return { ...draft, relationships }
}

export function basketballShotRelationshipOptionsByKind(
  state: GameState,
  draft: BasketballShotEditDraft
): Record<BasketballShotRelationshipKind, BasketballShotRelationshipOption[]> {
  const prepared = prepareShotEditState(state, draft.eventId)
  if (!prepared.ok) {
    return {
      assist: unavailableRelationshipOptions(),
      rebound: unavailableRelationshipOptions(),
      block: unavailableRelationshipOptions(),
    }
  }
  return {
    assist: basketballShotRelationshipOptionsFromPrepared(prepared.value, draft, 'assist'),
    rebound: basketballShotRelationshipOptionsFromPrepared(prepared.value, draft, 'rebound'),
    block: basketballShotRelationshipOptionsFromPrepared(prepared.value, draft, 'block'),
  }
}

function basketballShotRelationshipOptionsFromPrepared(
  prepared: PreparedShotEditState,
  draft: BasketballShotEditDraft,
  kind: BasketballShotRelationshipKind
): BasketballShotRelationshipOption[] {
  const shooterResult = basketballActorForSelection(
    prepared.state,
    'shooter',
    draft.teamSide,
    draft.shooter,
    { allowUnavailable: true }
  )
  if (!shooterResult.ok) return unavailableRelationshipOptions()
  const eventOptions = [...prepared.active, ...prepared.deleted]
    .filter((event): event is RelatedEvent => relationshipKindForEvent(event) === kind)
    .filter(event => event.payload.relatedEventId === null || event.payload.relatedEventId === draft.eventId)
    .filter(event => !event.deletedAt || event.payload.relatedEventId === draft.eventId)
    .filter(event => samePeriod(event, prepared.shot) || event.payload.relatedEventId === draft.eventId)
    .filter(event => relationshipCompatible(kind, event, draft, shooterResult.value))
    .sort(compareGameEventCaptureOrder)
    .map(event => ({
      key: `event:${event.id}`,
      label: `${event.deletedAt ? 'Restore' : event.payload.relatedEventId ? 'Keep' : 'Link'}: ${actorLabel(event.actors[0])}${samePeriod(event, prepared.shot) ? '' : ` (${periodLabel(prepared.state, event.period.id)}, existing cross-period link)`}`,
      selection: { mode: 'event' as const, eventId: event.id },
      removed: event.deletedAt !== null,
    }))

  const newActorOptions = basketballShotActorOptions(prepared.state)
    .filter(option => newRelationshipSideAllowed(kind, option.teamSide, draft))
    .filter(option => kind !== 'assist' || !selectionMatchesActor(option.selection, shooterResult.value))
    .map(option => ({
      key: `new:${option.teamSide}:${option.key}`,
      label: `New ${kind}: ${option.label}`,
      selection: {
        mode: 'new' as const,
        teamSide: option.teamSide,
        actor: option.selection,
      },
      removed: false,
    }))
  return [
    { key: 'none', label: 'None', selection: { mode: 'none' }, removed: false },
    ...eventOptions,
    ...newActorOptions,
  ]
}

function unavailableRelationshipOptions(): BasketballShotRelationshipOption[] {
  return [{ key: 'none', label: 'None', selection: { mode: 'none' }, removed: false }]
}

export function previewBasketballShotEdit(
  state: GameState,
  draft: BasketballShotEditDraft,
  recorderUserId: string | null,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballShotEditPreview> {
  const occurredAt = validTimestamp(now)
  if (!occurredAt) return commandFailure('invalid_timestamp', 'Basketball correction timestamp is invalid.')
  const prepared = prepareShotEditState(state, draft.eventId)
  if (!prepared.ok) return prepared
  const fingerprint = eventStreamFingerprint(prepared.value.state)
  if (fingerprint !== draft.sourceFingerprint) {
    return commandFailure('command_failed', 'The Timeline changed. Reopen the shot editor before saving.')
  }
  const plan = buildShotEditPlan(prepared.value, draft, recorderUserId, occurredAt)
  if (!plan.ok) return plan
  if (plan.value.appendedEvents.length === 0 && plan.value.mutations.length === 0) {
    return commandFailure('command_failed', 'Change at least one shot or relationship field before saving.')
  }
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
      ? 'The shot edit did not produce a complete Basketball projection.'
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
      consequenceLines: consequenceLines(
        prepared.value.state,
        result.state,
        prepared.value.shot,
        draft,
        plan.value.consequenceLines
      ),
      affectedEventIds: plan.value.mutations.map(mutation => mutation.eventId),
      appendedEventIds: plan.value.appendedEvents.map(event => event.id),
      requiresConfirmation: true,
    },
  }
}

export function applyBasketballShotEdit(
  state: GameState,
  preview: BasketballShotEditPreview
): BasketballShotEditResult {
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the shot edit again before saving.')
  }
  const prepared = prepareShotEditState(state, preview.draft.eventId)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const plan = buildShotEditPlan(
    prepared.value,
    preview.draft,
    preview.recorderUserId,
    preview.occurredAt
  )
  if (!plan.ok) return failure(state, plan.code, plan.message)
  if (
    !sameStringSet(plan.value.mutations.map(mutation => mutation.eventId), preview.affectedEventIds) ||
    !sameStringSet(plan.value.appendedEvents.map(event => event.id), preview.appendedEventIds)
  ) {
    return failure(state, 'command_failed', 'The shot edit consequences changed. Review them again before saving.')
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
      ? 'The shot edit did not produce a complete Basketball projection.'
      : result.error.message)
  }
  const warning = firstNewRelationshipWarning(baseline, result.state)
  if (warning) return failure(state, 'command_failed', `This edit would create an invalid relationship: ${warning}`)
  return {
    ok: true,
    state: reconcileBasketballPlayerRows(result.state),
    highlightEventId: preview.draft.eventId,
  }
}

function prepareHistoricalShotState(state: GameState): BasketballCommandResult<GameState> {
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
  if (
    !rebuilt.inspection.complete ||
    rebuilt.state.sportGameState?.sportId !== 'basketball' ||
    !rebuilt.state.eventStream
  ) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before adding shots.')
  }
  const projection = rebuilt.state.sportGameState.projection
  if (!isBasketballTimelineCorrectionProjection(projection)) {
    return commandFailure('invalid_period', 'Reopen the Basketball game before adding shots.')
  }
  return { ok: true, value: rebuilt.state }
}

function buildHistoricalShotEvents(
  state: GameState,
  draft: BasketballHistoricalShotDraft,
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<BasketballMatchEvent[]> {
  if (state.sportGameState?.sportId !== 'basketball' || !state.eventStream) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const period = state.sportGameState.projection.periods.find(candidate => candidate.id === draft.period.id)
  if (
    !period ||
    period.order !== draft.period.order ||
    !state.sportGameState.projection.startedPeriodIds.includes(period.id)
  ) {
    return commandFailure('invalid_period', 'Select a Basketball period that has already started.')
  }
  const time = validateBasketballHistoricalTime(state, draft.period, draft.elapsedMs)
  if (!time.ok) return commandFailure('invalid_timestamp', time.message)
  const shooter = basketballActorForSelection(
    state,
    'shooter',
    draft.teamSide,
    draft.shooter,
    { allowUnavailable: true }
  )
  if (!shooter.ok) return shooter
  const location = draft.location === null
    ? { ok: true as const, value: null }
    : normalizeBasketballCourtLocation(draft.location)
  if (!location.ok) return location
  const storedPoint = location.value ? normalizedCourtLocationToFeet(location.value) : null
  const detectedValue = storedPoint && isThreePointer(storedPoint.x, storedPoint.y) ? 3 : 2
  const hasRelations = Object.values(draft.relationships).some(selection => selection.mode !== 'none')
  let nextSequence = nextBasketballEventSequence(state.eventStream.events, recorderUserId)
  const events: BasketballMatchEvent[] = [createBasketballStatEvent({
    id: draft.eventId,
    eventType: 'basketball.shot',
    payload: {
      value: draft.value,
      made: draft.made,
      attempt: 'field_goal',
      valueSource: location.value
        ? draft.value === detectedValue ? 'court' : 'manual_override'
        : 'quick_entry',
      freeThrowTripId: null,
      tripAttemptNumber: null,
      captureCommandId: hasRelations ? draft.captureCommandId : null,
      recordedLater: true,
    },
    recorderUserId,
    sequence: nextSequence++,
    period: draft.period,
    elapsedMs: time.elapsedMs,
    occurredAt,
    teamSide: draft.teamSide,
    location: location.value,
    actors: [shooter.value],
  })]

  for (const kind of ['assist', 'rebound', 'block'] as const) {
    const selection = draft.relationships[kind]
    if (selection.mode === 'none') continue
    if (selection.mode === 'event') {
      return commandFailure('command_failed', 'Add Shot can record new relationships but cannot adopt an existing stat.')
    }
    if (!newRelationshipSideAllowed(kind, selection.teamSide, draft)) {
      return commandFailure('command_failed', `The selected ${kind} is not compatible with this shot.`)
    }
    const actor = basketballActorForSelection(
      state,
      relationshipRole(kind),
      selection.teamSide,
      selection.actor,
      { allowUnavailable: true }
    )
    if (!actor.ok) return actor
    if (kind === 'assist' && sameActor(actor.value, shooter.value)) {
      return commandFailure('invalid_actor', 'A shooter cannot receive the same shot assist.')
    }
    const common = {
      id: draft.relationshipEventIds[kind],
      recorderUserId,
      sequence: nextSequence++,
      period: draft.period,
      elapsedMs: time.elapsedMs,
      occurredAt,
      teamSide: selection.teamSide,
      actors: [actor.value],
    }
    const payload = {
      relatedEventId: draft.eventId,
      captureCommandId: draft.captureCommandId,
      recordedLater: true as const,
    }
    events.push(kind === 'rebound'
      ? createBasketballStatEvent({
          ...common,
          eventType: 'basketball.rebound',
          payload: {
            ...payload,
            kind: selection.teamSide === draft.teamSide ? 'offensive' : 'defensive',
          },
        })
      : createBasketballStatEvent({
          ...common,
          eventType: kind === 'assist' ? 'basketball.assist' : 'basketball.block',
          payload,
        }))
  }
  return { ok: true, value: events }
}

function prepareShotEditState(
  state: GameState,
  eventId: string
): BasketballCommandResult<PreparedShotEditState> {
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
  if (
    !rebuilt.inspection.complete ||
    rebuilt.state.sportGameState?.sportId !== 'basketball' ||
    !rebuilt.state.eventStream
  ) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before editing shots.')
  }
  const projection = rebuilt.state.sportGameState.projection
  if (!isBasketballTimelineCorrectionProjection(projection)) {
    return commandFailure('invalid_period', 'Reopen the Basketball game before editing shots.')
  }
  const inspection = inspectGameEventStream(rebuilt.state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before editing shots.')
  }
  const active = inspection.activeEvents.filter(isBasketballMatchEvent)
  const shot = active.find((event): event is BasketballShotEvent =>
    event.id === eventId && event.eventType === 'basketball.shot'
  )
  if (!shot) return commandFailure('command_failed', 'This active Basketball shot is unavailable for editing.')
  return {
    ok: true,
    value: {
      state: rebuilt.state,
      active,
      deleted: inspection.deletedEvents.filter(isBasketballMatchEvent),
      shot,
    },
  }
}

function buildShotEditPlan(
  prepared: PreparedShotEditState,
  draft: BasketballShotEditDraft,
  recorderUserId: string | null,
  occurredAt: string
): BasketballCommandResult<ShotEditPlan> {
  const original = prepared.shot
  if (original.payload.attempt === 'free_throw' && (draft.value !== 1 || draft.location !== null)) {
    return commandFailure('command_failed', 'A free throw must remain an unlocated 1-point attempt.')
  }
  if (original.payload.attempt === 'field_goal' && draft.value !== 2 && draft.value !== 3) {
    return commandFailure('command_failed', 'A field goal must remain a 2-point or 3-point attempt.')
  }
  const shooter = basketballActorForSelection(
    prepared.state,
    'shooter',
    draft.teamSide,
    draft.shooter,
    { allowUnavailable: true }
  )
  if (!shooter.ok) return shooter
  const location = draft.location === null
    ? { ok: true as const, value: null }
    : normalizeBasketballCourtLocation(draft.location)
  if (!location.ok) return location
  const valueSource = shotValueSource(original, draft, location.value)
  const shotPayload = {
    ...original.payload,
    made: draft.made,
    value: draft.value,
    valueSource,
  }
  const shotChanges = {
    teamSide: draft.teamSide,
    location: location.value,
    actors: [shooter.value],
    payload: shotPayload,
  }
  const mutations: GameEventMutation[] = []
  const appendedEvents: BasketballMatchEvent[] = []
  const notes: string[] = []
  if (!sameJson({
    teamSide: original.teamSide,
    location: original.location,
    actors: original.actors,
    payload: original.payload,
  }, shotChanges)) {
    mutations.push({ type: 'update', eventId: original.id, changes: shotChanges })
  }

  let nextSequence = nextBasketballEventSequence(prepared.state.eventStream!.events, recorderUserId)
  for (const kind of ['assist', 'rebound', 'block'] as const) {
    const related = [...prepared.active, ...prepared.deleted]
      .filter((event): event is RelatedEvent => relationshipKindForEvent(event) === kind)
    const selectedResult = resolveRelationshipSelection(
      prepared.state,
      related,
      draft.relationships[kind],
      kind,
      draft,
      shooter.value,
      original
    )
    if (!selectedResult.ok) return selectedResult
    const selected = selectedResult.value
    if (selected.autoCleared) notes.push(`${capitalize(kind)} link will be cleared because it is no longer valid.`)
    for (const event of related.filter(candidate =>
      !candidate.deletedAt && candidate.payload.relatedEventId === original.id
    )) {
      if (selected.event?.id === event.id) continue
      mutations.push({
        type: 'update',
        eventId: event.id,
        changes: { payload: { ...event.payload, relatedEventId: null } },
      })
      notes.push(`${capitalize(kind)} by ${actorLabel(event.actors[0])} will remain as a standalone stat.`)
    }
    if (selected.event) {
      if (selected.event.deletedAt) {
        mutations.push({ type: 'restore', eventId: selected.event.id })
        notes.push(`${capitalize(kind)} by ${actorLabel(selected.event.actors[0])} will be restored.`)
      } else if (selected.event.payload.relatedEventId === null) {
        mutations.push({
          type: 'update',
          eventId: selected.event.id,
          changes: { payload: { ...selected.event.payload, relatedEventId: original.id } },
        })
        notes.push(`${capitalize(kind)} by ${actorLabel(selected.event.actors[0])} will be linked.`)
      }
    }
    if (selected.newActor) {
      const role = relationshipRole(kind)
      const actor = basketballActorForSelection(
        prepared.state,
        role,
        selected.newActor.teamSide,
        selected.newActor.selection,
        { allowUnavailable: true }
      )
      if (!actor.ok) return actor
      const common = {
        id: draft.newRelationshipEventIds[kind],
        recorderUserId,
        sequence: nextSequence++,
        period: original.period,
        elapsedMs: original.elapsedMs,
        occurredAt,
        teamSide: selected.newActor.teamSide,
        actors: [actor.value],
      }
      const payload = {
        relatedEventId: original.id,
        captureCommandId: draft.correctionCaptureCommandId,
        recordedLater: true as const,
      }
      appendedEvents.push(kind === 'rebound'
        ? createBasketballStatEvent({
            ...common,
            eventType: 'basketball.rebound',
            payload: {
              ...payload,
              kind: selected.newActor.teamSide === draft.teamSide ? 'offensive' : 'defensive',
            },
          })
        : createBasketballStatEvent({
            ...common,
            eventType: kind === 'assist' ? 'basketball.assist' : 'basketball.block',
            payload,
          }))
      notes.push(`A new ${kind} by ${actorLabel(actor.value)} will be recorded and linked.`)
    }
  }
  return { ok: true, value: { appendedEvents, mutations, consequenceLines: [...new Set(notes)] } }
}

function resolveRelationshipSelection(
  state: GameState,
  events: RelatedEvent[],
  selection: BasketballShotRelationshipSelection,
  kind: BasketballShotRelationshipKind,
  draft: BasketballShotEditDraft,
  shooter: GameEventActor,
  original: BasketballShotEvent
): BasketballCommandResult<{
  event: RelatedEvent | null
  newActor: { teamSide: BasketballTeamSide; selection: BasketballCaptureActorSelection } | null
  autoCleared: boolean
}> {
  if (selection.mode === 'none') {
    return { ok: true, value: { event: null, newActor: null, autoCleared: false } }
  }
  if (selection.mode === 'event') {
    const event = events.find(candidate => candidate.id === selection.eventId)
    if (!event || (event.payload.relatedEventId !== null && event.payload.relatedEventId !== draft.eventId)) {
      return commandFailure('command_failed', `The selected ${kind} is no longer available for this shot.`)
    }
    if (!samePeriod(event, original) && event.payload.relatedEventId !== draft.eventId) {
      return commandFailure('command_failed', `A ${kind} can only be linked to a shot in the same period.`)
    }
    const compatible = relationshipCompatible(kind, event, draft, shooter)
    if (!compatible && event.payload.relatedEventId === draft.eventId) {
      return { ok: true, value: { event: null, newActor: null, autoCleared: true } }
    }
    if (!compatible) return commandFailure('command_failed', `The selected ${kind} is not compatible with this shot.`)
    if (event.deletedAt && event.payload.relatedEventId !== draft.eventId) {
      return commandFailure('command_failed', `A removed standalone ${kind} cannot be restored and re-linked in one edit.`)
    }
    return { ok: true, value: { event, newActor: null, autoCleared: false } }
  }
  if (!newRelationshipSideAllowed(kind, selection.teamSide, draft)) {
    return commandFailure('command_failed', `The new ${kind} side is not compatible with this shot.`)
  }
  const actor = basketballActorForSelection(
    state,
    relationshipRole(kind),
    selection.teamSide,
    selection.actor,
    { allowUnavailable: true }
  )
  if (!actor.ok) return actor
  if (kind === 'assist' && sameActor(actor.value, shooter)) {
    return commandFailure('invalid_actor', 'A shooter cannot receive the same shot assist.')
  }
  return {
    ok: true,
    value: {
      event: null,
      newActor: { teamSide: selection.teamSide, selection: selection.actor },
      autoCleared: false,
    },
  }
}

function relationshipCompatible(
  kind: BasketballShotRelationshipKind,
  event: RelatedEvent,
  draft: BasketballShotEditDraft,
  shooter: GameEventActor
): boolean {
  if (kind === 'assist') {
    return event.eventType === 'basketball.assist' &&
      draft.made &&
      draft.value !== 1 &&
      event.teamSide === draft.teamSide &&
      !sameActor(event.actors[0], shooter)
  }
  if (kind === 'rebound') {
    return event.eventType === 'basketball.rebound' &&
      !draft.made &&
      (event.payload.kind === 'offensive'
        ? event.teamSide === draft.teamSide
        : event.teamSide !== draft.teamSide)
  }
  return event.eventType === 'basketball.block' &&
    !draft.made &&
    draft.value !== 1 &&
    event.teamSide !== draft.teamSide
}

function samePeriod(
  left: Pick<BasketballMatchEvent, 'period'>,
  right: Pick<BasketballMatchEvent, 'period'>
): boolean {
  return left.period.id === right.period.id && left.period.order === right.period.order
}

function periodLabel(state: GameState, periodId: string): string {
  return state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.periods.find(period => period.id === periodId)?.label ?? periodId
    : periodId
}

function newRelationshipSideAllowed(
  kind: BasketballShotRelationshipKind,
  side: BasketballTeamSide,
  draft: Pick<BasketballShotEditDraft, 'made' | 'value' | 'teamSide'>
): boolean {
  if (kind === 'assist') return draft.made && draft.value !== 1 && side === draft.teamSide
  if (kind === 'rebound') return !draft.made
  return !draft.made && draft.value !== 1 && side !== draft.teamSide
}

function shotValueSource(
  original: BasketballShotEvent,
  draft: BasketballShotEditDraft,
  location: BasketballShotEvent['location']
): BasketballShotValueSource {
  if (original.payload.attempt === 'free_throw') return 'free_throw'
  if (!location) return original.payload.valueSource === 'manual_override' ? 'manual_override' : 'quick_entry'
  const point = normalizedCourtLocationToFeet(location)
  return draft.value === (isThreePointer(point.x, point.y) ? 3 : 2)
    ? 'court'
    : 'manual_override'
}

function consequenceLines(
  before: GameState,
  after: GameState,
  original: BasketballShotEvent,
  draft: BasketballShotEditDraft,
  relationshipLines: string[]
): string[] {
  const lines: string[] = []
  const originalShooter = actorLabel(original.actors[0])
  const nextShooter = actorSelectionLabel(after, draft.teamSide, draft.shooter)
  if (originalShooter !== nextShooter || original.teamSide !== draft.teamSide) {
    lines.push(`Shooter: ${originalShooter} (${original.teamSide}) to ${nextShooter} (${draft.teamSide}).`)
  }
  if (original.payload.made !== draft.made || original.payload.value !== draft.value) {
    lines.push(
      `Shot: ${original.payload.made ? 'made' : 'missed'} ${original.payload.value}-point to ` +
      `${draft.made ? 'made' : 'missed'} ${draft.value}-point.`
    )
  }
  const originalLocation = original.location ? normalizedCourtLocationToFeet(original.location) : null
  if (!sameJson(originalLocation, draft.location)) {
    lines.push(draft.location
      ? `Court location: ${draft.location.x.toFixed(1)}, ${draft.location.y.toFixed(1)} ft.`
      : 'Court location will be removed.')
  }
  if (
    before.sportGameState?.sportId === 'basketball' &&
    after.sportGameState?.sportId === 'basketball'
  ) {
    for (const side of ['tracked', 'opponent'] as const) {
      const from = before.sportGameState.projection.score[side]
      const to = after.sportGameState.projection.score[side]
      if (from !== to) lines.push(`${capitalize(side)} score: ${from} to ${to}.`)
    }
  }
  return [...lines, ...relationshipLines]
}

function firstNewRelationshipWarning(before: GameState, after: GameState): string | null {
  if (
    before.sportGameState?.sportId !== 'basketball' ||
    after.sportGameState?.sportId !== 'basketball'
  ) return 'Basketball projection is unavailable.'
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
      capturePreferences: {
        ...state.sportGameState.capturePreferences,
        lastCourtUndo: null,
      },
    },
  }
}

function eventStreamFingerprint(state: GameState): string {
  return (state.eventStream?.events ?? []).map(raw => {
    if (!isGameEventEnvelope(raw)) return JSON.stringify(raw)
    return `${raw.id}:${raw.revision}:${raw.updatedAt}:${raw.deletedAt ?? ''}`
  }).join('|')
}

function actorToSelection(actor: GameEventActor): BasketballCaptureActorSelection {
  if (actor.participantId) return { kind: 'participant', participantId: actor.participantId }
  if (actor.kind === 'team') return { kind: 'team' }
  return { kind: 'unknown', label: actor.label || 'Unknown participant' }
}

function actorForRole(event: BasketballShotEvent, role: string): GameEventActor {
  return event.actors.find(actor => actor.role === role) ?? event.actors[0]
}

function actorLabel(actor: GameEventActor | undefined): string {
  return actor?.label?.trim() || (actor?.kind === 'team' ? 'Team' : 'Unknown participant')
}

function actorLabelForParticipant(state: GameState, participantId: string): string {
  if (state.sportGameState?.sportId !== 'basketball') return 'Unknown participant'
  const participant = state.sportGameState.projection.participants[participantId]
  if (!participant) return 'Unknown participant'
  return participant.number?.trim()
    ? `#${participant.number.trim()} ${participant.displayName}`
    : participant.displayName
}

function actorSelectionLabel(
  state: GameState,
  teamSide: BasketballTeamSide,
  selection: BasketballCaptureActorSelection
): string {
  if (selection.kind === 'participant') return actorLabelForParticipant(state, selection.participantId)
  if (selection.kind === 'unknown') return selection.label
  return teamSide === 'tracked'
    ? state.gameInfo?.teamName || 'Tracked team'
    : state.gameInfo?.opponentName || 'Opponent'
}

function sameActor(left: GameEventActor | undefined, right: GameEventActor | undefined): boolean {
  if (!left || !right) return false
  if (left.participantId || right.participantId) {
    return Boolean(left.participantId && left.participantId === right.participantId)
  }
  return left.kind === right.kind && left.label === right.label
}

function selectionMatchesActor(selection: BasketballCaptureActorSelection, actor: GameEventActor): boolean {
  if (selection.kind === 'participant') return actor.participantId === selection.participantId
  if (selection.kind === 'team') return actor.kind === 'team'
  return actor.kind === 'unknown' && actor.label === selection.label
}

function relationshipKindForEvent(event: BasketballMatchEvent): BasketballShotRelationshipKind | null {
  if (event.eventType === 'basketball.assist') return 'assist'
  if (event.eventType === 'basketball.rebound') return 'rebound'
  if (event.eventType === 'basketball.block') return 'block'
  return null
}

function relationshipRole(kind: BasketballShotRelationshipKind): string {
  if (kind === 'assist') return 'assister'
  if (kind === 'rebound') return 'rebounder'
  return 'blocker'
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function commandFailure<T>(
  code: BasketballCommandErrorCode,
  message: string
): BasketballCommandResult<T> {
  return { ok: false, code, message }
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballShotEditResult {
  return { ok: false, state, code, message }
}

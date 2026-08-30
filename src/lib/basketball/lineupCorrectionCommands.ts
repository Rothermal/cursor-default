import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventMutation, GameEventPeriod, JsonObject } from '../gameEvents/types'
import type {
  BasketballCommandErrorCode,
  BasketballCommandResult,
  BasketballStateCommandResult,
} from './commands'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import { validateBasketballHistoricalTime } from './historicalTime'
import { formatBasketballDurationMs } from './duration'
import { isBasketballLineupEvent } from './lineupProjection'
import type {
  BasketballEqualPlayViolationCode,
  BasketballLineupEvent,
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballRoleChange,
  BasketballSubstitutionMode,
  BasketballSubstitutionReasonCode,
} from './types'

interface BasketballLineupCorrectionDraftBase {
  eventId: string
  expectedRevision: number
  period: GameEventPeriod
  teamSide: 'tracked' | 'opponent'
  elapsedMs: number | null
}

export type BasketballLineupCorrectionDraft =
  | BasketballLineupCorrectionDraftBase & {
      eventType: 'basketball.substitution'
      participantIds: string[]
      mode: BasketballSubstitutionMode
      reasonCode: BasketballSubstitutionReasonCode | null
      reasonNote: string | null
    }
  | BasketballLineupCorrectionDraftBase & {
      eventType: 'basketball.role_changed'
      changes: BasketballRoleChange[]
    }
  | BasketballLineupCorrectionDraftBase & {
      eventType: 'basketball.equal_play_override'
      candidateParticipantIds: string[]
      violationCodes: BasketballEqualPlayViolationCode[]
      reason: string
    }
  | BasketballLineupCorrectionDraftBase & {
      eventType: 'basketball.lineup_confirmed'
      participantIds: string[]
      violationCodes?: BasketballEqualPlayViolationCode[]
    }

export interface BasketballLineupCorrectionPreview {
  eventId: string
  eventLabel: string
  streamFingerprint: string
  expectedRevisions: Record<string, number>
  mutations: GameEventMutation[]
  consequenceLines: string[]
  affectedEventIds: string[]
  requiresConfirmation: true
}

export function isBasketballEditableLineupEvent(
  event: BasketballMatchEvent
): event is BasketballLineupEvent {
  return isBasketballLineupEvent(event)
}

export function basketballLineupCorrectionDraft(
  state: GameState,
  eventId: string
): BasketballCommandResult<BasketballLineupCorrectionDraft> {
  const prepared = prepareLineupCorrection(state, eventId)
  if (!prepared.ok) return prepared
  const event = prepared.value.event
  const base = {
    eventId: event.id,
    expectedRevision: event.revision,
    period: { ...event.period },
    teamSide: event.teamSide,
    elapsedMs: event.elapsedMs,
  }
  switch (event.eventType) {
    case 'basketball.substitution':
      return { ok: true, value: {
        ...base,
        eventType: event.eventType,
        participantIds: [...event.payload.participantIds],
        mode: event.payload.mode,
        reasonCode: event.payload.reasonCode,
        reasonNote: event.payload.reasonNote,
      } }
    case 'basketball.role_changed':
      return { ok: true, value: {
        ...base,
        eventType: event.eventType,
        changes: structuredClone(event.payload.changes),
      } }
    case 'basketball.equal_play_override':
      return { ok: true, value: {
        ...base,
        eventType: event.eventType,
        candidateParticipantIds: [...event.payload.candidateParticipantIds],
        violationCodes: [...event.payload.violationCodes],
        reason: event.payload.reason,
      } }
    case 'basketball.lineup_confirmed': {
      const override = captureGroup(prepared.value.activeEvents, event).find(candidate =>
        candidate.eventType === 'basketball.equal_play_override'
      )
      return { ok: true, value: {
        ...base,
        eventType: event.eventType,
        participantIds: [...event.payload.participantIds],
        ...(override?.eventType === 'basketball.equal_play_override'
          ? { violationCodes: [...override.payload.violationCodes] }
          : {}),
      } }
    }
  }
}

export function previewBasketballLineupCorrection(
  state: GameState,
  draft: BasketballLineupCorrectionDraft,
  now = new Date().toISOString()
): BasketballCommandResult<BasketballLineupCorrectionPreview> {
  const prepared = prepareLineupCorrection(state, draft.eventId)
  if (!prepared.ok) return prepared
  const beforeProjection = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection
    : null
  if (!beforeProjection) return commandFailure('setup_incomplete', 'Basketball projection is unavailable.')
  const { event, activeEvents } = prepared.value
  if (event.revision !== draft.expectedRevision || event.eventType !== draft.eventType) {
    return commandFailure('command_failed', 'The lineup event changed. Reopen it before editing.')
  }
  const time = validateBasketballHistoricalTime(state, event.period, draft.elapsedMs)
  if (!time.ok) return commandFailure('invalid_timestamp', time.message)
  const group = captureGroup(activeEvents, event)
  const mutations = buildCorrectionMutations(group, event, draft)
  const baseline = clearQuickUndoReceipt(state)
  const candidate = applyGameEventMutations(
    baseline,
    mutations,
    now,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!candidate.ok || !candidate.inspection.complete || candidate.state.sportGameState?.sportId !== 'basketball') {
    const equalPlayConflict = !candidate.ok &&
      candidate.error.code === 'incomplete_projection' &&
      group.some(candidate =>
        candidate.eventType === 'basketball.equal_play_override' ||
        candidate.eventType === 'basketball.lineup_confirmed'
      )
    return commandFailure(
      'command_failed',
      candidate.ok
        ? 'The lineup correction did not produce a complete Basketball projection.'
        : equalPlayConflict
          ? 'The edited boundary candidate no longer matches its projector-derived equal-play review.'
          : candidate.error.message
    )
  }
  return {
    ok: true,
    value: {
      eventId: event.id,
      eventLabel: lineupEventLabel(event),
      streamFingerprint: eventStreamFingerprint(state),
      expectedRevisions: Object.fromEntries(group.map(candidate => [candidate.id, candidate.revision])),
      mutations,
      consequenceLines: lineupConsequenceLines(
        beforeProjection,
        candidate.state.sportGameState.projection,
        group
      ),
      affectedEventIds: mutations.map(mutation => mutation.eventId),
      requiresConfirmation: true,
    },
  }
}

export function applyBasketballLineupCorrection(
  state: GameState,
  preview: BasketballLineupCorrectionPreview,
  now = new Date().toISOString()
): BasketballStateCommandResult {
  if (!validTimestamp(now)) return failure(state, 'invalid_timestamp', 'Basketball correction timestamp is invalid.')
  const prepared = prepareLineupCorrection(state, preview.eventId)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the lineup correction again.')
  }
  if (!state.eventStream) return failure(state, 'setup_incomplete', 'Basketball event history is unavailable.')
  for (const [eventId, revision] of Object.entries(preview.expectedRevisions)) {
    const raw = state.eventStream.events.find(candidate =>
      isGameEventEnvelope(candidate) && candidate.id === eventId
    )
    if (!isGameEventEnvelope(raw) || raw.revision !== revision || raw.deletedAt !== null) {
      return failure(state, 'command_failed', 'A grouped lineup event changed. Review the correction again.')
    }
  }
  const result = applyGameEventMutations(
    clearQuickUndoReceipt(state),
    preview.mutations,
    now,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(
      state,
      'command_failed',
      result.ok ? 'The lineup correction did not produce a complete Basketball projection.' : result.error.message
    )
  }
  return { ok: true, state: reconcileBasketballPlayerRows(result.state) }
}

function prepareLineupCorrection(
  state: GameState,
  eventId: string
): BasketballCommandResult<{ event: BasketballLineupEvent; activeEvents: BasketballMatchEvent[] }> {
  if (isFinalBasketballCloudGame(state)) {
    return commandFailure('cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  if (state.sportGameState?.sportId !== 'basketball' || !state.eventStream) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  if (
    state.sportGameState.projection.status !== 'in_progress' &&
    state.sportGameState.projection.status !== 'period_break'
  ) {
    return commandFailure('invalid_period', 'Lineup correction is available only in a local nonterminal game.')
  }
  if (state.sportGameState.projection.clock?.running) {
    return commandFailure('command_failed', 'Pause the Basketball clock before correcting lineup history.')
  }
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) return commandFailure('command_failed', 'Basketball event history is incomplete.')
  const activeEvents = inspection.activeEvents.filter(isBasketballMatchEvent)
  const event = activeEvents.find(candidate => candidate.id === eventId)
  if (!event || !isBasketballLineupEvent(event)) {
    return commandFailure('nothing_to_undo', 'This Basketball lineup event is unavailable.')
  }
  return { ok: true, value: { event, activeEvents } }
}

function buildCorrectionMutations(
  group: BasketballMatchEvent[],
  source: BasketballLineupEvent,
  draft: BasketballLineupCorrectionDraft
): GameEventMutation[] {
  const candidateIds = draft.eventType === 'basketball.substitution' ||
    draft.eventType === 'basketball.lineup_confirmed'
    ? draft.participantIds
    : draft.eventType === 'basketball.equal_play_override'
      ? draft.candidateParticipantIds
      : null
  return group.map(event => {
    let payload: JsonObject = { ...event.payload, recordedLater: true }
    if (event.id === source.id) payload = correctedPayload(event, draft)
    if (candidateIds && event.eventType === 'basketball.substitution') {
      payload = { ...payload, participantIds: [...candidateIds] }
    }
    if (candidateIds && event.eventType === 'basketball.lineup_confirmed') {
      payload = { ...payload, participantIds: [...candidateIds] }
    }
    if (candidateIds && event.eventType === 'basketball.equal_play_override') {
      payload = {
        ...payload,
        candidateParticipantIds: [...candidateIds],
        ...(draft.eventType === 'basketball.equal_play_override' ||
          draft.eventType === 'basketball.lineup_confirmed' && draft.violationCodes
          ? { violationCodes: [...(draft.violationCodes ?? event.payload.violationCodes)] }
          : {}),
      }
    }
    return {
      type: 'update' as const,
      eventId: event.id,
      changes: { elapsedMs: draft.elapsedMs, payload },
    }
  })
}

function correctedPayload(
  event: BasketballMatchEvent,
  draft: BasketballLineupCorrectionDraft
): JsonObject {
  const marker = { recordedLater: true as const }
  switch (draft.eventType) {
    case 'basketball.substitution':
      return {
        ...event.payload,
        participantIds: [...draft.participantIds],
        mode: draft.mode,
        reasonCode: draft.reasonCode,
        reasonNote: draft.reasonNote,
        ...marker,
      }
    case 'basketball.role_changed':
      return { ...event.payload, changes: structuredClone(draft.changes), ...marker }
    case 'basketball.equal_play_override':
      return {
        ...event.payload,
        candidateParticipantIds: [...draft.candidateParticipantIds],
        violationCodes: [...draft.violationCodes],
        reason: draft.reason,
        ...marker,
      }
    case 'basketball.lineup_confirmed':
      return { ...event.payload, participantIds: [...draft.participantIds], ...marker }
  }
}

function captureGroup(events: BasketballMatchEvent[], source: BasketballMatchEvent): BasketballMatchEvent[] {
  const commandId = typeof source.payload.captureCommandId === 'string'
    ? source.payload.captureCommandId
    : null
  return commandId
    ? events.filter(event => event.payload.captureCommandId === commandId)
    : [source]
}

function lineupConsequenceLines(
  before: BasketballMatchProjection,
  after: BasketballMatchProjection,
  group: BasketballMatchEvent[]
): string[] {
  const eventCount = group.length
  const lines = [`${eventCount} grouped lineup event${eventCount === 1 ? '' : 's'} will be revised atomically.`]
  for (const side of ['tracked', 'opponent'] as const) {
    const previous = before.lineup?.sides[side]
    const next = after.lineup?.sides[side]
    if (!previous || !next) continue
    if (previous.currentParticipantIds.join('|') !== next.currentParticipantIds.join('|')) {
      lines.push(`${side === 'tracked' ? 'Tracked' : 'Opponent'} current lineup will change.`)
    }
    if (previous.incompletePeriodIds.join('|') !== next.incompletePeriodIds.join('|')) {
      lines.push(`${side === 'tracked' ? 'Tracked' : 'Opponent'} completeness evidence will change.`)
    }
    for (const [participantId, participation] of Object.entries(next.participationByParticipantId)) {
      const prior = previous.participationByParticipantId[participantId]
      if (!prior || prior.participationMs === participation.participationMs) continue
      const participant = after.participants[participantId]
      lines.push(`${participant?.displayName ?? 'Participant'} time: ${formatClock(prior.participationMs)} to ${formatClock(participation.participationMs)}.`)
    }
  }
  if (before.lineup?.equalPlayCompliant !== after.lineup?.equalPlayCompliant) {
    lines.push(`Equal-play compliance will change to ${after.lineup?.equalPlayCompliant ? 'compliant' : 'not compliant'}.`)
  }
  if (before.lineup?.enforcedOverridesComplete !== after.lineup?.enforcedOverridesComplete) {
    lines.push(`Equal-play override evidence will become ${after.lineup?.enforcedOverridesComplete ? 'complete' : 'incomplete'}.`)
  }
  const groupIds = new Set(group.map(event => event.id))
  for (const review of after.lineup?.equalPlayReviews ?? []) {
    if (!groupIds.has(review.confirmationEventId) && !groupIds.has(review.overrideEventId ?? '')) continue
    const violations = [...new Set(review.violations.map(value => equalPlayViolationLabel(value.code)))]
    lines.push(
      `Equal-play review for ${review.periodId}: ${violations.length > 0 ? violations.join(', ') : 'no violations'}` +
      `${review.overrideEventId ? ' with an authorized override' : ''}.`
    )
  }
  return [...new Set(lines)]
}

function equalPlayViolationLabel(code: BasketballEqualPlayViolationCode): string {
  switch (code) {
    case 'minimum_periods': return 'minimum periods'
    case 'maximum_consecutive_periods': return 'maximum consecutive periods'
    case 'maximum_period_imbalance': return 'maximum period imbalance'
  }
}

function clearQuickUndoReceipt(state: GameState): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
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
  if (!state.eventStream) return 'missing'
  return state.eventStream.events.map(raw => isGameEventEnvelope(raw)
    ? `${raw.id}:${raw.revision}:${raw.deletedAt ?? 'active'}`
    : `invalid:${JSON.stringify(raw)}`
  ).join('|')
}

function lineupEventLabel(event: BasketballLineupEvent): string {
  switch (event.eventType) {
    case 'basketball.substitution': return event.payload.mode === 'current_lineup_recovery'
      ? 'Current lineup recovery'
      : 'Substitution'
    case 'basketball.role_changed': return 'Player roles'
    case 'basketball.equal_play_override': return 'Equal-play override'
    case 'basketball.lineup_confirmed': return 'Lineup confirmation'
  }
}

function formatClock(valueMs: number): string {
  return formatBasketballDurationMs(valueMs)
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function commandFailure<T>(
  code: BasketballCommandErrorCode,
  message: string
): BasketballCommandResult<T> {
  return { ok: false, code, message } as BasketballCommandResult<T>
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballStateCommandResult {
  return { ok: false, state, code, message } as BasketballStateCommandResult
}

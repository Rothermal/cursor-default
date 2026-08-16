import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor, GameEventMutation } from '../gameEvents/types'
import type {
  BasketballCommandErrorCode,
  BasketballCommandResult,
  BasketballStateCommandResult,
} from './commands'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import { basketballRecoverableScoreAdjustmentId } from './scoreAdjustmentRecovery'
import { buildBasketballTimelineReview } from './timeline'
import type {
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballRelationshipWarning,
  BasketballStatId,
  BasketballTeamSide,
} from './types'

const READ_ONLY_EVENT_TYPES = new Set<BasketballMatchEvent['eventType']>([
  'basketball.period_started',
  'basketball.period_ended',
  'basketball.participant_resolved',
  'basketball.match_ended',
  'basketball.match_reopened',
])

export type BasketballTimelineRemovalScope = 'event' | 'capture_group'

export interface BasketballTimelineRestoreOption {
  eventId: string
  label: string
}

interface BasketballTimelineCorrectionPreviewBase {
  eventId: string
  eventLabel: string
  streamFingerprint: string
  consequenceLines: string[]
  affectedEventIds: string[]
  requiresConfirmation: true
}

export interface BasketballTimelineRemovalPreview extends BasketballTimelineCorrectionPreviewBase {
  kind: 'remove'
  scope: BasketballTimelineRemovalScope
  captureCommandId: string | null
}

export interface BasketballTimelineRestorePreview extends BasketballTimelineCorrectionPreviewBase {
  kind: 'restore'
  selectedDependentIds: string[]
  restoreOptions: BasketballTimelineRestoreOption[]
}

export type BasketballTimelineCorrectionPreview =
  | BasketballTimelineRemovalPreview
  | BasketballTimelineRestorePreview

interface BasketballTimelineCorrectionPlan {
  mutations: GameEventMutation[]
  dependencyLines: string[]
}

interface PreparedBasketballState {
  state: GameState
  active: BasketballMatchEvent[]
  deleted: BasketballMatchEvent[]
}

interface BasketballInvariantIssue {
  identity: string
  severity: number
  message: string
}

export function previewBasketballTimelineRemoval(
  state: GameState,
  eventId: string,
  scope: BasketballTimelineRemovalScope = 'event'
): BasketballCommandResult<BasketballTimelineRemovalPreview> {
  const prepared = prepareState(state, eventId)
  if (!prepared.ok) return prepared
  const event = prepared.value.active.find(candidate => candidate.id === eventId)
  if (!event) return commandFailure('nothing_to_undo', 'This Basketball event is no longer active.')
  const captureCommandId = captureCommandIdForEvent(event)
  if (scope === 'capture_group' && !captureCommandId) {
    return commandFailure('command_failed', 'This event does not belong to a persisted capture group.')
  }
  const targetEvents = scope === 'capture_group'
    ? prepared.value.active.filter(candidate => captureCommandIdForEvent(candidate) === captureCommandId)
    : [event]
  for (const target of targetEvents) {
    const unavailable = validateRemovalAvailability(
      prepared.value.active,
      prepared.value.deleted,
      target,
      new Set(targetEvents.map(candidate => candidate.id))
    )
    if (unavailable) return commandFailure('command_failed', unavailable)
  }

  const plan = buildRemovalPlan(prepared.value.active, targetEvents)
  const candidate = validatePlan(prepared.value.state, plan.mutations)
  if (!candidate.ok) return candidate
  const labels = buildBasketballTimelineReview(prepared.value.state).eventById
  const eventLabel = labels.get(event.id)?.title ?? 'Basketball event'
  return {
    ok: true,
    value: {
      kind: 'remove',
      scope,
      eventId,
      eventLabel,
      captureCommandId,
      streamFingerprint: eventStreamFingerprint(prepared.value.state),
      consequenceLines: correctionConsequenceLines(
        prepared.value.state,
        candidate.value,
        plan,
        'removed'
      ),
      affectedEventIds: plan.mutations.map(mutation => mutation.eventId),
      requiresConfirmation: true,
    },
  }
}

export function removeBasketballTimelineEvents(
  state: GameState,
  preview: BasketballTimelineRemovalPreview,
  now = new Date().toISOString()
): BasketballStateCommandResult {
  const timestamp = validTimestamp(now)
  if (!timestamp) return failure(state, 'invalid_timestamp', 'Basketball correction timestamp is invalid.')
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the removal again before applying it.')
  }
  const prepared = prepareState(state, preview.eventId)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const event = prepared.value.active.find(candidate => candidate.id === preview.eventId)
  if (!event) return failure(state, 'nothing_to_undo', 'This Basketball event is no longer active.')
  const captureCommandId = captureCommandIdForEvent(event)
  if (preview.scope === 'capture_group' && captureCommandId !== preview.captureCommandId) {
    return failure(state, 'command_failed', 'The removal capture group changed. Review it again before applying.')
  }
  const targets = preview.scope === 'capture_group'
    ? prepared.value.active.filter(candidate => captureCommandIdForEvent(candidate) === preview.captureCommandId)
    : [event]
  const removingIds = new Set(targets.map(candidate => candidate.id))
  for (const target of targets) {
    const unavailable = validateRemovalAvailability(
      prepared.value.active,
      prepared.value.deleted,
      target,
      removingIds
    )
    if (unavailable) return failure(state, 'command_failed', unavailable)
  }
  const plan = buildRemovalPlan(prepared.value.active, targets)
  if (!sameStringSet(plan.mutations.map(mutation => mutation.eventId), preview.affectedEventIds)) {
    return failure(state, 'command_failed', 'The removal consequences changed. Review them again before applying.')
  }
  return applyTimelinePlan(state, prepared.value.state, plan.mutations, timestamp)
}

export function previewBasketballTimelineRestore(
  state: GameState,
  eventId: string,
  selectedDependentIds: string[] = [],
  knownCompatiblePreview?: Pick<
    BasketballTimelineRestorePreview,
    'eventLabel' | 'restoreOptions' | 'streamFingerprint'
  >
): BasketballCommandResult<BasketballTimelineRestorePreview> {
  const prepared = prepareState(state)
  if (!prepared.ok) return prepared
  const event = prepared.value.deleted.find(candidate => candidate.id === eventId)
  if (!event) return commandFailure('restore_unavailable', 'This Basketball event is no longer removed.')
  if (READ_ONLY_EVENT_TYPES.has(event.eventType)) {
    return commandFailure('restore_unavailable', 'Basketball lifecycle and identity boundaries are read-only.')
  }

  const baseMutation: GameEventMutation = { type: 'restore', eventId }
  const baseCandidate = validatePlan(prepared.value.state, [baseMutation])
  if (!baseCandidate.ok) return baseCandidate
  const relatedDeletedIds = new Set(prepared.value.deleted
    .filter(candidate => candidate.id !== event.id && relationshipSourceId(candidate) === event.id)
    .map(candidate => candidate.id))
  const streamFingerprint = eventStreamFingerprint(prepared.value.state)
  const canReusePreview = knownCompatiblePreview?.streamFingerprint === streamFingerprint &&
    knownCompatiblePreview.restoreOptions.every(option => relatedDeletedIds.has(option.eventId))
  let eventLabel: string
  let options: BasketballTimelineRestoreOption[]
  if (canReusePreview && knownCompatiblePreview) {
    eventLabel = knownCompatiblePreview.eventLabel
    options = knownCompatiblePreview.restoreOptions
  } else {
    const labels = buildBasketballTimelineReview(prepared.value.state).eventById
    eventLabel = labels.get(event.id)?.title ?? 'Basketball event'
    options = compatibleRestoreOptions(prepared.value, event, labels)
  }
  const compatibleIds = new Set(options.map(option => option.eventId))
  const selected = [...new Set(selectedDependentIds)]
  if (selected.some(id => !compatibleIds.has(id))) {
    return commandFailure(
      'restore_unavailable',
      'One or more selected related events can no longer be restored with this event.'
    )
  }
  const mutations: GameEventMutation[] = [
    baseMutation,
    ...selected.map(dependentId => ({ type: 'restore' as const, eventId: dependentId })),
  ]
  const candidate = validatePlan(prepared.value.state, mutations)
  if (!candidate.ok) return candidate
  const plan: BasketballTimelineCorrectionPlan = {
    mutations,
    dependencyLines: selected.length > 0
      ? [`${countLabel(selected.length, 'compatible related event')} will also be restored.`]
      : options.length > 0
        ? [`${countLabel(options.length, 'compatible related event')} will remain removed unless selected.`]
        : [],
  }
  return {
    ok: true,
    value: {
      kind: 'restore',
      eventId,
      eventLabel,
      streamFingerprint,
      consequenceLines: correctionConsequenceLines(
        prepared.value.state,
        candidate.value,
        plan,
        'restored'
      ),
      affectedEventIds: mutations.map(mutation => mutation.eventId),
      selectedDependentIds: selected,
      restoreOptions: options,
      requiresConfirmation: true,
    },
  }
}

export function restoreBasketballTimelineEvent(
  state: GameState,
  preview: BasketballTimelineRestorePreview,
  now = new Date().toISOString()
): BasketballStateCommandResult {
  const timestamp = validTimestamp(now)
  if (!timestamp) return failure(state, 'invalid_timestamp', 'Basketball restore timestamp is invalid.')
  if (eventStreamFingerprint(state) !== preview.streamFingerprint) {
    return failure(state, 'command_failed', 'The Timeline changed. Review the restoration again before applying it.')
  }
  const prepared = prepareState(state)
  if (!prepared.ok) return failure(state, prepared.code, prepared.message)
  const source = prepared.value.deleted.find(event => event.id === preview.eventId)
  if (!source) return failure(state, 'restore_unavailable', 'This Basketball event is no longer removed.')
  if (READ_ONLY_EVENT_TYPES.has(source.eventType)) {
    return failure(state, 'restore_unavailable', 'Basketball lifecycle and identity boundaries are read-only.')
  }
  const selected = [...new Set(preview.selectedDependentIds)]
  const selectedEvents = selected.map(eventId =>
    prepared.value.deleted.find(event => event.id === eventId)
  )
  if (
    selectedEvents.some(event => !event) ||
    selectedEvents.some(event => event && relationshipSourceId(event) !== source.id)
  ) {
    return failure(state, 'restore_unavailable', 'A selected related event can no longer be restored with this event.')
  }
  const mutations: GameEventMutation[] = [
    { type: 'restore', eventId: preview.eventId },
    ...selected.map(eventId => ({ type: 'restore' as const, eventId })),
  ]
  if (!sameStringSet(mutations.map(mutation => mutation.eventId), preview.affectedEventIds)) {
    return failure(state, 'command_failed', 'The restoration consequences changed. Review them again before applying.')
  }
  return applyTimelinePlan(state, prepared.value.state, mutations, timestamp)
}

function prepareState(
  state: GameState,
  requestedRecoveryEventId?: string
): BasketballCommandResult<PreparedBasketballState> {
  if (
    state.sport?.id !== 'basketball' ||
    state.sportGameState?.sportId !== 'basketball' ||
    !state.eventStream
  ) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  if (isFinalBasketballCloudGame(state)) {
    return commandFailure('cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  const recovering = Boolean(
    requestedRecoveryEventId &&
    basketballRecoverableScoreAdjustmentId(state, rebuilt.inspection.diagnostics) === requestedRecoveryEventId
  )
  if (
    (!rebuilt.inspection.complete && !recovering) ||
    rebuilt.state.sportGameState?.sportId !== 'basketball' ||
    !rebuilt.state.eventStream
  ) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before changing events.')
  }
  if (!recovering && (
    rebuilt.state.sportGameState.projection.status !== 'in_progress' &&
    rebuilt.state.sportGameState.projection.status !== 'period_break'
  )) {
    return commandFailure('invalid_period', 'Reopen the Basketball game before changing Timeline events.')
  }
  const inspection = inspectGameEventStream(rebuilt.state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    return commandFailure('command_failed', 'Resolve Basketball Timeline diagnostics before changing events.')
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

function validateRemovalAvailability(
  activeEvents: BasketballMatchEvent[],
  deletedEvents: BasketballMatchEvent[],
  event: BasketballMatchEvent,
  removingIds = new Set([event.id])
): string | null {
  if (READ_ONLY_EVENT_TYPES.has(event.eventType)) {
    return 'Basketball lifecycle and identity boundaries are read-only.'
  }
  if (event.eventType !== 'basketball.match_roster_added') return null
  const participantId = event.payload.participant.id
  const dependent = [...activeEvents, ...deletedEvents].find(candidate =>
    !removingIds.has(candidate.id) && (
      candidate.actors.some(actor => actor.participantId === participantId) ||
      (candidate.eventType === 'basketball.participant_resolved' &&
        candidate.payload.participantId === participantId)
    )
  )
  return dependent
    ? 'This late roster addition has later active or removed participant history and cannot be removed.'
    : null
}

function buildRemovalPlan(
  activeEvents: BasketballMatchEvent[],
  targetEvents: BasketballMatchEvent[]
): BasketballTimelineCorrectionPlan {
  const targetIds = new Set(targetEvents.map(event => event.id))
  const deleteIds = new Set(targetIds)
  const updates = new Map<string, GameEventMutation>()
  let linkedAssistCount = 0
  let linkedReboundCount = 0
  let unlinkedBlockCount = 0
  let unlinkedStealCount = 0
  let unlinkedTripCount = 0
  let unlinkedEjectionCount = 0
  let removedAutomaticEjectionCount = 0
  let unlinkedAttemptCount = 0

  for (const event of activeEvents) {
    if (targetIds.has(event.id)) continue
    if (
      event.eventType === 'basketball.assist' &&
      event.payload.relatedEventId &&
      targetIds.has(event.payload.relatedEventId)
    ) {
      deleteIds.add(event.id)
      linkedAssistCount += 1
      continue
    }
    if (
      event.eventType === 'basketball.rebound' &&
      event.payload.relatedEventId &&
      targetIds.has(event.payload.relatedEventId)
    ) {
      deleteIds.add(event.id)
      linkedReboundCount += 1
      continue
    }
    if (
      event.eventType === 'basketball.block' &&
      event.payload.relatedEventId &&
      targetIds.has(event.payload.relatedEventId)
    ) {
      updates.set(event.id, clearRelatedEventMutation(event))
      unlinkedBlockCount += 1
      continue
    }
    if (
      event.eventType === 'basketball.steal' &&
      event.payload.relatedEventId &&
      targetIds.has(event.payload.relatedEventId)
    ) {
      updates.set(event.id, clearRelatedEventMutation(event))
      unlinkedStealCount += 1
      continue
    }
    if (
      event.eventType === 'basketball.free_throw_trip' &&
      event.payload.sourceFoulEventId &&
      targetIds.has(event.payload.sourceFoulEventId)
    ) {
      updates.set(event.id, {
        type: 'update',
        eventId: event.id,
        changes: { payload: { ...event.payload, sourceFoulEventId: null } },
      })
      unlinkedTripCount += 1
      continue
    }
    if (
      event.eventType === 'basketball.ejection' &&
      event.payload.relatedFoulEventId &&
      targetIds.has(event.payload.relatedFoulEventId)
    ) {
      if (event.payload.source === 'automatic_threshold') {
        deleteIds.add(event.id)
        removedAutomaticEjectionCount += 1
        continue
      }
      updates.set(event.id, {
        type: 'update',
        eventId: event.id,
        changes: { payload: { ...event.payload, relatedFoulEventId: null } },
      })
      unlinkedEjectionCount += 1
      continue
    }
    if (
      event.eventType === 'basketball.shot' &&
      event.payload.attempt === 'free_throw' &&
      event.payload.freeThrowTripId &&
      targetIds.has(event.payload.freeThrowTripId)
    ) {
      updates.set(event.id, {
        type: 'update',
        eventId: event.id,
        changes: {
          payload: {
            ...event.payload,
            freeThrowTripId: null,
            tripAttemptNumber: null,
          },
        },
      })
      unlinkedAttemptCount += 1
    }
  }

  for (const id of deleteIds) updates.delete(id)
  const orderedDeletes = activeEvents
    .filter(event => deleteIds.has(event.id))
    .sort(compareGameEventCaptureOrder)
    .map(event => ({ type: 'delete' as const, eventId: event.id }))
  const mutations = [...orderedDeletes, ...updates.values()]
  const dependencyLines = [
    linkedAssistCount > 0 ? `${countLabel(linkedAssistCount, 'linked assist')} will also be removed.` : null,
    linkedReboundCount > 0 ? `${countLabel(linkedReboundCount, 'linked rebound')} will also be removed.` : null,
    unlinkedBlockCount > 0 ? `${countLabel(unlinkedBlockCount, 'surviving block')} will keep its stat and lose the shot link.` : null,
    unlinkedStealCount > 0 ? `${countLabel(unlinkedStealCount, 'surviving steal')} will keep its stat and lose the turnover link.` : null,
    unlinkedTripCount > 0 ? `${countLabel(unlinkedTripCount, 'surviving free-throw trip')} will lose its source-foul link.` : null,
    unlinkedEjectionCount > 0 ? `${countLabel(unlinkedEjectionCount, 'surviving ejection')} will lose its source-foul link.` : null,
    removedAutomaticEjectionCount > 0 ? `${countLabel(removedAutomaticEjectionCount, 'automatic ejection')} will also be removed.` : null,
    unlinkedAttemptCount > 0 ? `${countLabel(unlinkedAttemptCount, 'surviving free throw')} will become ungrouped without renumbering other attempts.` : null,
  ].filter((line): line is string => Boolean(line))
  return { mutations, dependencyLines }
}

function compatibleRestoreOptions(
  prepared: PreparedBasketballState,
  source: BasketballMatchEvent,
  labels: ReadonlyMap<string, { title: string }>
): BasketballTimelineRestoreOption[] {
  const candidates = prepared.deleted.filter(event =>
    event.id !== source.id && relationshipSourceId(event) === source.id
  )
  return candidates
    .filter(candidate => validatePlan(prepared.state, [
      { type: 'restore', eventId: source.id },
      { type: 'restore', eventId: candidate.id },
    ]).ok)
    .sort(compareGameEventCaptureOrder)
    .map(event => ({
      eventId: event.id,
      label: labels.get(event.id)?.title ?? 'Basketball event',
    }))
}

function relationshipSourceId(event: BasketballMatchEvent): string | null {
  if (
    event.eventType === 'basketball.assist' ||
    event.eventType === 'basketball.rebound' ||
    event.eventType === 'basketball.block' ||
    event.eventType === 'basketball.steal'
  ) return event.payload.relatedEventId
  if (event.eventType === 'basketball.free_throw_trip') return event.payload.sourceFoulEventId
  if (event.eventType === 'basketball.ejection') return event.payload.relatedFoulEventId
  if (event.eventType === 'basketball.shot' && event.payload.attempt === 'free_throw') {
    return event.payload.freeThrowTripId
  }
  return null
}

function validatePlan(
  state: GameState,
  mutations: GameEventMutation[],
  now = new Date().toISOString()
): BasketballCommandResult<GameState> {
  const baselineState = clearQuickUndoReceipt(state)
  const result = applyGameEventMutations(
    baselineState,
    mutations,
    now,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete || result.state.sportGameState?.sportId !== 'basketball') {
    return commandFailure(
      'command_failed',
      result.ok
        ? 'The correction did not produce a complete Basketball projection.'
        : result.error.message
    )
  }
  const baselineProjection = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection
    : null
  if (!baselineProjection) return commandFailure('setup_incomplete', 'Basketball projection is unavailable.')
  const newWarning = firstNewRelationshipWarning(
    baselineProjection.relationshipWarnings,
    result.state.sportGameState.projection.relationshipWarnings
  )
  if (newWarning) {
    return commandFailure('command_failed', `This correction would create an invalid relationship: ${newWarning.message}`)
  }
  const worsenedInvariant = firstWorsenedInvariant(
    basketballInvariantIssues(state),
    basketballInvariantIssues(result.state)
  )
  if (worsenedInvariant) return commandFailure('command_failed', worsenedInvariant.message)
  return { ok: true, value: result.state }
}

function applyTimelinePlan(
  originalState: GameState,
  baselineState: GameState,
  mutations: GameEventMutation[],
  now: string
): BasketballStateCommandResult {
  const validated = validatePlan(baselineState, mutations, now)
  if (!validated.ok) return failure(originalState, validated.code, validated.message)
  return { ok: true, state: reconcileBasketballPlayerRows(validated.value) }
}

function basketballInvariantIssues(state: GameState): BasketballInvariantIssue[] {
  if (state.sportGameState?.sportId !== 'basketball' || !state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    return [{
      identity: 'incomplete-history',
      severity: 1,
      message: 'Basketball event history is incomplete.',
    }]
  }
  const events = inspection.activeEvents.filter(isBasketballMatchEvent)
  const issues: BasketballInvariantIssue[] = []
  const ejectionSubjects = new Map<string, string[]>()
  for (const event of events) {
    if (event.eventType !== 'basketball.ejection') continue
    const subject = event.actors.find(actor => actor.role === 'subject')
    const key = subject ? actorIdentity(subject, event.teamSide) : `missing:${event.id}`
    ejectionSubjects.set(key, [...(ejectionSubjects.get(key) ?? []), event.id])
  }
  for (const [subjectKey, eventIds] of ejectionSubjects) {
    if (eventIds.length < 2) continue
    issues.push({
      identity: `duplicate-ejection:${subjectKey}`,
      severity: eventIds.length - 1,
      message: 'Restoring this event would duplicate an active official ejection fact.',
    })
  }
  const rules = state.sportGameState.setup.rulesSnapshot
  for (const period of state.sportGameState.projection.periods) {
    const allowance = period.kind === 'overtime'
      ? rules.timeoutsPerOvertime
      : rules.timeoutsPerPeriod
    if (allowance === null) continue
    for (const side of ['tracked', 'opponent'] as const) {
      const used = state.sportGameState.projection.periodTimeouts[period.id]?.[side] ?? 0
      if (used > allowance) {
        issues.push({
          identity: `timeout-inventory:${period.id}:${side}`,
          severity: used - allowance,
          message: `Restoring this timeout would exceed the ${period.label} ${side} timeout inventory.`,
        })
      }
    }
  }
  return issues
}

function firstWorsenedInvariant(
  baseline: BasketballInvariantIssue[],
  candidate: BasketballInvariantIssue[]
): BasketballInvariantIssue | null {
  const baselineSeverity = new Map(
    baseline.map(issue => [issue.identity, issue.severity])
  )
  return candidate.find(issue =>
    issue.severity > (baselineSeverity.get(issue.identity) ?? 0)
  ) ?? null
}

function correctionConsequenceLines(
  before: GameState,
  after: GameState,
  plan: BasketballTimelineCorrectionPlan,
  action: 'removed' | 'restored'
): string[] {
  if (
    before.sportGameState?.sportId !== 'basketball' ||
    after.sportGameState?.sportId !== 'basketball'
  ) return plan.dependencyLines
  const lines = [
    `${countLabel(plan.mutations.filter(mutation => mutation.type === (action === 'removed' ? 'delete' : 'restore')).length, 'event')} will be ${action}.`,
    ...plan.dependencyLines,
    ...projectionDifferenceLines(
      before.sportGameState.projection,
      after.sportGameState.projection
    ),
  ]
  return [...new Set(lines)]
}

function projectionDifferenceLines(
  before: BasketballMatchProjection,
  after: BasketballMatchProjection
): string[] {
  const lines: string[] = []
  for (const side of ['tracked', 'opponent'] as const) {
    if (before.score[side] !== after.score[side]) {
      lines.push(`${sideLabel(side)} score: ${before.score[side]} to ${after.score[side]}.`)
    }
  }
  const statIds: BasketballStatId[] = [
    'ft', 'ft_miss', '2pt', '2pt_miss', '3pt', '3pt_miss',
    'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'min',
  ]
  const participantIds = new Set([
    ...Object.keys(before.participants),
    ...Object.keys(after.participants),
  ])
  for (const participantId of participantIds) {
    const previous = before.participants[participantId]
    const next = after.participants[participantId]
    if (!previous || !next) continue
    for (const statId of statIds) {
      if (previous.stats[statId] !== next.stats[statId]) {
        lines.push(`${next.displayName} ${statLabel(statId)}: ${formatNumber(previous.stats[statId])} to ${formatNumber(next.stats[statId])}.`)
      }
    }
    if (previous.disqualified !== next.disqualified) {
      lines.push(`${next.displayName} will ${next.disqualified ? 'become' : 'no longer be'} disqualified.`)
    }
    if (previous.ejected !== next.ejected) {
      lines.push(`${next.displayName} will ${next.ejected ? 'become' : 'no longer be'} ejected.`)
    }
  }
  const periodIds = new Set([
    ...Object.keys(before.periodTeamFouls),
    ...Object.keys(after.periodTeamFouls),
  ])
  for (const periodId of periodIds) {
    for (const side of ['tracked', 'opponent'] as const) {
      const previousFouls = before.periodTeamFouls[periodId]?.[side] ?? 0
      const nextFouls = after.periodTeamFouls[periodId]?.[side] ?? 0
      if (previousFouls !== nextFouls) {
        lines.push(`${sideLabel(side)} team fouls in ${periodLabel(after, periodId)}: ${previousFouls} to ${nextFouls}.`)
      }
      const previousBonus = before.bonusStatusByPeriod[periodId]?.[side] ?? 'none'
      const nextBonus = after.bonusStatusByPeriod[periodId]?.[side] ?? 'none'
      if (previousBonus !== nextBonus) {
        lines.push(`${sideLabel(side)} bonus in ${periodLabel(after, periodId)}: ${bonusLabel(previousBonus)} to ${bonusLabel(nextBonus)}.`)
      }
      const previousTimeouts = before.periodTimeouts[periodId]?.[side] ?? 0
      const nextTimeouts = after.periodTimeouts[periodId]?.[side] ?? 0
      if (previousTimeouts !== nextTimeouts) {
        lines.push(`${sideLabel(side)} timeouts used in ${periodLabel(after, periodId)}: ${previousTimeouts} to ${nextTimeouts}.`)
      }
    }
  }
  if (before.neutralTimeouts !== after.neutralTimeouts) {
    lines.push(`Neutral timeouts used: ${before.neutralTimeouts} to ${after.neutralTimeouts}.`)
  }
  return lines
}

function firstNewRelationshipWarning(
  baseline: BasketballRelationshipWarning[],
  candidate: BasketballRelationshipWarning[]
): BasketballRelationshipWarning | null {
  const baselineKeys = new Set(baseline.map(relationshipWarningKey))
  return candidate.find(warning => !baselineKeys.has(relationshipWarningKey(warning))) ?? null
}

function relationshipWarningKey(warning: BasketballRelationshipWarning): string {
  return `${warning.eventId}|${warning.relatedEventId}|${warning.message}`
}

function clearRelatedEventMutation(
  event: Extract<BasketballMatchEvent, { eventType: 'basketball.block' | 'basketball.steal' }>
): GameEventMutation {
  return {
    type: 'update',
    eventId: event.id,
    changes: { payload: { ...event.payload, relatedEventId: null } },
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
  return state.eventStream.events.map(raw => {
    if (!isGameEventEnvelope(raw)) return `invalid:${JSON.stringify(raw)}`
    return `${raw.id}:${raw.revision}:${raw.deletedAt ?? 'active'}`
  }).join('|')
}

function captureCommandIdForEvent(event: BasketballMatchEvent): string | null {
  return typeof event.payload.captureCommandId === 'string'
    ? event.payload.captureCommandId
    : null
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
}

function actorIdentity(actor: GameEventActor, side: BasketballMatchEvent['teamSide']): string {
  if (actor.participantId) return `participant:${actor.participantId}`
  if (actor.kind === 'player') return `player:${actor.playerId}`
  return `${side}:${actor.kind}:${actor.label}`
}

function periodLabel(projection: BasketballMatchProjection, periodId: string): string {
  return projection.periods.find(period => period.id === periodId)?.label ?? periodId
}

function sideLabel(side: BasketballTeamSide): string {
  return side === 'tracked' ? 'Tracked team' : 'Opponent'
}

function bonusLabel(value: string): string {
  return value === 'one_and_one' ? 'one-and-one' : value === 'double_bonus' ? 'double bonus' : 'none'
}

function statLabel(statId: BasketballStatId): string {
  const labels: Record<BasketballStatId, string> = {
    ft: 'made free throws',
    ft_miss: 'missed free throws',
    '2pt': 'made 2-pointers',
    '2pt_miss': 'missed 2-pointers',
    '3pt': 'made 3-pointers',
    '3pt_miss': 'missed 3-pointers',
    oreb: 'offensive rebounds',
    dreb: 'defensive rebounds',
    ast: 'assists',
    stl: 'steals',
    blk: 'blocks',
    to: 'turnovers',
    pf: 'personal fouls',
    min: 'minutes',
  }
  return labels[statId]
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value))
}

function validTimestamp(value: string): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballStateCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}

function commandFailure<T>(
  code: BasketballCommandErrorCode,
  message: string
): BasketballCommandResult<T> & { ok: false } {
  return { ok: false, code, message }
}

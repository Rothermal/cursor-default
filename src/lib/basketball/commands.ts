import { resolveTeamStatsConfig } from '../../config/teamStatsDefaults'
import type { GameState, Player } from '../../types'
import { SPORT_EVENTS_AUTHORITY } from '../gameEvents/authority'
import { isPlainObject } from '../gameEvents/envelope'
import {
  addGameEvent,
  addGameEvents,
  hasLegacyAggregateActivity,
  initializeGameEventStream,
} from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type {
  GameEventActor,
  GameEventLocation,
  GameEventPeriod,
} from '../gameEvents/types'
import {
  isTeamPseudoPlayer,
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from '../teamPlayers'
import {
  courtFeetToNormalizedLocation,
  isThreePointer,
  type BasketballCourtPoint,
} from './courtGeometry'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import { createBasketballLifecycleEvent } from './events'
import { createBasketballUuid } from './id'
import {
  createBasketballMatchRules,
  DEFAULT_BASKETBALL_RULES_SOURCE,
  normalizeBasketballMatchRules,
  normalizeBasketballRulesSource,
  resolveBasketballPeriodSegment,
} from './rules'
import {
  createBasketballSportGameState,
  validateBasketballMatchSetup,
} from './state'
import { createBasketballStatEvent } from './statEvents'
import type {
  BasketballMatchParticipant,
  BasketballMatchRulesV2,
  BasketballMatchEvent,
  BasketballMatchSetup,
  BasketballMatchSegment,
  BasketballSportGameState,
  BasketballTeamSide,
  BasketballRulesSource,
} from './types'

export type BasketballCommandErrorCode =
  | 'wrong_sport'
  | 'creation_intent_unavailable'
  | 'event_authority_required'
  | 'cloud_flow_unsupported'
  | 'legacy_activity_present'
  | 'setup_incomplete'
  | 'already_initialized'
  | 'invalid_setup'
  | 'invalid_period'
  | 'invalid_participant'
  | 'invalid_actor'
  | 'invalid_location'
  | 'invalid_timestamp'
  | 'nothing_to_undo'
  | 'nothing_to_clear'
  | 'restore_unavailable'
  | 'command_failed'

export type BasketballCommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: BasketballCommandErrorCode; message: string }

export type BasketballStateCommandResult =
  | { ok: true; state: GameState }
  | {
      ok: false
      state: GameState
      code: BasketballCommandErrorCode
      message: string
    }

export interface BasketballStartOptions {
  recorderUserId: string | null
  occurredAt?: string
  eventId?: string
  participantIds?: string[]
  reviewedSetup?: BasketballReviewedStartSetup
}

export interface BasketballReviewedStartSetup {
  rulesSnapshot: BasketballMatchRulesV2
  rulesSource: BasketballRulesSource
  sourceTeamId: string | null
  sourceSeasonId: string | null
  courtOrientation: 'standard' | 'flipped'
}

export interface BasketballLateParticipantOptions {
  recorderUserId: string | null
  teamSide: BasketballTeamSide
  displayName: string
  number?: string
  occurredAt?: string
  eventId?: string
  participantId?: string
  playerId?: string
  captureCommandId?: string
}

export interface BasketballLifecycleCommandOptions {
  recorderUserId: string | null
  occurredAt?: string
  eventId?: string
}

export interface BasketballReopenCommandOptions extends BasketballLifecycleCommandOptions {
  reason: string
}

export type BasketballCaptureActorSelection =
  | { kind: 'participant'; participantId: string }
  | { kind: 'team' }
  | { kind: 'unknown'; label: string }

export interface BasketballCommandContext {
  sportState: BasketballSportGameState
  period: GameEventPeriod
  nextSequence: number
  occurredAt: string
}

export type BasketballCourtStatId = 'oreb' | 'dreb' | 'stl' | 'blk' | 'ast'

export type BasketballCourtEventChoice =
  | {
      kind: 'shot'
      made: boolean
      shotType: '2pt' | '3pt'
      assistPlayerId?: string
      rebound?: { statId: 'oreb' | 'dreb'; playerId: string }
    }
  | { kind: 'stat'; statId: BasketballCourtStatId }

export interface BasketballCourtCaptureOptions {
  recorderUserId: string | null
  playerId: string
  point: BasketballCourtPoint
  event: BasketballCourtEventChoice
  occurredAt?: string
  eventIds?: string[]
  captureCommandId?: string
}

export type BasketballCourtCaptureResult =
  | { ok: true; state: GameState; eventIds: string[] }
  | {
      ok: false
      state: GameState
      code: BasketballCommandErrorCode
      message: string
    }

export interface BasketballCaptureTarget {
  teamSide: BasketballTeamSide
  selection: BasketballCaptureActorSelection
}

export function isBasketballEventSetupIntent(state: GameState): boolean {
  return state.sport?.id === 'basketball' &&
    state.gameDataAuthority === SPORT_EVENTS_AUTHORITY &&
    state.eventStream === null &&
    state.sportGameState === null
}

export function hasStartedBasketballEventGame(state: GameState): boolean {
  return state.sport?.id === 'basketball' &&
    state.gameDataAuthority === SPORT_EVENTS_AUTHORITY &&
    state.sportGameState?.sportId === 'basketball' &&
    Boolean(state.eventStream?.events.length)
}

export function setBasketballEventCreationIntent(
  state: GameState,
  enabled: boolean
): BasketballStateCommandResult {
  if (state.sport?.id !== 'basketball') {
    return failure(state, 'wrong_sport', 'Basketball must be selected before changing event mode.')
  }

  if (enabled) {
    if (state.gameDataAuthority === SPORT_EVENTS_AUTHORITY) return { ok: true, state }
    if (state.gameInfo || state.players.length > 0 || state.eventStream || state.sportGameState) {
      return failure(
        state,
        'creation_intent_unavailable',
        'Event mode can be enabled only for a new Basketball game.'
      )
    }
    if (hasExistingCloudGameBinding(state)) {
      return failure(
        state,
        'cloud_flow_unsupported',
        'An existing cloud game cannot be converted to Basketball event mode.'
      )
    }
    if (hasLegacyAggregateActivity(state)) {
      return failure(
        state,
        'legacy_activity_present',
        'Event mode cannot be enabled after aggregate tracking has begun.'
      )
    }
    return {
      ok: true,
      state: { ...state, gameDataAuthority: SPORT_EVENTS_AUTHORITY },
    }
  }

  if (state.gameDataAuthority !== SPORT_EVENTS_AUTHORITY) return { ok: true, state }
  if (state.eventStream || state.sportGameState || hasLegacyAggregateActivity(state)) {
    return failure(
      state,
      'creation_intent_unavailable',
      'Event mode cannot be disabled after event or aggregate tracking has begun.'
    )
  }
  if (hasExistingCloudGameBinding(state)) {
    return failure(
      state,
      'cloud_flow_unsupported',
      'Event mode cannot be changed after a cloud game is selected.'
    )
  }
  return { ok: true, state: { ...state, gameDataAuthority: null } }
}

export function prepareBasketballGameStart(
  state: GameState,
  options: BasketballStartOptions
): BasketballStateCommandResult {
  if (state.sport?.id !== 'basketball') {
    return failure(state, 'wrong_sport', 'Basketball game information is unavailable.')
  }
  if (state.gameDataAuthority !== SPORT_EVENTS_AUTHORITY) {
    return failure(
      state,
      'event_authority_required',
      'This Basketball game was not created for the event model.'
    )
  }
  if (hasExistingCloudGameBinding(state)) {
    return failure(
      state,
      'cloud_flow_unsupported',
      'An existing cloud game cannot be converted to Basketball event mode.'
    )
  }
  if (state.eventStream || state.sportGameState) {
    return failure(state, 'already_initialized', 'This Basketball event game has already started.')
  }

  const setupResult = buildBasketballMatchSetup(
    state,
    options.participantIds,
    options.reviewedSetup
  )
  if (!setupResult.ok) return { ...setupResult, state }

  let configuredState: GameState
  try {
    const sportGameState = createBasketballSportGameState(setupResult.value)
    const courtOrientation = options.reviewedSetup?.courtOrientation ??
      state.basketballCourtOrientation ?? 'standard'
    sportGameState.capturePreferences.courtOrientation = courtOrientation
    configuredState = {
      ...state,
      basketballCourtOrientation: courtOrientation,
      sportGameState,
    }
  } catch (error) {
    return failure(
      state,
      'invalid_setup',
      error instanceof Error ? error.message : 'Basketball setup could not be initialized.'
    )
  }

  const initialized = initializeGameEventStream(
    configuredState,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!initialized.ok) {
    return failure(state, mutationErrorCode(initialized.error.code), initialized.error.message)
  }

  const firstPeriod = setupResult.value.rulesSnapshot.regulationSegments[0]
  if (!firstPeriod || firstPeriod.order !== 1) {
    return failure(state, 'invalid_period', 'Basketball setup requires a first regulation period.')
  }
  const occurredAtResult = normalizeBasketballCommandTimestamp(options.occurredAt)
  if (!occurredAtResult.ok) return { ...occurredAtResult, state }

  const appended = addGameEvent(
    initialized.state,
    createBasketballLifecycleEvent({
      id: options.eventId,
      eventType: 'basketball.period_started',
      payload: { periodId: firstPeriod.id, captureCommandId: null },
      recorderUserId: options.recorderUserId,
      sequence: nextBasketballEventSequence(
        initialized.state.eventStream?.events ?? [],
        options.recorderUserId
      ),
      period: { id: firstPeriod.id, order: firstPeriod.order },
      occurredAt: occurredAtResult.value,
    }),
    gameEventRegistry,
    gameEventProjectors
  )
  if (!appended.ok || !appended.inspection.complete) {
    return failure(
      state,
      'command_failed',
      appended.ok
        ? 'Basketball start did not produce a complete event projection.'
        : appended.error.message
    )
  }
  return { ok: true, state: appended.state }
}

export function buildBasketballMatchSetup(
  state: GameState,
  participantIds?: string[],
  reviewedSetup?: BasketballReviewedStartSetup
): BasketballCommandResult<BasketballMatchSetup> {
  if (state.sport?.id !== 'basketball' || !state.gameInfo) {
    return commandFailure('setup_incomplete', 'Complete Basketball game setup before starting.')
  }

  const roster = state.players.filter(player => !isTeamPseudoPlayer(player))
  if (roster.length === 0) {
    return commandFailure('setup_incomplete', 'Add at least one Basketball player before starting.')
  }
  if (participantIds && participantIds.length !== roster.length) {
    return commandFailure('invalid_setup', 'Participant ids must match the confirmed roster.')
  }

  const resolvedRules = reviewedSetup
    ? null
    : resolveTeamStatsConfig(state.sport, state.teamStatsConfig)
  if (!reviewedSetup && !resolvedRules) {
    return commandFailure('invalid_setup', 'Basketball team-stat rules are unavailable.')
  }
  const sourceTeamId = reviewedSetup?.sourceTeamId ?? state.cloudSync.teamId
  const sourceSeasonId = reviewedSetup?.sourceSeasonId ??
    (state.cloudSync.teamId ? state.cloudSync.seasonId : null)
  if (sourceTeamId && !sourceSeasonId) {
    return commandFailure('invalid_setup', 'Cloud team Basketball games require a source season.')
  }
  const participants: BasketballMatchParticipant[] = roster.map((player, index) => ({
    id: participantIds?.[index] ?? createBasketballUuid(),
    playerId: player.id,
    displayName: player.name.trim(),
    number: player.number.trim() || null,
    teamSide: 'tracked',
    initialStatus: 'bench',
    position: null,
    captain: false,
  }))
  let setup: BasketballMatchSetup
  try {
    setup = {
      version: 1,
      trackedTeamDesignation: 'home',
      sourceTeamId,
      sourceSeasonId: sourceTeamId ? sourceSeasonId : null,
      rulesSource: reviewedSetup
        ? normalizeBasketballRulesSource(reviewedSetup.rulesSource)!
        : structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
      rulesSnapshot: reviewedSetup
        ? normalizeBasketballMatchRules(reviewedSetup.rulesSnapshot)!
        : createBasketballMatchRules(resolvedRules!),
      participants,
    }
  } catch (error) {
    return commandFailure(
      'invalid_setup',
      error instanceof Error ? error.message : 'Basketball rules could not be resolved.'
    )
  }
  const setupError = validateBasketballMatchSetup(setup)
  return setupError
    ? commandFailure('invalid_setup', setupError)
    : { ok: true, value: setup }
}

export function setBasketballCourtOrientation(
  state: GameState,
  orientation: 'standard' | 'flipped'
): BasketballStateCommandResult {
  if (state.sport?.id !== 'basketball') {
    return failure(state, 'wrong_sport', 'Basketball game information is unavailable.')
  }
  if (state.sportGameState?.sportId !== 'basketball') {
    return { ok: true, state: { ...state, basketballCourtOrientation: orientation } }
  }
  return {
    ok: true,
    state: {
      ...state,
      basketballCourtOrientation: orientation,
      sportGameState: {
        ...state.sportGameState,
        capturePreferences: {
          ...state.sportGameState.capturePreferences,
          courtOrientation: orientation,
        },
      },
    },
  }
}

export function getBasketballCommandContext(
  state: GameState,
  recorderUserId: string | null,
  occurredAt?: string
): BasketballCommandResult<BasketballCommandContext> {
  if (
    state.sport?.id !== 'basketball' ||
    state.gameDataAuthority !== SPORT_EVENTS_AUTHORITY ||
    !state.eventStream ||
    state.sportGameState?.sportId !== 'basketball'
  ) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const projection = state.sportGameState.projection
  if (projection.status !== 'in_progress' || !projection.currentPeriodId) {
    return commandFailure('invalid_period', 'Basketball capture requires an active period.')
  }
  const segment = projection.periods.find(period => period.id === projection.currentPeriodId)
  if (!segment) return commandFailure('invalid_period', 'The active Basketball period is invalid.')
  const timestamp = normalizeBasketballCommandTimestamp(occurredAt)
  if (!timestamp.ok) return timestamp
  return {
    ok: true,
    value: {
      sportState: state.sportGameState,
      period: { id: segment.id, order: segment.order },
      nextSequence: nextBasketballEventSequence(state.eventStream.events, recorderUserId),
      occurredAt: timestamp.value,
    },
  }
}

export function basketballCaptureTargetForPlayerId(
  state: GameState,
  playerId: string
): BasketballCommandResult<BasketballCaptureTarget> {
  if (playerId === TEAM_PLAYER_HOME_ID) {
    return { ok: true, value: { teamSide: 'tracked', selection: { kind: 'team' } } }
  }
  if (playerId === TEAM_PLAYER_OPP_ID) {
    return { ok: true, value: { teamSide: 'opponent', selection: { kind: 'team' } } }
  }
  const participant = state.sportGameState?.sportId === 'basketball'
    ? Object.values(state.sportGameState.projection.participants)
        .find(value => value.playerId === playerId)
    : null
  if (!participant) {
    return commandFailure('invalid_actor', 'The selected Basketball player is unavailable.')
  }
  return {
    ok: true,
    value: {
      teamSide: participant.teamSide,
      selection: { kind: 'participant', participantId: participant.participantId },
    },
  }
}

export function basketballPlayerIdForCapturePreferences(state: GameState): string | null {
  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  if (!sportState?.capturePreferences.selectionInitialized) return null
  const participantId = sportState.capturePreferences.selectedParticipantId
  if (!participantId) {
    return sportState.capturePreferences.teamSide === 'tracked'
      ? TEAM_PLAYER_HOME_ID
      : TEAM_PLAYER_OPP_ID
  }
  const participant = sportState.projection.participants[participantId]
  return participant?.playerId ?? null
}

export function addBasketballLateParticipant(
  state: GameState,
  options: BasketballLateParticipantOptions
): BasketballStateCommandResult {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballLifecycleContext(
    state,
    options.recorderUserId,
    options.occurredAt
  )
  if (!context.ok) return { ...context, state }

  const displayName = options.displayName.trim()
  if (!displayName) {
    return failure(state, 'invalid_participant', 'Enter a name for the Basketball participant.')
  }
  const number = options.number?.trim() || null
  const playerId = options.playerId ?? createBasketballUuid()
  const participantId = options.participantId ?? createBasketballUuid()
  if (state.players.some(player => player.id === playerId)) {
    return failure(state, 'invalid_participant', 'That Basketball player id is already in use.')
  }

  const player: Player = { id: playerId, name: displayName, number: number ?? '', stats: {} }
  const participant: BasketballMatchParticipant = {
    id: participantId,
    playerId,
    displayName,
    number,
    teamSide: options.teamSide,
    initialStatus: 'bench',
    position: null,
    captain: false,
  }
  const candidate = withBasketballCapturePreferences(
    { ...state, players: [...state.players, player], activePlayerId: playerId },
    options.teamSide,
    participantId
  )
  const event = createBasketballLifecycleEvent({
    id: options.eventId,
    eventType: 'basketball.match_roster_added',
    payload: {
      participant,
      destination: 'bench',
      captureCommandId: options.captureCommandId ?? createBasketballCaptureCommandId(),
    },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: context.value.period,
    occurredAt: context.value.occurredAt,
  })
  return appendBasketballLifecycleEvent(
    state,
    candidate,
    event,
    'Basketball participant addition did not produce a complete event projection.'
  )
}

export function endBasketballPeriod(
  state: GameState,
  options: BasketballLifecycleCommandOptions
): BasketballStateCommandResult {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballLifecycleContext(
    state,
    options.recorderUserId,
    options.occurredAt
  )
  if (!context.ok) return { ...context, state }
  if (context.value.sportState.projection.status !== 'in_progress') {
    return failure(state, 'invalid_period', 'Only an active Basketball period can end.')
  }
  const event = createBasketballLifecycleEvent({
    id: options.eventId,
    eventType: 'basketball.period_ended',
    payload: { periodId: context.value.period.id, captureCommandId: null },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: context.value.period,
    occurredAt: context.value.occurredAt,
  })
  return appendBasketballLifecycleEvent(
    state,
    clearBasketballUndoReceipt(state),
    event,
    'Basketball period end did not produce a complete event projection.'
  )
}

export function startNextBasketballPeriod(
  state: GameState,
  options: BasketballLifecycleCommandOptions
): BasketballStateCommandResult {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballLifecycleContext(
    state,
    options.recorderUserId,
    options.occurredAt
  )
  if (!context.ok) return { ...context, state }
  const sportState = context.value.sportState
  if (sportState.projection.status !== 'period_break') {
    return failure(state, 'invalid_period', 'End the active Basketball period before starting another.')
  }
  const nextSegment = nextBasketballSegment(sportState)
  if (!nextSegment.ok) return { ...nextSegment, state }
  const event = createBasketballLifecycleEvent({
    id: options.eventId,
    eventType: 'basketball.period_started',
    payload: { periodId: nextSegment.value.id, captureCommandId: null },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: { id: nextSegment.value.id, order: nextSegment.value.order },
    occurredAt: context.value.occurredAt,
  })
  return appendBasketballLifecycleEvent(
    state,
    clearBasketballUndoReceipt(state),
    event,
    'Basketball period start did not produce a complete event projection.'
  )
}

export function completeBasketballMatch(
  state: GameState,
  options: BasketballLifecycleCommandOptions
): BasketballStateCommandResult {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballLifecycleContext(
    state,
    options.recorderUserId,
    options.occurredAt
  )
  if (!context.ok) return { ...context, state }
  const sportState = context.value.sportState
  const projection = sportState.projection
  if (projection.status !== 'period_break') {
    return failure(state, 'invalid_period', 'End the active Basketball period before ending the game.')
  }
  const regulationComplete = sportState.setup.rulesSnapshot.regulationSegments.every(segment =>
    projection.completedPeriodIds.includes(segment.id)
  )
  if (!regulationComplete) {
    return failure(state, 'invalid_period', 'Complete every Basketball regulation period first.')
  }
  if (projection.score.tracked === projection.score.opponent) {
    return failure(state, 'invalid_period', 'A tied Basketball game requires another overtime.')
  }
  const event = createBasketballLifecycleEvent({
    id: options.eventId,
    eventType: 'basketball.match_ended',
    payload: { reason: 'completed', captureCommandId: null },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: context.value.period,
    occurredAt: context.value.occurredAt,
  })
  return appendBasketballLifecycleEvent(
    state,
    clearBasketballUndoReceipt(state),
    event,
    'Basketball completion did not produce a complete event projection.'
  )
}

export function suspendBasketballMatch(
  state: GameState,
  options: BasketballLifecycleCommandOptions
): BasketballStateCommandResult {
  return endBasketballMatchLocally(state, options, 'suspended')
}

export function abandonBasketballMatch(
  state: GameState,
  options: BasketballLifecycleCommandOptions
): BasketballStateCommandResult {
  return endBasketballMatchLocally(state, options, 'abandoned')
}

export function reopenBasketballMatch(
  state: GameState,
  options: BasketballReopenCommandOptions
): BasketballStateCommandResult {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const reason = options.reason.trim()
  if (!reason) {
    return failure(state, 'command_failed', 'Enter a reason for reopening the Basketball game.')
  }
  if (reason.length > 240) {
    return failure(state, 'command_failed', 'Basketball reopen reasons cannot exceed 240 characters.')
  }
  const context = getBasketballTerminalLifecycleContext(
    state,
    options.recorderUserId,
    options.occurredAt
  )
  if (!context.ok) return { ...context, state }
  const event = createBasketballLifecycleEvent({
    id: options.eventId,
    eventType: 'basketball.match_reopened',
    payload: { reason, captureCommandId: null },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: context.value.period,
    occurredAt: context.value.occurredAt,
  })
  return appendBasketballLifecycleEvent(
    state,
    clearBasketballUndoReceipt(state),
    event,
    'Basketball reopen did not produce a complete event projection.'
  )
}

export function captureBasketballCourtEvent(
  state: GameState,
  options: BasketballCourtCaptureOptions
): BasketballCourtCaptureResult {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const contextResult = getBasketballCommandContext(
    state,
    options.recorderUserId,
    options.occurredAt
  )
  if (!contextResult.ok) return { ...contextResult, state }
  const targetResult = basketballCaptureTargetForPlayerId(state, options.playerId)
  if (!targetResult.ok) return { ...targetResult, state }

  const { nextSequence, occurredAt, period } = contextResult.value
  const target = targetResult.value
  const eventIds = options.eventIds ?? []
  const captureState: GameState = state.sportGameState?.sportId === 'basketball'
    ? {
        ...state,
        sportGameState: {
          ...state.sportGameState,
          capturePreferences: {
            ...state.sportGameState.capturePreferences,
            teamSide: target.teamSide,
            selectedParticipantId: target.selection.kind === 'participant'
              ? target.selection.participantId
              : null,
            selectionInitialized: true,
            shotValueOverride: null,
            lastCourtUndo: null,
          },
        },
      }
    : state

  if (options.event.kind === 'stat') {
    const descriptor = standaloneStatDescriptor(options.event.statId)
    const actor = basketballActorForSelection(
      state,
      descriptor.role,
      target.teamSide,
      target.selection
    )
    if (!actor.ok) return { ...actor, state }
    const id = eventIds[0] ?? createBasketballUuid()
    const event = createStandaloneBasketballStatEvent(options.event.statId, {
      id,
      recorderUserId: options.recorderUserId,
      sequence: nextSequence,
      period,
      occurredAt,
      teamSide: target.teamSide,
      actors: [actor.value],
    })
    const appended = addGameEvent(captureState, event, gameEventRegistry, gameEventProjectors)
    return appended.ok && appended.inspection.complete
      ? { ok: true, state: appended.state, eventIds: [id] }
      : failure(
          state,
          'command_failed',
          appended.ok
            ? 'Basketball capture did not produce a complete event projection.'
            : appended.error.message
        )
  }

  const location = normalizeBasketballCourtLocation(options.point)
  if (!location.ok) return { ...location, state }
  const shooter = basketballActorForSelection(
    state,
    'shooter',
    target.teamSide,
    target.selection
  )
  if (!shooter.ok) return { ...shooter, state }

  const relatedPlayerId = options.event.assistPlayerId ?? options.event.rebound?.playerId
  if (options.event.assistPlayerId && options.event.rebound) {
    return failure(state, 'command_failed', 'A court shot cannot include both an assist and a rebound.')
  }
  if (options.event.assistPlayerId && !options.event.made) {
    return failure(state, 'command_failed', 'Only a made shot can include an assist.')
  }
  if (options.event.assistPlayerId === options.playerId) {
    return failure(state, 'invalid_actor', 'A shooter cannot be credited with the same shot assist.')
  }
  if (options.event.rebound && options.event.made) {
    return failure(state, 'command_failed', 'Only a missed shot can include a rebound.')
  }
  const relatedTarget = relatedPlayerId
    ? basketballCaptureTargetForPlayerId(state, relatedPlayerId)
    : null
  if (relatedTarget && !relatedTarget.ok) return { ...relatedTarget, state }
  if (options.event.assistPlayerId && relatedTarget?.value.teamSide !== target.teamSide) {
    return failure(state, 'invalid_actor', 'An assist must be credited to the shooting team.')
  }
  if (
    options.event.rebound &&
    relatedTarget?.ok &&
    ((options.event.rebound.statId === 'oreb' && relatedTarget.value.teamSide !== target.teamSide) ||
      (options.event.rebound.statId === 'dreb' && relatedTarget.value.teamSide === target.teamSide))
  ) {
    return failure(state, 'invalid_actor', 'The rebound side does not match the missed shot.')
  }

  const hasRelatedEvent = Boolean(options.event.assistPlayerId || options.event.rebound)
  const captureCommandId = hasRelatedEvent
    ? options.captureCommandId ?? createBasketballCaptureCommandId()
    : null
  const shotId = eventIds[0] ?? createBasketballUuid()
  const detectedValue = isThreePointer(options.point.x, options.point.y) ? 3 : 2
  const selectedValue = options.event.shotType === '3pt' ? 3 : 2
  const events: BasketballMatchEvent[] = [createBasketballStatEvent({
    id: shotId,
    eventType: 'basketball.shot',
    payload: {
      value: selectedValue,
      made: options.event.made,
      attempt: 'field_goal',
      valueSource: selectedValue === detectedValue ? 'court' : 'manual_override',
      freeThrowTripId: null,
      tripAttemptNumber: null,
      captureCommandId,
    },
    recorderUserId: options.recorderUserId,
    sequence: nextSequence,
    period,
    occurredAt,
    teamSide: target.teamSide,
    location: location.value,
    actors: [shooter.value],
  })]

  if (options.event.assistPlayerId && relatedTarget?.ok) {
    const assister = basketballActorForSelection(
      state,
      'assister',
      relatedTarget.value.teamSide,
      relatedTarget.value.selection
    )
    if (!assister.ok) return { ...assister, state }
    events.push(createBasketballStatEvent({
      id: eventIds[1] ?? createBasketballUuid(),
      eventType: 'basketball.assist',
      payload: { relatedEventId: shotId, captureCommandId },
      recorderUserId: options.recorderUserId,
      sequence: nextSequence + 1,
      period,
      occurredAt,
      teamSide: relatedTarget.value.teamSide,
      actors: [assister.value],
    }))
  } else if (options.event.rebound && relatedTarget?.ok) {
    const rebounder = basketballActorForSelection(
      state,
      'rebounder',
      relatedTarget.value.teamSide,
      relatedTarget.value.selection
    )
    if (!rebounder.ok) return { ...rebounder, state }
    events.push(createBasketballStatEvent({
      id: eventIds[1] ?? createBasketballUuid(),
      eventType: 'basketball.rebound',
      payload: {
        kind: options.event.rebound.statId === 'oreb' ? 'offensive' : 'defensive',
        relatedEventId: shotId,
        captureCommandId,
      },
      recorderUserId: options.recorderUserId,
      sequence: nextSequence + 1,
      period,
      occurredAt,
      teamSide: relatedTarget.value.teamSide,
      actors: [rebounder.value],
    }))
  }

  const appended = events.length === 1
    ? addGameEvent(captureState, events[0], gameEventRegistry, gameEventProjectors)
    : addGameEvents(captureState, events, gameEventRegistry, gameEventProjectors)
  return appended.ok && appended.inspection.complete
    ? { ok: true, state: appended.state, eventIds: events.map(event => event.id) }
    : failure(
        state,
        'command_failed',
        appended.ok
          ? 'Basketball capture did not produce a complete event projection.'
          : appended.error.message
      )
}

export function nextBasketballEventSequence(
  events: unknown[],
  recorderUserId: string | null
): number {
  return events.reduce<number>((highest, value) => {
    if (!isPlainObject(value) || value.recorderUserId !== recorderUserId) return highest
    return typeof value.sequence === 'number' && Number.isInteger(value.sequence)
      ? Math.max(highest, value.sequence)
      : highest
  }, 0) + 1
}

function getBasketballLifecycleContext(
  state: GameState,
  recorderUserId: string | null,
  occurredAt?: string
): BasketballCommandResult<BasketballCommandContext> {
  if (
    state.sport?.id !== 'basketball' ||
    state.gameDataAuthority !== SPORT_EVENTS_AUTHORITY ||
    !state.eventStream ||
    state.sportGameState?.sportId !== 'basketball'
  ) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const projection = state.sportGameState.projection
  if (
    projection.status === 'not_started' ||
    projection.status === 'ended' ||
    projection.status === 'suspended' ||
    !projection.currentPeriodId
  ) {
    return commandFailure('invalid_period', 'Basketball lifecycle requires an open match period.')
  }
  const segment = projection.periods.find(period => period.id === projection.currentPeriodId)
  if (!segment) return commandFailure('invalid_period', 'The current Basketball period is invalid.')
  const timestamp = normalizeBasketballCommandTimestamp(occurredAt)
  if (!timestamp.ok) return timestamp
  return {
    ok: true,
    value: {
      sportState: state.sportGameState,
      period: { id: segment.id, order: segment.order },
      nextSequence: nextBasketballEventSequence(state.eventStream.events, recorderUserId),
      occurredAt: timestamp.value,
    },
  }
}

function getBasketballTerminalLifecycleContext(
  state: GameState,
  recorderUserId: string | null,
  occurredAt?: string
): BasketballCommandResult<BasketballCommandContext> {
  if (
    state.sport?.id !== 'basketball' ||
    state.gameDataAuthority !== SPORT_EVENTS_AUTHORITY ||
    !state.eventStream ||
    state.sportGameState?.sportId !== 'basketball'
  ) {
    return commandFailure('setup_incomplete', 'An initialized Basketball event game is required.')
  }
  const projection = state.sportGameState.projection
  if (
    (projection.status !== 'ended' && projection.status !== 'suspended') ||
    !projection.currentPeriodId
  ) {
    return commandFailure('invalid_period', 'Only a suspended or ended Basketball game can reopen.')
  }
  const segment = projection.periods.find(period => period.id === projection.currentPeriodId)
  if (!segment) return commandFailure('invalid_period', 'The current Basketball period is invalid.')
  const timestamp = normalizeBasketballCommandTimestamp(occurredAt)
  if (!timestamp.ok) return timestamp
  return {
    ok: true,
    value: {
      sportState: state.sportGameState,
      period: { id: segment.id, order: segment.order },
      nextSequence: nextBasketballEventSequence(state.eventStream.events, recorderUserId),
      occurredAt: timestamp.value,
    },
  }
}

function endBasketballMatchLocally(
  state: GameState,
  options: BasketballLifecycleCommandOptions,
  reason: 'suspended' | 'abandoned'
): BasketballStateCommandResult {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballLifecycleContext(
    state,
    options.recorderUserId,
    options.occurredAt
  )
  if (!context.ok) return { ...context, state }
  const event = createBasketballLifecycleEvent({
    id: options.eventId,
    eventType: 'basketball.match_ended',
    payload: { reason, captureCommandId: null },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: context.value.period,
    occurredAt: context.value.occurredAt,
  })
  return appendBasketballLifecycleEvent(
    state,
    clearBasketballUndoReceipt(state),
    event,
    reason === 'suspended'
      ? 'Basketball suspension did not produce a complete event projection.'
      : 'Basketball abandonment did not produce a complete event projection.'
  )
}

function nextBasketballSegment(
  sportState: BasketballSportGameState
): BasketballCommandResult<BasketballMatchSegment> {
  const projection = sportState.projection
  const current = projection.periods.find(period => period.id === projection.currentPeriodId)
  if (!current) return commandFailure('invalid_period', 'The current Basketball period is invalid.')
  const rules = sportState.setup.rulesSnapshot
  if (current.order < rules.regulationSegments.length) {
    const regulation = rules.regulationSegments.find(segment => segment.order === current.order + 1)
    return regulation
      ? { ok: true, value: structuredClone(regulation) }
      : commandFailure('invalid_period', 'The next Basketball regulation period is unavailable.')
  }
  if (projection.score.tracked !== projection.score.opponent) {
    return commandFailure('invalid_period', 'Overtime is available only while the score is tied.')
  }
  const overtimeNumber = current.order - rules.regulationSegments.length + 1
  const overtimeId = `${rules.overtimeTemplate.idPrefix}-${overtimeNumber}`
  const overtime = resolveBasketballPeriodSegment(rules, overtimeId)
  return overtime
    ? { ok: true, value: overtime }
    : commandFailure('invalid_period', 'The next Basketball overtime is unavailable.')
}

function appendBasketballLifecycleEvent(
  originalState: GameState,
  candidateState: GameState,
  event: BasketballMatchEvent,
  incompleteMessage: string
): BasketballStateCommandResult {
  const appended = addGameEvent(candidateState, event, gameEventRegistry, gameEventProjectors)
  if (!appended.ok || !appended.inspection.complete) {
    return failure(
      originalState,
      'command_failed',
      appended.ok ? incompleteMessage : appended.error.message
    )
  }
  return { ok: true, state: appended.state }
}

function clearBasketballUndoReceipt(state: GameState): GameState {
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

function withBasketballCapturePreferences(
  state: GameState,
  teamSide: BasketballTeamSide,
  participantId: string
): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
  return {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      capturePreferences: {
        ...state.sportGameState.capturePreferences,
        teamSide,
        selectedParticipantId: participantId,
        selectionInitialized: true,
        lastCourtUndo: null,
      },
    },
  }
}

export function createBasketballCaptureCommandId(): string {
  return createBasketballUuid()
}

export function basketballActorForSelection(
  state: GameState,
  role: string,
  teamSide: BasketballTeamSide,
  selection: BasketballCaptureActorSelection,
  options: { allowUnavailable?: boolean } = {}
): BasketballCommandResult<GameEventActor> {
  if (!role.trim()) return commandFailure('invalid_actor', 'Basketball actor role is required.')
  if (selection.kind === 'participant') {
    const participant = state.sportGameState?.sportId === 'basketball'
      ? state.sportGameState.projection.participants[selection.participantId]
      : null
    if (!participant || participant.teamSide !== teamSide) {
      return commandFailure('invalid_actor', 'The selected Basketball participant is unavailable.')
    }
    if (!options.allowUnavailable && (participant.disqualified || participant.ejected)) {
      return commandFailure(
        'invalid_actor',
        participant.ejected
          ? 'The selected Basketball participant has been ejected.'
          : 'The selected Basketball participant is disqualified.'
      )
    }
    return participant.playerId
      ? {
          ok: true,
          value: {
            role,
            kind: 'player',
            participantId: participant.participantId,
            playerId: participant.playerId,
            label: participant.displayName,
          },
        }
      : {
          ok: true,
          value: {
            role,
            kind: 'unknown',
            participantId: participant.participantId,
            label: participant.displayName,
          },
        }
  }

  const label = selection.kind === 'team'
    ? teamSide === 'tracked'
      ? state.gameInfo?.teamName.trim()
      : state.gameInfo?.opponentName.trim()
    : selection.label.trim()
  if (!label) return commandFailure('invalid_actor', 'Basketball actor label is required.')
  return {
    ok: true,
    value: { role, kind: selection.kind, label },
  }
}

export function normalizeBasketballCourtLocation(
  point: BasketballCourtPoint
): BasketballCommandResult<GameEventLocation> {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return commandFailure('invalid_location', 'Basketball court location must be finite.')
  }
  return {
    ok: true,
    value: {
      ...courtFeetToNormalizedLocation(point),
      attackingDirection: 'unknown',
    },
  }
}

function normalizeBasketballCommandTimestamp(
  value?: string
): BasketballCommandResult<string> {
  const timestamp = value ?? new Date().toISOString()
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    return commandFailure('invalid_timestamp', 'Basketball event timestamp is invalid.')
  }
  return { ok: true, value: timestamp }
}

function hasExistingCloudGameBinding(state: GameState): boolean {
  return Boolean(state.cloudSync.gameId || state.cloudSync.lastSyncedGameFingerprint)
}

function standaloneStatDescriptor(statId: BasketballCourtStatId) {
  switch (statId) {
    case 'oreb':
      return {
        eventType: 'basketball.rebound' as const,
        role: 'rebounder',
        payload: { kind: 'offensive' as const, relatedEventId: null, captureCommandId: null },
      }
    case 'dreb':
      return {
        eventType: 'basketball.rebound' as const,
        role: 'rebounder',
        payload: { kind: 'defensive' as const, relatedEventId: null, captureCommandId: null },
      }
    case 'stl':
      return {
        eventType: 'basketball.steal' as const,
        role: 'stealer',
        payload: { relatedEventId: null, captureCommandId: null },
      }
    case 'blk':
      return {
        eventType: 'basketball.block' as const,
        role: 'blocker',
        payload: { relatedEventId: null, captureCommandId: null },
      }
    case 'ast':
      return {
        eventType: 'basketball.assist' as const,
        role: 'assister',
        payload: { relatedEventId: null, captureCommandId: null },
      }
  }
}

interface StandaloneBasketballStatEventInput {
  id: string
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  occurredAt: string
  teamSide: BasketballTeamSide
  actors: GameEventActor[]
}

function createStandaloneBasketballStatEvent(
  statId: BasketballCourtStatId,
  input: StandaloneBasketballStatEventInput
): BasketballMatchEvent {
  const relatedPayload = { relatedEventId: null, captureCommandId: null }
  switch (statId) {
    case 'oreb':
      return createBasketballStatEvent({
        ...input,
        eventType: 'basketball.rebound',
        payload: { ...relatedPayload, kind: 'offensive' },
      })
    case 'dreb':
      return createBasketballStatEvent({
        ...input,
        eventType: 'basketball.rebound',
        payload: { ...relatedPayload, kind: 'defensive' },
      })
    case 'stl':
      return createBasketballStatEvent({ ...input, eventType: 'basketball.steal', payload: relatedPayload })
    case 'blk':
      return createBasketballStatEvent({ ...input, eventType: 'basketball.block', payload: relatedPayload })
    case 'ast':
      return createBasketballStatEvent({ ...input, eventType: 'basketball.assist', payload: relatedPayload })
  }
}

function mutationErrorCode(code: string): BasketballCommandErrorCode {
  if (code === 'legacy_activity_present') return 'legacy_activity_present'
  if (code === 'sport_setup_required') return 'invalid_setup'
  return 'command_failed'
}

function commandFailure<T = never>(
  code: BasketballCommandErrorCode,
  message: string
): BasketballCommandResult<T> & { ok: false } {
  return { ok: false, code, message }
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballStateCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}

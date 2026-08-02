import { resolveTeamStatsConfig } from '../../config/teamStatsDefaults'
import type { GameState } from '../../types'
import { SPORT_EVENTS_AUTHORITY } from '../gameEvents/authority'
import { isPlainObject } from '../gameEvents/envelope'
import {
  addGameEvent,
  hasLegacyAggregateActivity,
  initializeGameEventStream,
} from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type {
  GameEventActor,
  GameEventLocation,
  GameEventPeriod,
} from '../gameEvents/types'
import { isTeamPseudoPlayer } from '../teamPlayers'
import { courtFeetToNormalizedLocation, type BasketballCourtPoint } from './courtGeometry'
import { createBasketballLifecycleEvent } from './events'
import { createBasketballUuid } from './id'
import {
  createBasketballMatchRules,
  DEFAULT_BASKETBALL_RULES_SOURCE,
} from './rules'
import {
  createBasketballSportGameState,
  validateBasketballMatchSetup,
} from './state'
import type {
  BasketballMatchParticipant,
  BasketballMatchSetup,
  BasketballSportGameState,
  BasketballTeamSide,
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
  | 'invalid_actor'
  | 'invalid_location'
  | 'invalid_timestamp'
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

export function isBasketballEventSetupIntent(state: GameState): boolean {
  return state.sport?.id === 'basketball' &&
    state.gameDataAuthority === SPORT_EVENTS_AUTHORITY &&
    state.eventStream === null &&
    state.sportGameState === null
}

export function hasStartedBasketballEventGame(state: GameState): boolean {
  return state.sport?.id === 'basketball' &&
    state.gameDataAuthority === SPORT_EVENTS_AUTHORITY &&
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
    if (hasCloudBinding(state)) {
      return failure(
        state,
        'cloud_flow_unsupported',
        'Basketball event mode is local-only during development.'
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
  if (hasCloudBinding(state)) {
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
  if (hasCloudBinding(state)) {
    return failure(
      state,
      'cloud_flow_unsupported',
      'Basketball event games cannot start through cloud checkout yet.'
    )
  }
  if (state.eventStream || state.sportGameState) {
    return failure(state, 'already_initialized', 'This Basketball event game has already started.')
  }

  const setupResult = buildBasketballMatchSetup(state, options.participantIds)
  if (!setupResult.ok) return { ...setupResult, state }

  let configuredState: GameState
  try {
    configuredState = {
      ...state,
      sportGameState: createBasketballSportGameState(setupResult.value),
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
  participantIds?: string[]
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

  const resolvedRules = resolveTeamStatsConfig(state.sport, state.teamStatsConfig)
  if (!resolvedRules) {
    return commandFailure('invalid_setup', 'Basketball team-stat rules are unavailable.')
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
      sourceTeamId: null,
      sourceSeasonId: null,
      rulesSource: structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
      rulesSnapshot: createBasketballMatchRules(resolvedRules),
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

export function createBasketballCaptureCommandId(): string {
  return createBasketballUuid()
}

export function basketballActorForSelection(
  state: GameState,
  role: string,
  teamSide: BasketballTeamSide,
  selection: BasketballCaptureActorSelection
): BasketballCommandResult<GameEventActor> {
  if (!role.trim()) return commandFailure('invalid_actor', 'Basketball actor role is required.')
  if (selection.kind === 'participant') {
    const participant = state.sportGameState?.sportId === 'basketball'
      ? state.sportGameState.projection.participants[selection.participantId]
      : null
    if (!participant || participant.teamSide !== teamSide) {
      return commandFailure('invalid_actor', 'The selected Basketball participant is unavailable.')
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

function hasCloudBinding(state: GameState): boolean {
  return Boolean(
    state.cloudSync.teamId ||
    state.cloudSync.gameId ||
    state.cloudSync.seasonId ||
    Object.keys(state.cloudSync.playerIdMap).length > 0 ||
    state.cloudSync.lastSyncedGameFingerprint
  )
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

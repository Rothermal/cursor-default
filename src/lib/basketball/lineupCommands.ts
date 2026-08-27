import type { GameState } from '../../types'
import { addGameEvent, addGameEvents } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import { BASKETBALL_CLOCK_TEXT_MAX_LENGTH } from './clockEvents'
import {
  type BasketballCommandErrorCode,
  type BasketballStateCommandResult,
  createBasketballCaptureCommandId,
  getBasketballCommandContext,
} from './commands'
import { createBasketballUuid } from './id'
import { createBasketballLineupEvent } from './lineupEvents'
import { evaluateBasketballEqualPlayCandidate } from './lineupProjection'
import { isBasketballMatchRulesV3 } from './rules'
import type {
  BasketballRoleChange,
  BasketballSubstitutionMode,
  BasketballTeamSide,
} from './types'

interface BasketballLineupCommandOptions {
  recorderUserId: string | null
  teamSide: BasketballTeamSide
  occurredAt?: string
  eventId?: string
  captureCommandId?: string
}

export interface BasketballSubstitutionCommandOptions extends BasketballLineupCommandOptions {
  participantIds: string[]
  mode: BasketballSubstitutionMode
  reason?: string | null
}

export interface BasketballRoleChangeCommandOptions extends BasketballLineupCommandOptions {
  changes: BasketballRoleChange[]
}

export interface BasketballLineupConfirmationCommandOptions extends BasketballLineupCommandOptions {
  participantIds?: string[]
  overrideReason?: string
  overrideEventId?: string
}

export function substituteBasketballLineup(
  state: GameState,
  options: BasketballSubstitutionCommandOptions
): BasketballStateCommandResult {
  const checked = lineupCommandContext(state, options)
  if (!checked.ok) return checked
  const participantIds = canonicalParticipantIds(state, options.teamSide, options.participantIds)
  if (
    options.participantIds.length !== new Set(options.participantIds).size ||
    participantIds.length !== options.participantIds.length
  ) {
    return failure(state, 'invalid_participant', 'Basketball substitution participants are unavailable.')
  }
  const reason = options.reason?.trim() || null
  if ((options.mode !== 'balanced' && !reason) ||
      (participantIds.length < 5 && !reason) ||
      (reason && reason.length > BASKETBALL_CLOCK_TEXT_MAX_LENGTH)) {
    return failure(state, 'command_failed', 'Enter a valid reason for this Basketball substitution.')
  }
  const event = createBasketballLineupEvent({
    id: options.eventId ?? createBasketballUuid(),
    eventType: 'basketball.substitution',
    payload: {
      captureCommandId: options.captureCommandId ?? createBasketballCaptureCommandId(),
      participantIds,
      mode: options.mode,
      reason,
    },
    recorderUserId: options.recorderUserId,
    sequence: checked.context.nextSequence,
    period: checked.context.period,
    elapsedMs: checked.elapsedMs,
    occurredAt: checked.context.occurredAt,
    teamSide: options.teamSide,
  })
  return appendLineupEvents(state, [event])
}

export function changeBasketballParticipantRoles(
  state: GameState,
  options: BasketballRoleChangeCommandOptions
): BasketballStateCommandResult {
  const checked = lineupCommandContext(state, options)
  if (!checked.ok) return checked
  if (options.changes.length === 0) {
    return failure(state, 'invalid_participant', 'Select at least one Basketball role change.')
  }
  const changes = options.changes.map(change => ({
    participantId: change.participantId,
    position: change.position?.trim() || null,
    captain: change.captain,
  }))
  if (changes.some(change =>
    !projectionParticipantOnSide(state, options.teamSide, change.participantId) ||
    (change.position !== null && change.position.length > 80)
  )) return failure(state, 'invalid_participant', 'Basketball role change participant is unavailable.')

  const event = createBasketballLineupEvent({
    id: options.eventId ?? createBasketballUuid(),
    eventType: 'basketball.role_changed',
    payload: {
      captureCommandId: options.captureCommandId ?? createBasketballCaptureCommandId(),
      changes,
    },
    recorderUserId: options.recorderUserId,
    sequence: checked.context.nextSequence,
    period: checked.context.period,
    elapsedMs: checked.elapsedMs,
    occurredAt: checked.context.occurredAt,
    teamSide: options.teamSide,
  })
  return appendLineupEvents(state, [event])
}

export function confirmBasketballLineup(
  state: GameState,
  options: BasketballLineupConfirmationCommandOptions
): BasketballStateCommandResult {
  const checked = lineupCommandContext(state, options)
  if (!checked.ok) return checked
  const current = checked.side.currentParticipantIds
  const participantIds = options.participantIds
    ? canonicalParticipantIds(state, options.teamSide, options.participantIds)
    : [...current]
  if (!sameIds(participantIds, current)) {
    return failure(state, 'invalid_participant', 'Basketball confirmation must match the current lineup.')
  }
  const violations = options.teamSide === 'tracked'
    ? evaluateBasketballEqualPlayCandidate(
        checked.context.sportState.projection,
        checked.context.sportState,
        checked.context.period.id,
        participantIds
      )
    : []
  const rules = checked.context.sportState.setup.rulesSnapshot
  const enforced = isBasketballMatchRulesV3(rules) && rules.equalPlayPolicy.mode === 'enforced'
  const captureCommandId = options.captureCommandId ?? createBasketballCaptureCommandId()
  const events = []
  if (enforced && violations.length > 0) {
    const reason = options.overrideReason?.trim() ?? ''
    if (!reason || reason.length > BASKETBALL_CLOCK_TEXT_MAX_LENGTH) {
      return failure(
        state,
        'command_failed',
        'Enter a valid reason to override the enforced Basketball equal-play warning.'
      )
    }
    events.push(createBasketballLineupEvent({
      id: options.overrideEventId ?? createBasketballUuid(),
      eventType: 'basketball.equal_play_override',
      payload: {
        captureCommandId,
        boundaryPeriodId: checked.context.period.id,
        candidateParticipantIds: participantIds,
        violationCodes: violations.map(value => value.code),
        reason,
      },
      recorderUserId: options.recorderUserId,
      sequence: checked.context.nextSequence,
      period: checked.context.period,
      elapsedMs: checked.elapsedMs,
      occurredAt: checked.context.occurredAt,
      teamSide: 'tracked',
    }))
  }
  events.push(createBasketballLineupEvent({
    id: options.eventId ?? createBasketballUuid(),
    eventType: 'basketball.lineup_confirmed',
    payload: {
      captureCommandId,
      participantIds,
      boundaryPeriodId: checked.context.period.id,
    },
    recorderUserId: options.recorderUserId,
    sequence: checked.context.nextSequence + events.length,
    period: checked.context.period,
    elapsedMs: checked.elapsedMs,
    occurredAt: checked.context.occurredAt,
    teamSide: options.teamSide,
  }))
  return appendLineupEvents(state, events)
}

function lineupCommandContext(
  state: GameState,
  options: Pick<BasketballLineupCommandOptions, 'recorderUserId' | 'teamSide' | 'occurredAt'>
) {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!context.ok) return { ...context, state }
  const projection = context.value.sportState.projection
  if (!projection.clock || !projection.lineup) {
    return failure(state, 'command_failed', 'This Basketball game does not use anchored lineups.')
  }
  if (projection.clock.running) {
    return failure(state, 'command_failed', 'Pause the Basketball clock before changing the lineup.')
  }
  const side = projection.lineup.sides[options.teamSide]
  if (!side) return failure(state, 'command_failed', 'Basketball lineup authority is unavailable for this side.')
  return { ok: true as const, context: context.value, side, elapsedMs: projection.clock.elapsedMs }
}

function appendLineupEvents(
  state: GameState,
  events: Parameters<typeof addGameEvents>[1]
): BasketballStateCommandResult {
  const appended = events.length === 1
    ? addGameEvent(state, events[0], gameEventRegistry, gameEventProjectors)
    : addGameEvents(state, events, gameEventRegistry, gameEventProjectors)
  if (!appended.ok || !appended.inspection.complete) {
    return failure(
      state,
      'command_failed',
      appended.ok
        ? 'Basketball lineup command did not produce a complete event projection.'
        : appended.error.message
    )
  }
  return { ok: true, state: appended.state }
}

function canonicalParticipantIds(
  state: GameState,
  teamSide: BasketballTeamSide,
  participantIds: readonly string[]
): string[] {
  if (state.sportGameState?.sportId !== 'basketball') return []
  const requested = new Set(participantIds)
  return Object.values(state.sportGameState.projection.participants)
    .filter(value => value.teamSide === teamSide && requested.has(value.participantId))
    .map(value => value.participantId)
}

function projectionParticipantOnSide(
  state: GameState,
  teamSide: BasketballTeamSide,
  participantId: string
): boolean {
  if (state.sportGameState?.sportId !== 'basketball') return false
  return state.sportGameState.projection.participants[participantId]?.teamSide === teamSide
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballStateCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}

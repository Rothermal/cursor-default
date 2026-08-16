import type { GameState } from '../../types'
import { addGameEvent, applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import { basketballTimeoutCap } from './rules'
import {
  basketballActorForSelection,
  getBasketballCommandContext,
  type BasketballCommandErrorCode,
  type BasketballCommandResult,
  type BasketballStateCommandResult,
} from './commands'
import type {
  BasketballCourtUndoReceipt,
  BasketballMatchEvent,
  BasketballTeamSide,
  BasketballTimeoutEvent,
  BasketballTimeoutKind,
} from './types'

export type BasketballChargedTimeoutKind = Extract<BasketballTimeoutKind, 'full' | 'thirty_second'>
export type BasketballNeutralTimeoutKind = Extract<BasketballTimeoutKind, 'media' | 'official'>

export type BasketballTimeoutCapture =
  | { mode: 'charged'; teamSide: BasketballTeamSide; kind: BasketballChargedTimeoutKind }
  | { mode: 'neutral'; kind: BasketballNeutralTimeoutKind }

export interface BasketballTimeoutCaptureOptions {
  recorderUserId: string | null
  timeout: BasketballTimeoutCapture
  occurredAt?: string
  eventId?: string
}

export type BasketballTimeoutDecrementTarget =
  | { mode: 'charged'; teamSide: BasketballTeamSide }
  | { mode: 'neutral'; kind: BasketballNeutralTimeoutKind }

export interface BasketballTimeoutSideInventory {
  used: number
  cap: number | null
  remaining: number | null
  exhausted: boolean
}

export interface BasketballTimeoutInventory {
  periodId: string
  periodLabel: string
  tracked: BasketballTimeoutSideInventory
  opponent: BasketballTimeoutSideInventory
  neutralMedia: number
  neutralOfficial: number
}

export interface BasketballTimeoutRemovalPreview {
  eventId: string
  label: string
  ownerLabel: string
  periodLabel: string
  target: BasketballTimeoutDecrementTarget
  chargedRemainingAfter: number | null
  requiresConfirmation: true
}

export type BasketballTimeoutCaptureResult =
  | { ok: true; state: GameState; eventId: string }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string }

const TIMEOUT_LABELS: Record<BasketballTimeoutKind, string> = {
  full: 'Full timeout',
  thirty_second: '30-second timeout',
  media: 'Media timeout',
  official: 'Official timeout',
}

export function captureBasketballTimeout(
  state: GameState,
  options: BasketballTimeoutCaptureOptions
): BasketballTimeoutCaptureResult {
  if (isFinalCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!context.ok) return failure(state, context.code, context.message)

  const capture = options.timeout
  let teamSide: BasketballTeamSide | 'neutral'
  let chargedSide: BasketballTeamSide | null
  let actors: GameEventActor[]
  if (capture.mode === 'charged') {
    const inventory = basketballTimeoutInventory(state)
    if (!inventory) return failure(state, 'invalid_period', 'Basketball timeout inventory is unavailable.')
    const sideInventory = inventory[capture.teamSide]
    if (sideInventory.exhausted) {
      return failure(state, 'command_failed', 'That team has no charged timeouts remaining in this period.')
    }
    const teamActor = basketballActorForSelection(
      state,
      'team',
      capture.teamSide,
      { kind: 'team' }
    )
    if (!teamActor.ok) return failure(state, teamActor.code, teamActor.message)
    teamSide = capture.teamSide
    chargedSide = capture.teamSide
    actors = [teamActor.value]
  } else {
    teamSide = 'neutral'
    chargedSide = null
    actors = []
  }

  const event = createBasketballAdministrativeEvent({
    id: options.eventId,
    eventType: 'basketball.timeout',
    payload: {
      kind: capture.kind,
      chargedSide,
      label: TIMEOUT_LABELS[capture.kind],
      captureCommandId: null,
    },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: context.value.period,
    occurredAt: context.value.occurredAt,
    teamSide,
    actors,
  })
  const appended = addGameEvent(
    clearUndoReceipt(state),
    event,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!appended.ok || !appended.inspection.complete) {
    return failure(
      state,
      'command_failed',
      appended.ok
        ? 'Basketball timeout capture did not produce a complete event projection.'
        : appended.error.message
    )
  }
  return { ok: true, state: appended.state, eventId: event.id }
}

export function basketballTimeoutInventory(state: GameState): BasketballTimeoutInventory | null {
  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  if (!sportState || sportState.projection.status !== 'in_progress') return null
  const periodId = sportState.projection.currentPeriodId
  const segment = periodId
    ? sportState.projection.periods.find(candidate => candidate.id === periodId)
    : null
  if (!periodId || !segment) return null
  const cap = basketballTimeoutCap(sportState.setup.rulesSnapshot, segment.kind)
  const counts = sportState.projection.periodTimeouts[periodId] ?? { tracked: 0, opponent: 0 }
  const activePeriodTimeouts = activeBasketballEvents(state).filter(
    (event): event is BasketballTimeoutEvent =>
      event.eventType === 'basketball.timeout' && event.period.id === periodId
  )
  return {
    periodId,
    periodLabel: segment.label,
    tracked: sideInventory(counts.tracked, cap),
    opponent: sideInventory(counts.opponent, cap),
    neutralMedia: activePeriodTimeouts.filter(event =>
      event.teamSide === 'neutral' && event.payload.kind === 'media'
    ).length,
    neutralOfficial: activePeriodTimeouts.filter(event =>
      event.teamSide === 'neutral' && event.payload.kind === 'official'
    ).length,
  }
}

export function previewBasketballTimeoutDecrement(
  state: GameState,
  target: BasketballTimeoutDecrementTarget
): BasketballCommandResult<BasketballTimeoutRemovalPreview> {
  if (isFinalCloudGame(state)) {
    return commandFailure('cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const event = newestMatchingTimeout(state, target)
  const inventory = basketballTimeoutInventory(state)
  if (!event || !inventory) {
    return commandFailure('nothing_to_undo', 'There is no matching current-period Basketball timeout to remove.')
  }
  const ownerLabel = event.teamSide === 'neutral'
    ? 'Game administration'
    : event.teamSide === 'tracked'
      ? state.gameInfo?.teamName || 'Tracked team'
      : state.gameInfo?.opponentName || 'Opponent'
  const chargedRemainingAfter = target.mode === 'charged'
    ? inventory[target.teamSide].cap === null
      ? null
      : inventory[target.teamSide].remaining! + 1
    : null
  return {
    ok: true,
    value: {
      eventId: event.id,
      label: event.payload.label?.trim() || TIMEOUT_LABELS[event.payload.kind],
      ownerLabel,
      periodLabel: inventory.periodLabel,
      target,
      chargedRemainingAfter,
      requiresConfirmation: true,
    },
  }
}

export function removeBasketballTimeout(
  state: GameState,
  target: BasketballTimeoutDecrementTarget,
  now = new Date().toISOString()
): BasketballStateCommandResult {
  if (isFinalCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  if (!now || !Number.isFinite(Date.parse(now))) {
    return failure(state, 'invalid_timestamp', 'Basketball correction timestamp is invalid.')
  }
  const event = newestMatchingTimeout(state, target)
  if (!event) {
    return failure(state, 'nothing_to_undo', 'There is no matching current-period Basketball timeout to remove.')
  }
  const receipt: BasketballCourtUndoReceipt = {
    kind: 'administrative_decrement',
    createdAt: now,
    entries: [{
      eventId: event.id,
      expectedRevision: event.revision + 1,
      action: 'restore',
      previousRelatedEventId: null,
      previousAttemptNumber: null,
    }],
  }
  const result = applyGameEventMutations(
    state,
    [{ type: 'delete', eventId: event.id }],
    now,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(
      state,
      'command_failed',
      result.ok
        ? 'Basketball timeout correction did not produce a complete event projection.'
        : result.error.message
    )
  }
  return { ok: true, state: withUndoReceipt(result.state, receipt) }
}

function newestMatchingTimeout(
  state: GameState,
  target: BasketballTimeoutDecrementTarget
): BasketballTimeoutEvent | null {
  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  const periodId = sportState?.projection.status === 'in_progress'
    ? sportState.projection.currentPeriodId
    : null
  if (!periodId) return null
  return activeBasketballEvents(state)
    .filter((event): event is BasketballTimeoutEvent =>
      event.eventType === 'basketball.timeout' && event.period.id === periodId
    )
    .sort((left, right) => compareGameEventCaptureOrder(right, left))
    .find(event => target.mode === 'charged'
      ? event.teamSide === target.teamSide &&
        (event.payload.kind === 'full' || event.payload.kind === 'thirty_second')
      : event.teamSide === 'neutral' && event.payload.kind === target.kind
    ) ?? null
}

function sideInventory(used: number, cap: number | null): BasketballTimeoutSideInventory {
  const remaining = cap === null ? null : Math.max(0, cap - used)
  return { used, cap, remaining, exhausted: remaining === 0 }
}

export function formatBasketballTimeoutInventory(
  inventory: BasketballTimeoutSideInventory
): string {
  if (inventory.cap === null) return `${inventory.used} used - unlimited`
  if (inventory.remaining === 0) {
    return `${inventory.used} of ${inventory.cap} used - exhausted`
  }
  return `${inventory.used} of ${inventory.cap} used - ${inventory.remaining} remaining`
}

function activeBasketballEvents(state: GameState): BasketballMatchEvent[] {
  if (!state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) return []
  return inspection.activeEvents.filter(
    (event): event is BasketballMatchEvent => event.sportId === 'basketball'
  )
}

function clearUndoReceipt(state: GameState): GameState {
  return withUndoReceipt(state, null)
}

function withUndoReceipt(
  state: GameState,
  receipt: BasketballCourtUndoReceipt | null
): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
  return {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      capturePreferences: {
        ...state.sportGameState.capturePreferences,
        lastCourtUndo: receipt,
      },
    },
  }
}

function isFinalCloudGame(state: GameState): boolean {
  return state.cloudSync.gameStatus === 'final'
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

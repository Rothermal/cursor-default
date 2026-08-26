import type { GameState } from '../../types'
import { addGameEvent, addGameEvents } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { isFinalBasketballCloudGame } from './cloudPolicy'
import {
  type BasketballCommandErrorCode,
  type BasketballStateCommandResult,
  createBasketballCaptureCommandId,
  getBasketballCommandContext,
} from './commands'
import {
  BASKETBALL_CLOCK_TEXT_MAX_LENGTH,
  createBasketballClockEvent,
} from './clockEvents'
import { basketballClockMomentAt } from './clockProjection'
import { createBasketballUuid } from './id'
import { resolveBasketballPeriodSegment } from './rules'
import type { BasketballStoppageCategory } from './types'

export interface BasketballClockCommandOptions {
  recorderUserId: string | null
  occurredAt?: string
  eventId?: string
  captureCommandId?: string
}

export interface BasketballPauseClockOptions extends BasketballClockCommandOptions {
  stoppage?: {
    category: BasketballStoppageCategory
    note?: string | null
    eventId?: string
  }
}

export interface BasketballSetClockOptions extends BasketballClockCommandOptions {
  elapsedMs: number
  reason: string
  pauseEventId?: string
}

export function startBasketballClock(
  state: GameState,
  options: BasketballClockCommandOptions
): BasketballStateCommandResult {
  const blocked = clockCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!blocked.ok) return blocked
  const { context, clock } = blocked
  if (clock.running) return failure(state, 'command_failed', 'Basketball clock is already running.')

  const event = createBasketballClockEvent({
    id: options.eventId ?? createBasketballUuid(),
    eventType: 'basketball.clock_started',
    payload: {
      captureCommandId: options.captureCommandId ?? null,
      anchorElapsedMs: clock.elapsedMs,
    },
    recorderUserId: options.recorderUserId,
    sequence: context.nextSequence,
    period: context.period,
    elapsedMs: clock.elapsedMs,
    occurredAt: context.occurredAt,
  })
  return appendClockEvents(state, [event])
}

export function pauseBasketballClock(
  state: GameState,
  options: BasketballPauseClockOptions
): BasketballStateCommandResult {
  const checked = clockCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!checked.ok) return checked
  const { context, clock, durationMs } = checked
  if (!clock.running) return failure(state, 'command_failed', 'Basketball clock is already paused.')

  const moment = basketballClockMomentAt(clock, context.occurredAt, durationMs)
  if (!moment.ok) return failure(state, 'invalid_timestamp', moment.message)
  const captureCommandId = options.stoppage
    ? options.captureCommandId ?? createBasketballCaptureCommandId()
    : options.captureCommandId ?? null
  const pauseId = options.eventId ?? createBasketballUuid()
  const pause = createBasketballClockEvent({
    id: pauseId,
    eventType: 'basketball.clock_paused',
    payload: {
      captureCommandId,
      elapsedMs: moment.elapsedMs,
      source: moment.unboundedElapsedMs >= durationMs ? 'expiration' : 'manual',
    },
    recorderUserId: options.recorderUserId,
    sequence: context.nextSequence,
    period: context.period,
    elapsedMs: moment.elapsedMs,
    occurredAt: context.occurredAt,
  })
  if (!options.stoppage) return appendClockEvents(state, [pause])

  const note = options.stoppage.note?.trim() || null
  if (note && note.length > BASKETBALL_CLOCK_TEXT_MAX_LENGTH) {
    return failure(state, 'command_failed', 'Basketball stoppage note is too long.')
  }
  const stoppage = createBasketballClockEvent({
    id: options.stoppage.eventId ?? createBasketballUuid(),
    eventType: 'basketball.stoppage',
    payload: {
      captureCommandId: captureCommandId!,
      pauseEventId: pauseId,
      category: options.stoppage.category,
      note,
    },
    recorderUserId: options.recorderUserId,
    sequence: context.nextSequence + 1,
    period: context.period,
    elapsedMs: moment.elapsedMs,
    occurredAt: context.occurredAt,
  })
  return appendClockEvents(state, [pause, stoppage])
}

export function setBasketballClock(
  state: GameState,
  options: BasketballSetClockOptions
): BasketballStateCommandResult {
  const checked = clockCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!checked.ok) return checked
  const { context, clock, durationMs } = checked
  if (!Number.isInteger(options.elapsedMs) || options.elapsedMs < 0 || options.elapsedMs > durationMs) {
    return failure(state, 'command_failed', 'Basketball clock value is outside the active period.')
  }
  const reason = options.reason.trim()
  if (!reason || reason.length > BASKETBALL_CLOCK_TEXT_MAX_LENGTH) {
    return failure(state, 'command_failed', 'Enter a valid reason for the Basketball clock change.')
  }

  const captureCommandId = options.captureCommandId ?? createBasketballCaptureCommandId()
  const events = []
  let currentElapsedMs = clock.elapsedMs
  if (clock.running) {
    const moment = basketballClockMomentAt(clock, context.occurredAt, durationMs)
    if (!moment.ok) return failure(state, 'invalid_timestamp', moment.message)
    currentElapsedMs = moment.elapsedMs
    events.push(createBasketballClockEvent({
      id: options.pauseEventId ?? createBasketballUuid(),
      eventType: 'basketball.clock_paused',
      payload: {
        captureCommandId,
        elapsedMs: currentElapsedMs,
        source: moment.unboundedElapsedMs >= durationMs ? 'expiration' : 'manual',
      },
      recorderUserId: options.recorderUserId,
      sequence: context.nextSequence,
      period: context.period,
      elapsedMs: currentElapsedMs,
      occurredAt: context.occurredAt,
    }))
  }

  events.push(createBasketballClockEvent({
    id: options.eventId ?? createBasketballUuid(),
    eventType: 'basketball.clock_adjusted',
    payload: {
      captureCommandId,
      fromElapsedMs: currentElapsedMs,
      toElapsedMs: options.elapsedMs,
      reason,
    },
    recorderUserId: options.recorderUserId,
    sequence: context.nextSequence + (clock.running ? 1 : 0),
    period: context.period,
    elapsedMs: options.elapsedMs,
    occurredAt: context.occurredAt,
  }))
  return appendClockEvents(state, events)
}

function clockCommandContext(
  state: GameState,
  recorderUserId: string | null,
  occurredAt?: string
) {
  if (isFinalBasketballCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballCommandContext(state, recorderUserId, occurredAt)
  if (!context.ok) return { ...context, state }
  const clock = context.value.sportState.projection.clock
  if (!clock || !clock.periodId) {
    return failure(state, 'command_failed', 'This Basketball game does not use an anchored clock.')
  }
  const segment = resolveBasketballPeriodSegment(
    context.value.sportState.setup.rulesSnapshot,
    clock.periodId
  )
  if (!segment) return failure(state, 'invalid_period', 'The active Basketball period is invalid.')
  return { ok: true as const, context: context.value, clock, durationMs: segment.durationMs }
}

function appendClockEvents(
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
        ? 'Basketball clock command did not produce a complete event projection.'
        : appended.error.message
    )
  }
  return { ok: true, state: appended.state }
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballStateCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}

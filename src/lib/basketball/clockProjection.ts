import type { GameEvent } from '../gameEvents/types'
import { resolveBasketballPeriodSegment } from './rules'
import type {
  BasketballAnchoredClockProjection,
  BasketballClockEvent,
  BasketballClockDisplayDirection,
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballSportGameState,
} from './types'

export type BasketballClockMomentResult =
  | { ok: true; unboundedElapsedMs: number; elapsedMs: number }
  | { ok: false; message: string }

export interface BasketballClockDisplay {
  elapsedMs: number
  displayMs: number
  reachedExpiration: boolean
  backwardClockWarning: boolean
}

export const BASKETBALL_CLOCK_MAX_WALL_DELTA_MS = 24 * 60 * 60 * 1000

export type BasketballClockRecoveryIssue = 'backward' | 'excessive_delta'

export function basketballClockRecoveryIssue(
  clock: BasketballAnchoredClockProjection,
  occurredAt: string
): BasketballClockRecoveryIssue | null {
  if (!clock.running || clock.anchorOccurredAt === null) return null
  const targetMs = Date.parse(occurredAt)
  const anchorMs = Date.parse(clock.anchorOccurredAt)
  if (!Number.isFinite(targetMs) || !Number.isFinite(anchorMs)) return null
  const deltaMs = targetMs - anchorMs
  if (deltaMs < 0) return 'backward'
  return deltaMs > BASKETBALL_CLOCK_MAX_WALL_DELTA_MS ? 'excessive_delta' : null
}

export function validateBasketballEventClockMoment(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballMatchEvent
): string | null {
  const clock = projection.clock
  if (!clock) {
    return event.elapsedMs === null
      ? null
      : 'Clockless Basketball events require a null elapsed value.'
  }
  if (event.eventType === 'basketball.period_started') {
    return event.elapsedMs === 0
      ? null
      : 'An anchored Basketball period must start at elapsed zero.'
  }
  if (event.elapsedMs === null) return 'Anchored Basketball events require an elapsed value.'
  if (event.eventType === 'basketball.clock_adjusted') return null
  let activeMoment: BasketballClockMomentResult | null = null
  if (clock.running && clock.periodId) {
    const activeSegment = resolveBasketballPeriodSegment(
      sportState.setup.rulesSnapshot,
      clock.periodId
    )
    if (!activeSegment) return 'The active Basketball clock period is invalid.'
    activeMoment = basketballClockMomentAt(clock, event.occurredAt, activeSegment.durationMs)
    if (!activeMoment.ok) return activeMoment.message
    if (
      activeMoment.unboundedElapsedMs >= activeSegment.durationMs &&
      event.eventType !== 'basketball.clock_paused'
    ) {
      return 'Basketball clock expiration must be materialized before later events.'
    }
  }
  if (!clock.periodId || event.period.id !== clock.periodId) {
    return isValidHistoricalBasketballClockMoment(projection, sportState, event, null)
      ? null
      : 'Anchored Basketball event does not target a valid recorded-later clock moment.'
  }
  if (!clock.running) {
    return event.elapsedMs === clock.elapsedMs ||
      isValidHistoricalBasketballClockMoment(projection, sportState, event, clock.elapsedMs)
      ? null
      : 'Basketball event elapsed value does not match the paused clock.'
  }

  const segment = resolveBasketballPeriodSegment(sportState.setup.rulesSnapshot, clock.periodId)
  if (!segment) return 'The active Basketball clock period is invalid.'
  const moment = activeMoment ?? basketballClockMomentAt(clock, event.occurredAt, segment.durationMs)
  if (!moment.ok) return moment.message
  if (event.elapsedMs !== moment.elapsedMs) {
    return isValidHistoricalBasketballClockMoment(
      projection,
      sportState,
      event,
      moment.elapsedMs
    )
      ? null
      : 'Basketball event elapsed value does not match the running clock.'
  }
  return null
}

export function applyBasketballClockEvent(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballClockEvent
): string | null {
  const clock = projection.clock
  if (!clock || !clock.periodId) return 'Basketball clock event requires anchored clock rules.'
  if (projection.status !== 'in_progress' || projection.currentPeriodId !== clock.periodId) {
    return 'Basketball clock event requires an active period.'
  }
  const segment = resolveBasketballPeriodSegment(sportState.setup.rulesSnapshot, clock.periodId)
  if (!segment) return 'The active Basketball clock period is invalid.'

  switch (event.eventType) {
    case 'basketball.clock_started':
      if (clock.running) return 'Basketball clock is already running.'
      if (clock.expired || clock.elapsedMs >= segment.durationMs) {
        return 'Set the Basketball clock below the period duration before starting it.'
      }
      if (
        event.payload.anchorElapsedMs !== clock.elapsedMs ||
        event.elapsedMs !== clock.elapsedMs
      ) return 'Basketball clock start anchor is stale.'
      clock.running = true
      clock.anchorElapsedMs = clock.elapsedMs
      clock.anchorOccurredAt = event.occurredAt
      clock.lastRunningElapsedMs = clock.elapsedMs
      clock.lastStartEventId = event.id
      clearPendingStoppage(clock)
      return null

    case 'basketball.clock_paused': {
      if (!clock.running) return 'Basketball clock is already paused.'
      const moment = basketballClockMomentAt(clock, event.occurredAt, segment.durationMs)
      if (!moment.ok) return moment.message
      if (event.payload.elapsedMs !== moment.elapsedMs || event.elapsedMs !== moment.elapsedMs) {
        return 'Basketball clock pause elapsed value is stale.'
      }
      if (moment.unboundedElapsedMs >= segment.durationMs) {
        if (event.payload.source !== 'expiration') {
          return 'An expired Basketball clock requires an expiration pause.'
        }
      } else if (event.payload.source === 'expiration') {
        return 'Basketball clock cannot expire before the period duration.'
      }
      clock.running = false
      clock.elapsedMs = moment.elapsedMs
      clock.anchorElapsedMs = null
      clock.anchorOccurredAt = null
      clock.lastRunningElapsedMs = null
      clock.expired = event.payload.source === 'expiration'
      clock.lastPauseEventId = event.id
      clock.pendingStoppagePauseEventId = event.id
      clock.pendingStoppageCaptureCommandId = event.payload.captureCommandId
      return null
    }

    case 'basketball.clock_adjusted':
      if (clock.running) return 'Pause the Basketball clock before adjusting it.'
      if (
        event.payload.fromElapsedMs !== clock.elapsedMs ||
        event.payload.toElapsedMs !== event.elapsedMs
      ) return 'Basketball clock adjustment is stale.'
      if (event.payload.toElapsedMs > segment.durationMs) {
        return 'Basketball clock adjustment exceeds the period duration.'
      }
      clock.elapsedMs = event.payload.toElapsedMs
      clock.lastRunningElapsedMs = null
      clock.expired = event.payload.toElapsedMs === segment.durationMs
      clock.lastAdjustmentEventId = event.id
      clearPendingStoppage(clock)
      return null

    case 'basketball.stoppage':
      if (clock.running) return 'Basketball stoppage requires a paused clock.'
      if (
        event.payload.pauseEventId !== clock.pendingStoppagePauseEventId ||
        event.payload.captureCommandId !== clock.pendingStoppageCaptureCommandId
      ) return 'Basketball stoppage does not match the immediately preceding pause.'
      clock.lastStoppageEventId = event.id
      clearPendingStoppage(clock)
      return null
  }
}

export function startBasketballClockPeriod(
  projection: BasketballMatchProjection,
  periodId: string
): void {
  if (!projection.clock) return
  Object.assign(projection.clock, {
    periodId,
    running: false,
    elapsedMs: 0,
    anchorElapsedMs: null,
    anchorOccurredAt: null,
    lastRunningElapsedMs: null,
    expired: false,
    lastStartEventId: null,
    lastPauseEventId: null,
    lastAdjustmentEventId: null,
    lastStoppageEventId: null,
    pendingStoppagePauseEventId: null,
    pendingStoppageCaptureCommandId: null,
  })
}

export function clearPendingBasketballStoppageAfterEvent(
  projection: BasketballMatchProjection,
  event: GameEvent
): void {
  if (!projection.clock) return
  if (event.eventType === 'basketball.clock_paused' || event.eventType === 'basketball.stoppage') {
    return
  }
  clearPendingStoppage(projection.clock)
}

export function recordBasketballRunningClockMomentAfterEvent(
  projection: BasketballMatchProjection,
  event: GameEvent
): void {
  const clock = projection.clock
  if (!clock?.running || event.elapsedMs === null) return
  clock.lastRunningElapsedMs = Math.max(clock.lastRunningElapsedMs ?? 0, event.elapsedMs)
}

export function basketballClockMomentAt(
  clock: BasketballAnchoredClockProjection,
  occurredAt: string,
  durationMs: number
): BasketballClockMomentResult {
  if (!clock.running || clock.anchorElapsedMs === null || clock.anchorOccurredAt === null) {
    return { ok: true, unboundedElapsedMs: clock.elapsedMs, elapsedMs: clock.elapsedMs }
  }
  const targetMs = Date.parse(occurredAt)
  const anchorMs = Date.parse(clock.anchorOccurredAt)
  if (!Number.isFinite(targetMs) || !Number.isFinite(anchorMs)) {
    return { ok: false, message: 'Basketball clock timestamp is invalid.' }
  }
  const deltaMs = targetMs - anchorMs
  if (deltaMs < 0) {
    return { ok: false, message: 'Basketball clock timestamp precedes the running anchor.' }
  }
  const unboundedElapsedMs = clock.anchorElapsedMs + deltaMs
  const elapsedMs = Math.min(durationMs, unboundedElapsedMs)
  if (clock.lastRunningElapsedMs !== null && elapsedMs < clock.lastRunningElapsedMs) {
    return {
      ok: false,
      message: 'Basketball clock elapsed value moved backward within the running interval.',
    }
  }
  return {
    ok: true,
    unboundedElapsedMs,
    elapsedMs,
  }
}

export function deriveBasketballClockDisplay(
  clock: BasketballAnchoredClockProjection,
  durationMs: number,
  direction: BasketballClockDisplayDirection,
  now: string
): BasketballClockDisplay | null {
  if (!clock.running || clock.anchorElapsedMs === null || clock.anchorOccurredAt === null) {
    const elapsedMs = Math.min(durationMs, clock.elapsedMs)
    return displayResult(elapsedMs, durationMs, direction, false)
  }
  const nowMs = Date.parse(now)
  const anchorMs = Date.parse(clock.anchorOccurredAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(anchorMs)) return null
  const backwardClockWarning = nowMs < anchorMs
  const elapsedMs = Math.min(
    durationMs,
    clock.anchorElapsedMs + Math.max(0, nowMs - anchorMs)
  )
  return displayResult(elapsedMs, durationMs, direction, backwardClockWarning)
}

function displayResult(
  elapsedMs: number,
  durationMs: number,
  direction: BasketballClockDisplayDirection,
  backwardClockWarning: boolean
): BasketballClockDisplay {
  return {
    elapsedMs,
    displayMs: direction === 'count_down' ? durationMs - elapsedMs : elapsedMs,
    reachedExpiration: elapsedMs >= durationMs,
    backwardClockWarning,
  }
}

function isValidHistoricalBasketballClockMoment(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballMatchEvent,
  currentPeriodLimit: number | null
): boolean {
  if (!isBasketballRecordedLaterEventType(event.eventType) || event.elapsedMs === null) return false
  if (!projection.startedPeriodIds.includes(event.period.id)) return false
  const segment = resolveBasketballPeriodSegment(sportState.setup.rulesSnapshot, event.period.id)
  if (!segment || segment.order !== event.period.order) return false
  if (event.elapsedMs < 0 || event.elapsedMs > segment.durationMs) return false
  if (event.period.id === projection.clock?.periodId) {
    return currentPeriodLimit !== null && event.elapsedMs <= currentPeriodLimit
  }
  return projection.completedPeriodIds.includes(event.period.id)
}

function isBasketballRecordedLaterEventType(eventType: string): boolean {
  return eventType === 'basketball.shot' ||
    eventType === 'basketball.assist' ||
    eventType === 'basketball.rebound' ||
    eventType === 'basketball.steal' ||
    eventType === 'basketball.block' ||
    eventType === 'basketball.turnover' ||
    eventType === 'basketball.score_adjustment' ||
    eventType === 'basketball.foul' ||
    eventType === 'basketball.free_throw_trip' ||
    eventType === 'basketball.ejection' ||
    eventType === 'basketball.timeout'
}

function clearPendingStoppage(clock: BasketballAnchoredClockProjection): void {
  clock.pendingStoppagePauseEventId = null
  clock.pendingStoppageCaptureCommandId = null
}

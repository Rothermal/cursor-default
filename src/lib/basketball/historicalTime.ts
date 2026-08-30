import type { GameState } from '../../types'
import type { GameEventPeriod } from '../gameEvents/types'
import { basketballClockMomentAt, basketballClockRecoveryIssue } from './clockProjection'
import { resolveBasketballPeriodSegment } from './rules'

export type BasketballHistoricalTimeResult =
  | { ok: true; elapsedMs: number | null; durationMs: number | null; countDown: boolean }
  | { ok: false; message: string }

export function basketballHistoricalDisplayMs(
  durationMs: number,
  elapsedMs: number,
  countDown: boolean
): number {
  return countDown ? durationMs - elapsedMs : elapsedMs
}

export function basketballHistoricalElapsedMs(
  durationMs: number,
  displayMs: number,
  countDown: boolean
): number {
  return countDown ? durationMs - displayMs : displayMs
}

export function defaultBasketballHistoricalTime(
  state: GameState,
  period: GameEventPeriod,
  occurredAt = new Date().toISOString()
): BasketballHistoricalTimeResult {
  if (state.sportGameState?.sportId !== 'basketball') {
    return { ok: false, message: 'An initialized Basketball event game is required.' }
  }
  const { projection, setup } = state.sportGameState
  const clock = projection.clock
  if (!clock) return { ok: true, elapsedMs: null, durationMs: null, countDown: false }
  const segment = resolveBasketballPeriodSegment(setup.rulesSnapshot, period.id)
  if (!segment || segment.order !== period.order) {
    return { ok: false, message: 'The selected Basketball period is invalid.' }
  }
  if (clock.periodId === period.id) {
    const recoveryIssue = basketballClockRecoveryIssue(clock, occurredAt)
    if (recoveryIssue) {
      return {
        ok: false,
        message: recoveryIssue === 'backward'
          ? 'Basketball clock timestamp moved backward. Use Set Clock to recover.'
          : 'Basketball clock was away too long to recover automatically. Use Set Clock.',
      }
    }
    const moment = basketballClockMomentAt(clock, occurredAt, segment.durationMs)
    if (!moment.ok) return { ok: false, message: moment.message }
    return {
      ok: true,
      elapsedMs: moment.elapsedMs,
      durationMs: segment.durationMs,
      countDown: setup.rulesSnapshot.clockDisplayDirection === 'count_down',
    }
  }
  if (!projection.completedPeriodIds.includes(period.id)) {
    return { ok: false, message: 'The selected Basketball period has no completed clock range.' }
  }
  return {
    ok: true,
    elapsedMs: segment.durationMs,
    durationMs: segment.durationMs,
    countDown: setup.rulesSnapshot.clockDisplayDirection === 'count_down',
  }
}

export function validateBasketballHistoricalTime(
  state: GameState,
  period: GameEventPeriod,
  elapsedMs: number | null
): BasketballHistoricalTimeResult {
  const resolved = defaultBasketballHistoricalTime(state, period)
  if (!resolved.ok || resolved.durationMs === null) {
    if (!resolved.ok) return resolved
    return elapsedMs === null
      ? resolved
      : { ok: false, message: 'Clockless Basketball events require no game-clock time.' }
  }
  if (
    elapsedMs === null ||
    !Number.isInteger(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs > resolved.durationMs
  ) {
    return { ok: false, message: 'Enter a game time within the selected Basketball period.' }
  }
  if (
    state.sportGameState?.sportId === 'basketball' &&
    state.sportGameState.projection.clock?.periodId === period.id &&
    resolved.elapsedMs !== null &&
    elapsedMs > resolved.elapsedMs
  ) {
    return { ok: false, message: 'Historical Basketball time cannot exceed the current clock watermark.' }
  }
  return { ...resolved, elapsedMs }
}

import type { GameState } from '../../types'
import { gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import { isBasketballAnchoredCloudAuthority } from './cloudAuthorization'

export type BasketballAnchoredFinalizationBlockerCode =
  | 'source_invalid'
  | 'terminal_outcome_required'
  | 'periods_incomplete'
  | 'clock_not_paused'
  | 'clock_anchor_unsafe'
  | 'tracked_lineup_incomplete'
  | 'replacement_required'
  | 'boundary_review_required'
  | 'equal_play_override_incomplete'
  | 'completed_game_tied'

export interface BasketballAnchoredFinalizationBlocker {
  code: BasketballAnchoredFinalizationBlockerCode
  message: string
}

export interface BasketballAnchoredFinalizationEvaluation {
  applicable: boolean
  blockers: BasketballAnchoredFinalizationBlocker[]
}

export interface BasketballAnchoredFinalizationEvaluationOptions {
  projectionComplete?: boolean
}

export const BASKETBALL_ANCHORED_FINALIZATION_BLOCKER_ORDER: readonly
  BasketballAnchoredFinalizationBlockerCode[] = [
    'source_invalid',
    'terminal_outcome_required',
    'periods_incomplete',
    'clock_not_paused',
    'clock_anchor_unsafe',
    'tracked_lineup_incomplete',
    'replacement_required',
    'boundary_review_required',
    'equal_play_override_incomplete',
    'completed_game_tied',
  ]

const blockerMessages: Record<BasketballAnchoredFinalizationBlockerCode, string> = {
  source_invalid: 'The primary Basketball event stream does not project completely.',
  terminal_outcome_required: 'Complete or abandon the primary Basketball game before finalizing.',
  periods_incomplete: 'Complete every expected Basketball period before finalizing.',
  clock_not_paused: 'Pause the terminal Basketball clock before finalizing.',
  clock_anchor_unsafe: 'Resolve the unsafe or stale Basketball clock anchor before finalizing.',
  tracked_lineup_incomplete: 'Repair the tracked lineup history before finalizing.',
  replacement_required: 'Resolve every tracked lineup replacement before finalizing.',
  boundary_review_required: 'Confirm the tracked lineup at every pending boundary before finalizing.',
  equal_play_override_incomplete: 'Complete every reasoned equal-play override before finalizing.',
  completed_game_tied: 'A tied Basketball game requires another overtime.',
}

export function evaluateBasketballAnchoredFinalization(
  state: GameState,
  options: BasketballAnchoredFinalizationEvaluationOptions = {}
): BasketballAnchoredFinalizationEvaluation {
  if (!isBasketballAnchoredCloudAuthority(state)) {
    return { applicable: false, blockers: [] }
  }

  const blockers: BasketballAnchoredFinalizationBlocker[] = []
  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  const stream = state.eventStream
  const inspection = stream
    ? inspectGameEventStream(stream, gameEventRegistry)
    : null
  if (!sportState || !stream || !inspection?.complete) {
    addBlocker(blockers, 'source_invalid')
    return { applicable: true, blockers }
  }

  const clockRowsUnsafe = inspection.activeEvents.some(event => {
    if (event.eventType === 'basketball.clock_started') {
      return typeof event.payload.anchorElapsedMs !== 'number' ||
        event.payload.anchorElapsedMs !== event.elapsedMs
    }
    if (event.eventType === 'basketball.clock_paused') {
      return typeof event.payload.elapsedMs !== 'number' ||
        event.payload.elapsedMs !== event.elapsedMs
    }
    if (event.eventType === 'basketball.clock_adjusted') {
      return typeof event.payload.toElapsedMs !== 'number' ||
        event.payload.toElapsedMs !== event.elapsedMs
    }
    return false
  })
  const latestClockStart = latestSequence(inspection.activeEvents, 'basketball.clock_started')
  const latestClockPause = latestSequence(inspection.activeEvents, 'basketball.clock_paused')
  const rawClockRunning = latestClockStart !== null &&
    (latestClockPause === null || latestClockStart > latestClockPause)
  if (options.projectionComplete === false) {
    if (rawClockRunning) addBlocker(blockers, 'clock_not_paused')
    if (rawClockRunning || clockRowsUnsafe) addBlocker(blockers, 'clock_anchor_unsafe')
    if (blockers.length === 0) addBlocker(blockers, 'source_invalid')
    return { applicable: true, blockers }
  }

  const projection = sportState.projection
  const terminal = projection.status === 'ended' &&
    (projection.endReason === 'completed' || projection.endReason === 'abandoned')
  const completedTied = projection.endReason === 'completed' &&
    projection.score.tracked === projection.score.opponent
  if (!terminal) addBlocker(blockers, 'terminal_outcome_required')

  if (projection.endReason === 'completed') {
    const requiredPeriodIds = new Set([
      ...sportState.setup.rulesSnapshot.regulationSegments.map(period => period.id),
      ...projection.startedPeriodIds,
    ])
    if ([...requiredPeriodIds].some(id => !projection.completedPeriodIds.includes(id))) {
      addBlocker(blockers, 'periods_incomplete')
    }
  }

  const clock = projection.clock
  if (!clock || clock.running) addBlocker(blockers, 'clock_not_paused')
  if (
    !clock ||
    clockRowsUnsafe ||
    clock.anchorElapsedMs !== null ||
    clock.anchorOccurredAt !== null ||
    clock.lastRunningElapsedMs !== null
  ) addBlocker(blockers, 'clock_anchor_unsafe')

  const lineup = projection.lineup
  const tracked = lineup?.sides.tracked ?? null
  if (
    !tracked ||
    tracked.incompletePeriodIds.length > 0 ||
    tracked.onCourtIntervals.some(interval => !interval.complete || interval.endElapsedMs === null)
  ) addBlocker(blockers, 'tracked_lineup_incomplete')
  if (tracked?.replacementRequiredParticipantIds.length) {
    addBlocker(blockers, 'replacement_required')
  }
  if (tracked?.boundaryConfirmationRequired) {
    addBlocker(blockers, 'boundary_review_required')
  }
  if (!lineup?.enforcedOverridesComplete || lineup.pendingEqualPlayOverride) {
    addBlocker(blockers, 'equal_play_override_incomplete')
  }
  if (completedTied) addBlocker(blockers, 'completed_game_tied')

  return { applicable: true, blockers }
}

function latestSequence(
  events: readonly GameEvent[],
  eventType: string
): number | null {
  let latest: number | null = null
  for (const event of events) {
    if (event.eventType !== eventType) continue
    if (latest === null || event.sequence > latest) latest = event.sequence
  }
  return latest
}

export function basketballAnchoredFinalizationBlockerMessage(
  code: BasketballAnchoredFinalizationBlockerCode
): string {
  return blockerMessages[code]
}

export function isBasketballAnchoredFinalizationBlockerCode(
  value: unknown
): value is BasketballAnchoredFinalizationBlockerCode {
  return typeof value === 'string' && value in blockerMessages
}

function addBlocker(
  blockers: BasketballAnchoredFinalizationBlocker[],
  code: BasketballAnchoredFinalizationBlockerCode
): void {
  if (blockers.some(blocker => blocker.code === code)) return
  blockers.push({ code, message: blockerMessages[code] })
}

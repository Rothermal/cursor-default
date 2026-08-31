import type { GameState } from '../../types'
import { gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
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
  state: GameState
): BasketballAnchoredFinalizationEvaluation {
  if (!isBasketballAnchoredCloudAuthority(state)) {
    return { applicable: false, blockers: [] }
  }

  const blockers: BasketballAnchoredFinalizationBlocker[] = []
  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  const stream = state.eventStream
  if (!sportState || !stream || !inspectGameEventStream(stream, gameEventRegistry).complete) {
    addBlocker(blockers, 'source_invalid')
    return { applicable: true, blockers }
  }

  const projection = sportState.projection
  const terminal = projection.status === 'ended' &&
    (projection.endReason === 'completed' || projection.endReason === 'abandoned')
  if (!terminal) addBlocker(blockers, 'terminal_outcome_required')

  if (projection.endReason === 'completed') {
    const requiredPeriodIds = new Set([
      ...sportState.setup.rulesSnapshot.regulationSegments.map(period => period.id),
      ...projection.startedPeriodIds,
    ])
    if ([...requiredPeriodIds].some(id => !projection.completedPeriodIds.includes(id))) {
      addBlocker(blockers, 'periods_incomplete')
    }
    if (projection.score.tracked === projection.score.opponent) {
      addBlocker(blockers, 'completed_game_tied')
    }
  }

  const clock = projection.clock
  if (!clock || clock.running) addBlocker(blockers, 'clock_not_paused')
  if (
    !clock ||
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

  return { applicable: true, blockers }
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

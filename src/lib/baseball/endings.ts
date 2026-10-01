import type {
  BaseballGameEndOutcome,
  BaseballHalfInningEndReason,
  BaseballMatchProjection,
  BaseballPendingEnd,
} from './types'

/**
 * Endings (BSB-3D). Nothing ends on its own: a legal ending blocks play until the recorder
 * records it, so a mistaken final play can still be undone first.
 */
export interface BaseballEndGameOption {
  outcome: BaseballGameEndOutcome
  label: string
  /** Suspend and abandon need a reason; it is stored as the ending's note. */
  needsReason: boolean
  /** Forfeit names the winner. */
  needsWinner: boolean
}

export const BASEBALL_HALF_END_OPTIONS: ReadonlyArray<{ reason: BaseballHalfInningEndReason; label: string }> = [
  { reason: 'time_limit', label: 'Time limit' },
  { reason: 'mercy', label: 'Mercy rule' },
  { reason: 'other', label: 'Other' },
]

/** The outcome the pending-end banner records. */
export function baseballPendingEndOutcome(pendingEnd: Exclude<BaseballPendingEnd, null>): BaseballGameEndOutcome {
  return pendingEnd === 'run_rule' ? 'run_rule' : 'completed'
}

export function baseballPendingEndMessage(pendingEnd: Exclude<BaseballPendingEnd, null>): string {
  switch (pendingEnd) {
    case 'regulation':
      return 'Regulation is complete.'
    case 'walk_off':
      return 'Walk-off: the home team has taken the lead.'
    case 'run_rule':
      return 'The run rule has been reached.'
  }
}

/**
 * The End game choices for this moment: Completed or Run rule only when the projection says
 * the game can end that way, and time limit, forfeit, suspend and abandon at any point of
 * a game in progress.
 */
export function baseballEndGameOptions(projection: BaseballMatchProjection): BaseballEndGameOption[] {
  if (projection.status !== 'in_progress') return []
  const options: BaseballEndGameOption[] = []
  if (projection.pendingEnd === 'regulation' || projection.pendingEnd === 'walk_off') {
    options.push({ outcome: 'completed', label: 'Completed', needsReason: false, needsWinner: false })
  }
  if (projection.pendingEnd === 'run_rule') {
    options.push({ outcome: 'run_rule', label: 'Run rule', needsReason: false, needsWinner: false })
  }
  options.push(
    { outcome: 'time_limit', label: 'Time limit', needsReason: false, needsWinner: false },
    { outcome: 'forfeit', label: 'Forfeit', needsReason: false, needsWinner: true },
    { outcome: 'suspended', label: 'Suspend', needsReason: true, needsWinner: false },
    { outcome: 'abandoned', label: 'Abandon', needsReason: true, needsWinner: false },
  )
  return options
}

/** A finished, suspended or abandoned game can be reopened, with a reason. */
export function baseballCanReopen(projection: BaseballMatchProjection): boolean {
  return projection.status === 'final' || projection.status === 'suspended' || projection.status === 'abandoned'
}

/** Ending a half early is offered while a half is in progress and no game ending is pending. */
export function baseballCanEndHalf(projection: BaseballMatchProjection): boolean {
  return projection.status === 'in_progress' && projection.pendingEnd === null && projection.outs < 3
}

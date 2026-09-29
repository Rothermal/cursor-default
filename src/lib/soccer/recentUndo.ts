import type { GameEvent } from '../gameEvents/types'

/** Recorder-entered families Field Undo may remove (S4). */
const UNDOABLE_EVENT_TYPES = new Set([
  'soccer.shot',
  'soccer.own_goal',
  'soccer.score_adjustment',
  'soccer.defensive_action',
  'soccer.foul',
  'soccer.card',
  'soccer.team_event',
  'soccer.substitution_window',
  'soccer.lineup_transition',
  'soccer.role_changed',
])

/** Lineup families follow the lineup manager's paused-clock rule. */
const LINEUP_EVENT_TYPES = new Set([
  'soccer.substitution_window',
  'soccer.lineup_transition',
  'soccer.role_changed',
])

export const SOCCER_RECENT_UNDO_LIMIT = 5

export interface SoccerRecentUndoRow {
  event: GameEvent
  /** `stop` rows (kickoff, periods, clock, rules, shootout...) end the list. */
  kind: 'event' | 'stop'
}

export interface SoccerRecentUndo {
  rows: SoccerRecentUndoRow[]
  /** Newest undoable event, or null when the newest row is a stop line. */
  target: GameEvent | null
  /** Why the target cannot be undone right now, if it cannot. */
  targetBlockedReason: string | null
}

export function isSoccerUndoableEventType(eventType: string): boolean {
  return UNDOABLE_EVENT_TYPES.has(eventType)
}

/**
 * Newest active events by recording order (`sequence`), stopping at the first
 * event Field Undo must not reach past. Only the first row can be undone.
 */
export function soccerRecentUndoCandidates(
  activeEvents: readonly GameEvent[],
  options: { lineupBlockedReason: string | null; limit?: number }
): SoccerRecentUndo {
  const limit = options.limit ?? SOCCER_RECENT_UNDO_LIMIT
  const newestFirst = [...activeEvents].sort((left, right) => right.sequence - left.sequence)
  const rows: SoccerRecentUndoRow[] = []
  for (const event of newestFirst) {
    if (rows.length >= limit) break
    if (!UNDOABLE_EVENT_TYPES.has(event.eventType)) {
      rows.push({ event, kind: 'stop' })
      break
    }
    rows.push({ event, kind: 'event' })
  }
  const target = rows[0]?.kind === 'event' ? rows[0].event : null
  return {
    rows,
    target,
    targetBlockedReason: target && LINEUP_EVENT_TYPES.has(target.eventType)
      ? options.lineupBlockedReason
      : null,
  }
}

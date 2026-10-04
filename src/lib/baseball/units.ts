import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import { formatBaseballHalf, parseBaseballPeriod } from './periods'
import type { BaseballEventType } from './types'

/**
 * Capture units shared by Recent plays (BSB-3D), the Timeline and corrections (BSB-4C): the
 * events one capture wrote, grouped by `captureCommandId`.
 */

/** Plays a recorder captures; everything else is game flow, never undone or removed on its own. */
export const BASEBALL_CAPTURE_TYPES: ReadonlySet<BaseballEventType> = new Set<BaseballEventType>([
  'baseball.pitch',
  'baseball.plate_appearance',
  'baseball.baserunning',
  'baseball.substitution',
  'baseball.score_adjustment',
  'baseball.pitcher_decisions',
])

export function isBaseballCaptureEvent(event: GameEvent): boolean {
  return BASEBALL_CAPTURE_TYPES.has(event.eventType as BaseballEventType)
}

/**
 * The completed-game epoch (BSB-5D): the id of the game end that made the game final, or null
 * when the game is not final now (never ended, reopened since, suspended or abandoned).
 */
export function baseballDecisionEpochId(events: readonly GameEvent[]): string | null {
  let epoch: string | null = null
  for (const event of [...events].sort(compareGameEventCaptureOrder)) {
    if (event.eventType === 'baseball.game_reopened') epoch = null
    if (event.eventType === 'baseball.game_ended') {
      const outcome = (event.payload as { outcome?: unknown }).outcome
      epoch = outcome === 'suspended' || outcome === 'abandoned' ? null : event.id
    }
  }
  return epoch
}

/** Active (not removed) events in capture order, migrated to the current payload shapes. */
export function baseballActiveEvents(state: GameState): GameEvent[] {
  if (!state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  return [...inspection.activeEvents].sort(compareGameEventCaptureOrder)
}

/** Removed events in capture order, migrated like active ones. */
export function baseballRemovedEvents(state: GameState): GameEvent[] {
  if (!state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  return [...inspection.deletedEvents].sort(compareGameEventCaptureOrder)
}

/** Consecutive events sharing a non-null `captureCommandId` form one unit. */
export function groupBaseballUnits(events: readonly GameEvent[]): GameEvent[][] {
  const units: GameEvent[][] = []
  for (const event of events) {
    const commandId = baseballCaptureCommandId(event)
    const last = units[units.length - 1]
    if (commandId && last && baseballCaptureCommandId(last[0]) === commandId) last.push(event)
    else units.push([event])
  }
  return units
}

export function baseballCaptureCommandId(event: GameEvent): string | null {
  const value = (event.payload as { captureCommandId?: unknown }).captureCommandId
  return typeof value === 'string' ? value : null
}

/** The stored event as saved (raw, not migrated), including removed ones. */
export function findBaseballStoredEvent(state: GameState, eventId: string): GameEvent | null {
  const raw = state.eventStream?.events.find(candidate => isGameEventEnvelope(candidate) && candidate.id === eventId)
  return raw && isGameEventEnvelope(raw) ? (raw as GameEvent) : null
}

export function formatBaseballEventHalf(event: GameEvent): string {
  const period = parseBaseballPeriod(event.period)
  return period ? formatBaseballHalf(period.inning, period.half) : ''
}

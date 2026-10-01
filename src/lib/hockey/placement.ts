import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import type { HockeyEventType } from './types'

/**
 * Game-order placement (HKY-4C). Live captures replay in capture order. An event recorded
 * later, or a live event whose time was corrected, carries `placement` in its payload and
 * replays at its game time instead:
 *
 * - `game_time` on an anchored game: before the first live event of its period, in capture
 *   order, whose clock time is strictly later; otherwise just before the period ends,
 * - `game_time` on a clockless game: just before its period ends,
 * - `period_start` (goalie changes only): right after the period starts, before every other
 *   event of the period.
 *
 * Placed events at the same point go period-start first, then by clock time, then capture
 * order. A stream with no placed events keeps capture order exactly.
 */

export type HockeyPlacement = 'game_time' | 'period_start'

export const HOCKEY_PLACEABLE_EVENT_TYPES = [
  'hockey.shot',
  'hockey.faceoff',
  'hockey.hit',
  'hockey.takeaway',
  'hockey.giveaway',
  'hockey.penalty',
  'hockey.goalie_change',
  'hockey.timeout',
  'hockey.team_event',
] as const satisfies readonly HockeyEventType[]

const PLACEABLE = new Set<string>(HOCKEY_PLACEABLE_EVENT_TYPES)

export interface HockeyPlacementFields {
  placement: HockeyPlacement | null
  recordedLater: boolean
  retimed: boolean
}

export const HOCKEY_PLACEMENT_KEYS = ['placement', 'recordedLater', 'retimed'] as const

export function isPlaceableHockeyEventType(eventType: string): boolean {
  return PLACEABLE.has(eventType)
}

/** The placement fields stored on an event's payload; absent fields read as a live capture. */
export function hockeyPlacementFields(event: Pick<GameEvent, 'payload'>): HockeyPlacementFields {
  const payload = event.payload as Record<string, unknown>
  const placement = payload.placement
  return {
    placement: placement === 'game_time' || placement === 'period_start' ? placement : null,
    recordedLater: payload.recordedLater === true,
    retimed: payload.retimed === true,
  }
}

export function hockeyEventPlacement(event: Pick<GameEvent, 'payload'>): HockeyPlacement | null {
  return hockeyPlacementFields(event).placement
}

/**
 * Checks the optional placement fields of a placeable payload and returns the payload without
 * them, for the family's own validator. Null when the fields are invalid.
 */
export function splitHockeyPlacementPayload(
  eventType: string,
  payload: Record<string, unknown>
): { message: string } | { rest: Record<string, unknown> } {
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!(HOCKEY_PLACEMENT_KEYS as readonly string[]).includes(key)) rest[key] = value
  }
  const has = (key: string) => Object.prototype.hasOwnProperty.call(payload, key)
  if (!has('placement') && !has('recordedLater') && !has('retimed')) return { rest }
  if (!PLACEABLE.has(eventType)) return { message: 'This Hockey event cannot be placed at a game time.' }
  const placement = payload.placement
  if (placement !== 'game_time' && placement !== 'period_start') {
    return { message: 'A placed Hockey event is placed at its game time or at the period start.' }
  }
  if (placement === 'period_start' && eventType !== 'hockey.goalie_change') {
    return { message: 'Only a goalie change is placed at the period start.' }
  }
  if (has('recordedLater') && payload.recordedLater !== true) return { message: 'Recorded later is only stored as true.' }
  if (has('retimed') && payload.retimed !== true) return { message: 'Re-timed is only stored as true.' }
  if (payload.recordedLater !== true && payload.retimed !== true) {
    return { message: 'A placed Hockey event was recorded later or re-timed.' }
  }
  return { rest }
}

/** Events in the order replay applies them (and the Timeline lists them). */
export function orderHockeyEvents<T extends GameEvent>(events: readonly T[]): T[] {
  const live: T[] = []
  const placed: T[] = []
  for (const event of events) (hockeyEventPlacement(event) ? placed : live).push(event)
  live.sort(compareGameEventCaptureOrder)
  if (placed.length === 0) return live
  placed.sort(compareGameEventCaptureOrder)

  const slots = new Map<number, T[]>()
  for (const event of placed) {
    const index = hockeyInsertionIndex(live, event)
    const slot = slots.get(index)
    if (slot) slot.push(event)
    else slots.set(index, [event])
  }
  const ordered: T[] = []
  const emit = (index: number) => {
    const slot = slots.get(index)
    if (!slot) return
    slot.sort((a, b) => {
      const startA = hockeyEventPlacement(a) === 'period_start' ? 0 : 1
      const startB = hockeyEventPlacement(b) === 'period_start' ? 0 : 1
      if (startA !== startB) return startA - startB
      const timeA = a.elapsedMs ?? -1
      const timeB = b.elapsedMs ?? -1
      if (timeA !== timeB) return timeA - timeB
      return compareGameEventCaptureOrder(a, b)
    })
    ordered.push(...slot)
  }
  live.forEach((event, index) => {
    emit(index)
    ordered.push(event)
  })
  emit(live.length)
  return ordered
}

/**
 * Where a placed event goes among the live events (capture order): it is inserted just before
 * the live event at the returned index, or after every live event at `live.length`.
 */
export function hockeyInsertionIndex(
  live: readonly GameEvent[],
  target: Pick<GameEvent, 'payload' | 'period' | 'elapsedMs'>
): number {
  const periodId = target.period.id
  const start = live.findIndex(event => event.eventType === 'hockey.period_started' && event.period.id === periodId)
  if (start < 0) return live.length
  if (hockeyEventPlacement(target) === 'period_start') return start + 1
  let end = live.findIndex((event, index) =>
    index > start && event.eventType === 'hockey.period_ended' && event.period.id === periodId
  )
  if (end < 0) {
    // A running period: after its last live event.
    end = start + 1
    while (end < live.length && live[end].period.id === periodId && live[end].eventType !== 'hockey.period_started') end += 1
  }
  if (target.elapsedMs !== null) {
    for (let index = start + 1; index < end; index += 1) {
      const elapsed = live[index].elapsedMs
      if (elapsed !== null && elapsed > target.elapsedMs) return index
    }
  }
  return end
}

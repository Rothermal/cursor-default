import type { GameState } from '../../types'
import { gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import { hockeySportState } from './live'
import { formatHockeyPeriod, parseHockeyPeriod } from './periods'
import { hockeyClockMomentAt, replayHockeyEvents } from './projector'
import type { HockeyFaceoffDotId } from './rinkGeometry'
import type { HockeySideLabels } from './recentEvents'
import type { HockeyAttackingDirection } from './types'

/**
 * Form helpers for the Timeline "When" step (HKY-4C): the periods an event can be placed in,
 * and conversion between the clock as the game shows it and played time.
 */

export interface HockeyPlaceablePeriod {
  periodId: string
  label: string
  durationMs: number
  /** How much of the period has been played; null for clockless games. */
  playedMs: number | null
  /** True when the game shows remaining time. */
  countDown: boolean
  trackedAttackingDirection: HockeyAttackingDirection | null
}

/** Started periods in order, with what has been played of each at `nowIso`. */
export function hockeyPlaceablePeriods(state: GameState, nowIso: string): HockeyPlaceablePeriod[] {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  const { projection } = replayHockeyEvents(sport.setup, inspection.activeEvents)
  const clock = sport.setup.rulesSnapshot.clock
  const anchored = sport.setup.rulesSnapshot.clockModel === 'anchored'
  return projection.periods.map(period => {
    let playedMs: number | null = null
    if (anchored) {
      playedMs = period.endedAtElapsedMs ?? period.durationMs
      if (period.id === projection.activePeriodId && projection.clock) {
        const moment = hockeyClockMomentAt(projection.clock, nowIso, period.durationMs)
        playedMs = moment.ok ? moment.elapsedMs : projection.clock.elapsedMs
      }
    }
    const ref = parseHockeyPeriod({ id: period.id, order: period.order })
    return {
      periodId: period.id,
      label: ref ? formatHockeyPeriod(ref) : period.id,
      durationMs: period.durationMs,
      playedMs,
      countDown: clock?.display === 'count_down',
      trackedAttackingDirection: period.trackedAttackingDirection,
    }
  })
}

/** "12:34", "1:05" or "45" (seconds) as milliseconds; null when it is not a clock time. */
export function parseHockeyClockText(text: string): number | null {
  const match = /^\s*(?:(\d{1,3}):)?(\d{1,2})\s*$/.exec(text)
  if (!match) return null
  const minutes = match[1] === undefined ? 0 : Number(match[1])
  const seconds = Number(match[2])
  if (match[1] !== undefined && seconds >= 60) return null
  return (minutes * 60 + seconds) * 1000
}

/** Played time for a clock reading as the game shows it. Null when outside the period. */
export function hockeyElapsedFromDisplay(period: HockeyPlaceablePeriod, displayMs: number): number | null {
  const elapsed = period.countDown ? period.durationMs - displayMs : displayMs
  return elapsed < 0 || elapsed > period.durationMs ? null : elapsed
}

/** The clock reading the game shows at a played time. */
export function hockeyDisplayFromElapsed(period: HockeyPlaceablePeriod, elapsedMs: number): number {
  return period.countDown ? period.durationMs - elapsedMs : elapsedMs
}

/**
 * Faceoff dots named for the period they are placed in: the end dots by the side defending
 * that end, top and bottom as the rink is drawn unflipped.
 */
export function hockeyFaceoffDotLabel(
  dotId: HockeyFaceoffDotId,
  direction: HockeyAttackingDirection | null,
  labels: HockeySideLabels
): string {
  if (dotId === 'center') return 'Center ice'
  const [end, zone, edge] = dotId.split('_') as ['left' | 'right', 'end' | 'neutral', 'upper' | 'lower']
  const place = edge === 'upper' ? 'top' : 'bottom'
  const defending = direction === null
    ? null
    : (end === 'left') === (direction === 'left_to_right') ? labels.tracked : labels.opponent
  const sideName = defending ?? (end === 'left' ? 'Left' : 'Right')
  return zone === 'end' ? `${sideName} end, ${place}` : `Neutral zone, ${sideName} side, ${place}`
}

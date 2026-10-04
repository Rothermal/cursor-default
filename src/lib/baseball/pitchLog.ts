import type { GameEvent } from '../gameEvents/types'
import { baseballBoxScore } from './boxScore'
import { baseballPitchPadDisplay } from './diamondGeometry'
import { parseBaseballPeriod, formatBaseballHalf } from './periods'
import { replayBaseballPitches } from './projector'
import { baseballPitchCountAlert, baseballPersonLabel, type BaseballPitcherCount } from './trackerView'
import type {
  BaseballBatHand,
  BaseballPitchLocation,
  BaseballPitchPayload,
  BaseballPitchResult,
  BaseballSportGameState,
  BaseballTeamSide,
} from './types'
import { groupBaseballUnits } from './units'

/**
 * The Summary's Pitches tab (BSB-5C): every recorded pitch with the count before it, a
 * catcher's-view plot of the located ones, and pitch counts per pitcher. Totals keep the
 * shipped contract: they are the projection's `pitchingLines`, the same numbers the
 * tracker shows and checks against the profile's warnings and limit.
 */

/** Plot colors and the result filter group the pad's results into six kinds. */
export type BaseballPitchKind = 'ball' | 'called_strike' | 'swinging_strike' | 'foul' | 'in_play' | 'hit_by_pitch'

export const BASEBALL_PITCH_KINDS: ReadonlyArray<{ kind: BaseballPitchKind; label: string }> = [
  { kind: 'ball', label: 'Ball' },
  { kind: 'called_strike', label: 'Called strike' },
  { kind: 'swinging_strike', label: 'Swinging strike' },
  { kind: 'foul', label: 'Foul' },
  { kind: 'in_play', label: 'In play' },
  { kind: 'hit_by_pitch', label: 'HBP' },
]

const KIND_BY_RESULT: Record<BaseballPitchResult, BaseballPitchKind> = {
  ball: 'ball',
  intentional_ball: 'ball',
  pitchout: 'ball',
  called_strike: 'called_strike',
  swinging_strike: 'swinging_strike',
  foul_tip: 'swinging_strike',
  missed_bunt: 'swinging_strike',
  foul: 'foul',
  foul_bunt: 'foul',
  in_play: 'in_play',
  hit_by_pitch: 'hit_by_pitch',
}

export function baseballPitchKind(result: BaseballPitchResult): BaseballPitchKind {
  return KIND_BY_RESULT[result]
}

export interface BaseballPitchLogEntry {
  eventId: string
  /** Its capture unit's first event id, which opens the play details. */
  playId: string
  /** "Top 3" */
  halfLabel: string
  /** The fielding side, whose pitcher threw it. */
  side: BaseballTeamSide
  pitcherId: string | null
  batterId: string | null
  batterHand: BaseballBatHand | null
  /** The count before the pitch, "1-2". */
  count: string
  result: BaseballPitchResult
  kind: BaseballPitchKind
  location: BaseballPitchLocation | null
}

export function baseballPitchLog(sport: BaseballSportGameState, events: readonly GameEvent[]): BaseballPitchLogEntry[] {
  const byId = new Map(events.map(event => [event.id, event]))
  const unitOf = new Map<string, string>()
  for (const unit of groupBaseballUnits(events)) for (const event of unit) unitOf.set(event.id, unit[0].id)
  return replayBaseballPitches(sport.setup, events).flatMap(pitch => {
    const event = byId.get(pitch.eventId)
    if (!event) return []
    const payload = event.payload as BaseballPitchPayload
    const period = parseBaseballPeriod(event.period)
    return [{
      eventId: pitch.eventId,
      playId: unitOf.get(pitch.eventId) ?? pitch.eventId,
      halfLabel: period ? formatBaseballHalf(period.inning, period.half) : '',
      side: pitch.battingSide === 'tracked' ? 'opponent' : 'tracked',
      pitcherId: pitch.pitcherId,
      batterId: pitch.batterId,
      batterHand: pitch.batterHand,
      count: `${pitch.balls}-${pitch.strikes}`,
      result: payload.result,
      kind: baseballPitchKind(payload.result),
      location: payload.pitchLocation ?? null,
    }]
  })
}

export interface BaseballPitchFilter {
  pitcherId: 'all' | string
  kind: 'all' | BaseballPitchKind
  /** "unknown" keeps pitches to batters whose hand was not recorded. */
  batterHand: 'all' | BaseballBatHand | 'unknown'
  count: 'all' | string
}

export const BASEBALL_PITCH_DEFAULT_FILTER: BaseballPitchFilter = {
  pitcherId: 'all',
  kind: 'all',
  batterHand: 'all',
  count: 'all',
}

export interface BaseballPitchPlotPoint {
  eventId: string
  playId: string
  x: number
  y: number
  kind: BaseballPitchKind
  /** The pitch's number in the game's pitch log, from 1. */
  sequence: number
  /** "#12 Lee to #4 Kim, 1-2: Called strike" */
  label: string
  /** "Top 1 · Pitch 3 · 0-2 · Foul", which tells pitches at one spot apart. */
  context: string
}

/**
 * Marks drawn at one spot. Pitches closer than the overlap distance share one mark, so a
 * tap never lands on only the topmost of several; a mark with more than one pitch opens a
 * chooser listing them in game order.
 */
export interface BaseballPitchPlotCluster {
  /** The first pitch's event id. */
  id: string
  /** Display position (0..1) of the first pitch. */
  x: number
  y: number
  /** In game order; the last one is drawn on top. */
  points: BaseballPitchPlotPoint[]
}

/** Display distance (pad frame 0..1) under which marks share a spot; the tap target's radius. */
export const BASEBALL_PITCH_PLOT_OVERLAP = 0.05

export interface BaseballPitchPlot {
  points: BaseballPitchPlotPoint[]
  /** The points grouped by spot, in order of each group's first pitch. */
  clusters: BaseballPitchPlotCluster[]
  /** Recorded pitches the filter keeps that have no location. */
  unlocated: number
  /** Pitchers with a recorded pitch, both teams, for the pitcher filter. */
  pitchers: Array<{ id: string; name: string; side: BaseballTeamSide }>
  /** Counts that occur, in count order, for the count filter. */
  counts: string[]
}

const RESULT_LABELS: Record<BaseballPitchResult, string> = {
  ball: 'Ball',
  intentional_ball: 'Intentional ball',
  pitchout: 'Pitchout',
  called_strike: 'Called strike',
  swinging_strike: 'Swinging strike',
  foul_tip: 'Foul tip',
  missed_bunt: 'Missed bunt',
  foul: 'Foul',
  foul_bunt: 'Foul bunt',
  in_play: 'In play',
  hit_by_pitch: 'Hit by pitch',
}

export function baseballPitchPlot(
  sport: BaseballSportGameState,
  log: readonly BaseballPitchLogEntry[],
  filter: BaseballPitchFilter = BASEBALL_PITCH_DEFAULT_FILTER
): BaseballPitchPlot {
  const name = (id: string | null) => (id ? baseballPersonLabel(sport, id).name : 'Unknown')
  const pitchers = log
    .filter((entry, index) => entry.pitcherId && log.findIndex(other => other.pitcherId === entry.pitcherId) === index)
    .map(entry => ({ id: entry.pitcherId!, name: name(entry.pitcherId), side: entry.side }))
  const counts = [...new Set(log.map(entry => entry.count))].sort()
  const sequence = new Map(log.map((entry, index) => [entry.eventId, index + 1]))
  const kept = log.filter(entry =>
    (filter.pitcherId === 'all' || entry.pitcherId === filter.pitcherId) &&
    (filter.kind === 'all' || entry.kind === filter.kind) &&
    (filter.batterHand === 'all' || (entry.batterHand ?? 'unknown') === filter.batterHand) &&
    (filter.count === 'all' || entry.count === filter.count)
  )
  const points: BaseballPitchPlotPoint[] = kept.flatMap(entry => entry.location ? [{
    eventId: entry.eventId,
    playId: entry.playId,
    x: entry.location.x,
    y: entry.location.y,
    kind: entry.kind,
    sequence: sequence.get(entry.eventId)!,
    label: `${name(entry.pitcherId)} to ${name(entry.batterId)}, ${entry.count}: ${RESULT_LABELS[entry.result]}`,
    context: [entry.halfLabel, `Pitch ${sequence.get(entry.eventId)}`, entry.count, RESULT_LABELS[entry.result]]
      .filter(Boolean)
      .join(' · '),
  }] : [])
  return {
    points,
    clusters: baseballPitchPlotClusters(points),
    unlocated: kept.filter(entry => !entry.location).length,
    pitchers,
    counts,
  }
}

/**
 * Groups points by spot in game order: each point joins the first group whose first pitch
 * is within the overlap distance, so the same filtered pitches always group the same way.
 */
export function baseballPitchPlotClusters(points: readonly BaseballPitchPlotPoint[]): BaseballPitchPlotCluster[] {
  const clusters: BaseballPitchPlotCluster[] = []
  for (const point of points) {
    const display = baseballPitchPadDisplay({ x: point.x, y: point.y })
    const near = clusters.find(cluster =>
      Math.hypot(cluster.x - display.x, cluster.y - display.y) < BASEBALL_PITCH_PLOT_OVERLAP
    )
    if (near) near.points.push(point)
    else clusters.push({ id: point.eventId, x: display.x, y: display.y, points: [point] })
  }
  return clusters
}

export interface BaseballPitchCountRow {
  id: string
  name: string
  /** The projection total: recorded pitches plus the Quick PA estimate. */
  pitches: number
  strikes: number
  balls: number
  battersFaced: number
  /** Whole percent, or null before a pitch. */
  strikePercent: number | null
  /** Pitch events, which the pitch log lists. */
  recorded: number
  /** Total minus recorded: pitches the Quick PA final counts add. */
  estimated: number
  /** Plate appearances entered with Quick PA. */
  untrackedPlateAppearances: number
  /** Recorded pitches without a zone location. */
  unlocated: number
  /** The total includes Quick PA plate appearances, so it is a lower bound ("≥"). */
  lowerBound: boolean
  alert: BaseballPitcherCount['alert']
}

export interface BaseballPitchCounts {
  side: BaseballTeamSide
  rows: BaseballPitchCountRow[]
}

/** One row per pitcher who appeared, both teams, in the box score's mound order. */
export function baseballPitchCounts(
  sport: BaseballSportGameState,
  events: readonly GameEvent[],
  log: readonly BaseballPitchLogEntry[]
): BaseballPitchCounts[] {
  const box = baseballBoxScore(sport, events)
  return (['tracked', 'opponent'] as const).map(side => ({
    side,
    rows: box.pitching[side].rows.map(row => {
      const thrown = log.filter(entry => entry.pitcherId === row.id)
      const { pitches, strikes, balls, bf, untrackedPlateAppearances } = row.line
      return {
        id: row.id,
        name: row.name,
        pitches,
        strikes,
        balls,
        battersFaced: bf,
        strikePercent: pitches > 0 ? Math.round((strikes / pitches) * 100) : null,
        recorded: thrown.length,
        estimated: Math.max(0, pitches - thrown.length),
        untrackedPlateAppearances,
        unlocated: thrown.filter(entry => !entry.location).length,
        lowerBound: untrackedPlateAppearances > 0,
        alert: baseballPitchCountAlert(sport.setup.rulesSnapshot, pitches),
      }
    }),
  }))
}

import type { GameEvent } from '../gameEvents/types'
import { baseballPeriod, formatBaseballHalf, parseBaseballPeriod } from './periods'
import { replayBaseballCreditByEvent, replayBaseballRunsByEvent } from './projector'
import { baseballEventLabel, type BaseballSideNames } from './recentPlays'
import { BASEBALL_MORE_PITCH_RESULTS, BASEBALL_PRIMARY_PITCH_RESULTS, baseballPersonLabel } from './trackerView'
import type { BaseballHalf, BaseballPlateAppearanceOutcome, BaseballSportGameState, BaseballTeamSide } from './types'
import { groupBaseballUnits, isBaseballCaptureEvent } from './units'

/**
 * The Summary's Plays tab (BSB-5B): every active capture unit, oldest first, grouped by
 * half-inning with each half's line. Read-only; corrections stay on the tracker's Timeline.
 * Pitches that only change the count fold into the row of the plate appearance they belong
 * to, so a half reads one line per batter instead of one per pitch.
 */

const PITCH_LABELS = Object.fromEntries(
  [...BASEBALL_PRIMARY_PITCH_RESULTS, ...BASEBALL_MORE_PITCH_RESULTS].map(option => [option.result, option.label])
) as Record<string, string>

/** Outcomes a pitch ends without a ball in play; the pitch's own label would hide them. */
const PITCH_OUTCOME_LABELS: Partial<Record<BaseballPlateAppearanceOutcome, string>> = {
  walk: 'Walk',
  intentional_walk: 'Intentional walk',
  hit_by_pitch: 'Hit by pitch',
  strikeout: 'Strikeout',
  catcher_interference: "Catcher's interference",
}

export interface BaseballSummaryPlayRow {
  /** The unit's first event id, which opens the play details. */
  id: string
  /** Plays open their details; game-flow rows (changes, endings) do not. */
  kind: 'play' | 'flow'
  label: string
  /** Runs the replay credited to this unit. */
  runs: number
  warning: string | null
  /** Earlier pitches of this plate appearance, oldest first ("Ball", "Foul"). */
  pitches: string[]
  /**
   * The batter stamped when a pitch in this row was recorded, when the replayed lineup now
   * credits someone else (after a lineup correction). The label names the credited batter.
   */
  recordedBatter: string | null
}

export interface BaseballSummaryPlayHalf {
  key: string
  label: string
  battingSide: BaseballTeamSide
  /** "2 R, 3 H, 1 E, 2 LOB", or null before the half has a line. */
  line: string | null
  rows: BaseballSummaryPlayRow[]
}

export interface BaseballSummaryPlays {
  halves: BaseballSummaryPlayHalf[]
  scoringPlays: number
}

export function baseballSummaryPlays(
  sport: BaseballSportGameState,
  events: readonly GameEvent[],
  names: BaseballSideNames,
  options: { scoringOnly?: boolean } = {}
): BaseballSummaryPlays {
  const scored = replayBaseballRunsByEvent(sport.setup, events)
  // Grouping and names follow the replayed batter, not the stamp, so a corrected lineup
  // regroups the plate appearance the same way the batting lines credit it.
  const credit = replayBaseballCreditByEvent(sport.setup, events)
  const batterOf = (event: GameEvent) => credit.get(event.id)?.batterId ?? null
  const warnings = new Map<string, string>()
  for (const warning of sport.projection.warnings) {
    if (!warnings.has(warning.eventId)) warnings.set(warning.eventId, warning.message)
  }
  const halves = new Map<string, BaseballSummaryPlayHalf & { order: number }>()
  let scoringPlays = 0
  const outcomes = new Map(sport.projection.plateAppearances.map(record => [record.eventId, record.outcome]))
  // Count-only pitches wait here for the row that finishes their plate appearance.
  type Pending = { half: string; batterId: string | null; units: GameEvent[][] }
  let pending: Pending | null = null
  const rows: Array<{ half: BaseballSummaryPlayHalf & { order: number }; row: BaseballSummaryPlayRow }> = []
  const flush = () => {
    if (!pending) return
    for (const unit of pending.units) rows.push(rowFor(unit, []))
    pending = null
  }
  const rowFor = (unit: GameEvent[], folded: GameEvent[][]) => {
    const first = unit[0]
    const period = parseBaseballPeriod(first.period)!
    const credited = unit.flatMap(event => scored.get(event.id) ?? [])
    const outcome = unit.length === 1 && first.eventType === 'baseball.pitch' ? outcomes.get(first.id) : undefined
    const outcomeLabel = outcome ? PITCH_OUTCOME_LABELS[outcome] : undefined
    const batterId = batterOf(first)
    const label = outcomeLabel
      ? `${batterId ? `${baseballPersonLabel(sport, batterId).name}: ` : ''}${outcomeLabel}${runsText(credited.length)}`
      : unit.map(event => baseballEventLabel(sport, withCreditedBatter(event, batterOf(event)), names, scored.get(event.id) ?? [])).join(' + ')
    const all = [...folded.flat(), ...unit]
    const recorded = all
      .map(event => stampedBatter(event))
      .find(id => id !== null && batterId !== null && id !== batterId) ?? null
    return {
      half: halfGroup(halves, sport, period.inning, period.half),
      row: {
        id: first.id,
        kind: isBaseballCaptureEvent(first) ? 'play' as const : 'flow' as const,
        label,
        runs: credited.length,
        // A folded pitch keeps its diagnostic on the row that now shows it.
        warning: all.map(event => warnings.get(event.id)).find(Boolean) ?? null,
        pitches: folded.map(entry => PITCH_LABELS[(entry[0].payload as { result: string }).result] ?? 'Pitch'),
        recordedBatter: recorded ? baseballPersonLabel(sport, recorded).name : null,
      },
    }
  }
  for (const unit of groupBaseballUnits(events)) {
    const first = unit[0]
    // The game start opens the record but is not a play anyone reads back.
    if (first.eventType === 'baseball.game_started') continue
    if (!parseBaseballPeriod(first.period)) continue
    const batterId = batterOf(first)
    if (pending && (pending.half !== first.period.id || (batterId !== null && pending.batterId !== batterId))) flush()
    if (countOnlyPitch(unit, outcomes, scored)) {
      const group: Pending = pending ?? { half: first.period.id, batterId, units: [] }
      group.units.push(unit)
      pending = group
      continue
    }
    const folds = pending && batterId !== null && pending.batterId === batterId && isBaseballCaptureEvent(first) &&
      first.eventType !== 'baseball.baserunning' && first.eventType !== 'baseball.substitution'
    if (folds && pending) {
      const folded = pending.units
      pending = null
      rows.push(rowFor(unit, folded))
    } else {
      // A runner play or change in the middle of a plate appearance keeps the pitches before it as rows.
      flush()
      rows.push(rowFor(unit, []))
    }
  }
  flush()
  for (const { half, row } of rows) {
    if (row.runs > 0) scoringPlays += 1
    if (options.scoringOnly && row.runs === 0) continue
    half.rows.push(row)
  }
  if (options.scoringOnly) for (const [key, half] of halves) if (half.rows.length === 0) halves.delete(key)
  return {
    halves: [...halves.values()]
      .sort((a, b) => a.order - b.order)
      .map(half => ({ key: half.key, label: half.label, battingSide: half.battingSide, line: half.line, rows: half.rows })),
    scoringPlays,
  }
}

function halfGroup(
  halves: Map<string, BaseballSummaryPlayHalf & { order: number }>,
  sport: BaseballSportGameState,
  inning: number,
  half: BaseballHalf
): BaseballSummaryPlayHalf & { order: number } {
  const period = baseballPeriod(inning, half)
  let group = halves.get(period.id)
  if (!group) {
    const line = sport.projection.lineScore.find(entry => entry.inning === inning && entry.half === half)
    const awayBats = half === 'top'
    group = {
      key: period.id,
      order: period.order,
      label: formatBaseballHalf(inning, half),
      battingSide: (sport.setup.trackedSide === 'away') === awayBats ? 'tracked' : 'opponent',
      line: line ? `${line.runs} R, ${line.hits} H, ${line.errors} E, ${line.leftOnBase} LOB` : null,
      rows: [],
    }
    halves.set(period.id, group)
  }
  return group
}

function stampedBatter(event: GameEvent): string | null {
  return event.actors.find(actor => actor.role === 'batter')?.participantId ?? null
}

/** A display-only copy naming the batter the replay credits; the stored event is unchanged. */
function withCreditedBatter(event: GameEvent, batterId: string | null): GameEvent {
  const stamped = stampedBatter(event)
  if (!batterId || !stamped || stamped === batterId) return event
  return {
    ...event,
    actors: event.actors.map(actor => (actor.role === 'batter' ? { ...actor, participantId: batterId } : actor)),
  }
}

/** A single pitch that changed only the count: no plate appearance ended, no runner moved. */
function countOnlyPitch(
  unit: readonly GameEvent[],
  outcomes: ReadonlyMap<string, BaseballPlateAppearanceOutcome>,
  scored: ReadonlyMap<string, readonly string[]>
): boolean {
  if (unit.length !== 1) return false
  const [event] = unit
  if (event.eventType !== 'baseball.pitch' || outcomes.has(event.id) || (scored.get(event.id)?.length ?? 0) > 0) return false
  const movements = (event.payload as { movements?: unknown[] }).movements
  return !movements || movements.length === 0
}

function runsText(count: number): string {
  return count === 0 ? '' : count === 1 ? ', 1 run scores' : `, ${count} runs score`
}

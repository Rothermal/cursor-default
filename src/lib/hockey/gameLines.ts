import type { GameEvent } from '../gameEvents/types'
import { replayHockeyEvents, type HockeyReplayOutput } from './projector'
import type {
  HockeyEvent,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyPeriodRecord,
  HockeySide,
  HockeyStrength,
} from './types'

/**
 * Per-game lines (HKY-6 §3): the derivations the replayed totals cannot answer alone, shared
 * by the Summary and the season aggregates. Every value comes from one replay of the active
 * events, so a correction re-derives every line. Nothing here is persisted.
 */

/** Per-game stat ids added on top of the `hky_*` catalog. */
export const HOCKEY_GAME_LINE_STAT_IDS = [
  'hky_gp',
  'hky_gs',
  'hky_eng',
  'hky_gwg',
  'hky_w',
  'hky_l',
  'hky_otl',
  'hky_t',
  'hky_so',
  'hky_toi_ms',
] as const

/** Shootout lines: match-scoped, shown in the Summary and never summed into season totals. */
export const HOCKEY_SHOOTOUT_LINE_STAT_IDS = ['hky_so_att', 'hky_so_g', 'hky_so_sa', 'hky_so_sv'] as const

export interface HockeyScore {
  tracked: number
  opponent: number
}

/** One bundle in, so every source reaches the lines the same way (§3). */
export interface HockeyGameLinesInput {
  setup: HockeyMatchSetup
  replay: HockeyReplayOutput
  /** The active events in Hockey replay order (placement applied), as replay visited them. */
  events: GameEvent[]
  /** The score just before each goal, by shot event id, from the same replay pass. */
  scoreBeforeGoal: Record<string, HockeyScore>
}

/** Runs the one replay pass the lines read: totals, replay order and the score before each goal. */
export function hockeyGameLinesInput(setup: HockeyMatchSetup, activeEvents: readonly GameEvent[]): HockeyGameLinesInput {
  const events: GameEvent[] = []
  const scoreBeforeGoal: Record<string, HockeyScore> = {}
  const replay = replayHockeyEvents(setup, activeEvents, (event, projection) => {
    events.push(event)
    if (event.eventType === 'hockey.shot' && (event.payload as { outcome?: string }).outcome === 'goal') {
      scoreBeforeGoal[event.id] = { ...projection.score }
    }
  })
  return { setup, replay, events, scoreBeforeGoal }
}

export type HockeyGoalStrengthLabel = 'EV' | 'PP' | 'SH' | 'EN' | 'PS' | null

export interface HockeyGoalLine {
  eventId: string
  side: HockeySide
  periodId: string
  elapsedMs: number | null
  strength: HockeyStrength | null
  emptyNet: boolean
  penaltyShot: boolean
  /** Tracked participant ids; null when the goal is unattributed or by the opponent. */
  shooterParticipantId: string | null
  shooterLabel: string | null
  assists: Array<{ participantId: string | null; label: string | null }>
  scoreAfter: HockeyScore
  gameWinning: boolean
}

export type HockeyGameWinningGoalCoverage = 'attributed' | 'unattributed' | 'none'
export type HockeyTimeInNetCoverage = 'complete' | 'incomplete'

export interface HockeyGoalieTimeLine {
  ms: number
  coverage: HockeyTimeInNetCoverage
}

export interface HockeyGameLines {
  /** Each tracked participant: the catalog stats plus the per-game and shootout ids. */
  participants: Record<string, Record<string, number>>
  /** Goals in replay order with the score after each. */
  goals: HockeyGoalLine[]
  gameWinningGoalEventId: string | null
  coverage: {
    /** Complete when every goal had a complete on-ice set and a strength. */
    plusMinus: 'complete' | 'partial'
    plusMinusSkippedGoals: number
    gameWinningGoal: HockeyGameWinningGoalCoverage
    /** Null for a clockless game: time in net is not recorded. */
    timeInNet: HockeyTimeInNetCoverage | null
  }
  /** Time in net by goalie id (tracked participants and opponent goalies); anchored games only. */
  goalieTime: Record<string, HockeyGoalieTimeLine> | null
  /** Goalie ids with any interval, by side, in first-appearance order. */
  goaliesInNet: Record<HockeySide, string[]>
}

/**
 * Derives the lines from a complete replay; null when replay stopped on an invalid event,
 * because an unhealthy stream has no official totals.
 */
export function deriveHockeyGameLines(input: HockeyGameLinesInput): HockeyGameLines | null {
  const { setup, replay, events } = input
  if (replay.diagnostics.length > 0) return null
  const projection = replay.projection
  const participants: Record<string, Record<string, number>> = {}
  for (const participant of setup.participants) {
    const line: Record<string, number> = { ...(replay.participantStats[participant.id] ?? {}) }
    for (const id of HOCKEY_GAME_LINE_STAT_IDS) line[id] = 0
    if (projection.shootout) for (const id of HOCKEY_SHOOTOUT_LINE_STAT_IDS) line[id] = 0
    participants[participant.id] = line
  }
  const add = (participantId: string | null, statId: string, amount = 1) => {
    if (participantId && participants[participantId]) participants[participantId][statId] += amount
  }

  const goaliesInNet = goaliesByAppearance(projection)

  // Games played and started (§7 Q7: a goalie needs time in net).
  for (const participant of setup.participants) {
    if (participant.dressedAs === 'skater' || goaliesInNet.tracked.includes(participant.id)) add(participant.id, 'hky_gp')
  }
  add(setup.openingLineup.goalieParticipantId, 'hky_gs')

  const goalShots = events.filter(
    (event): event is HockeyEvent<'hockey.shot'> =>
      event.eventType === 'hockey.shot' && (event as HockeyEvent<'hockey.shot'>).payload.outcome === 'goal'
  )
  for (const shot of goalShots) {
    if (shot.teamSide === 'tracked' && shot.payload.emptyNet) add(actor(shot, 'shooter')?.participantId ?? null, 'hky_eng')
  }

  const winning = gameWinningGoal(input, goalShots)
  if (winning.coverage === 'attributed') add(winning.shooterParticipantId, 'hky_gwg')

  // Decisions, from the goalie of record and the result.
  const result = projection.result
  if (result) {
    if (result.outcome === 'win') add(projection.goalieOfRecord, 'hky_w')
    else if (result.outcome === 'loss') add(projection.goalieOfRecord, result.decidedIn === 'regulation' ? 'hky_l' : 'hky_otl')
    else add(trackedGoalieAtEnd(projection), 'hky_t')
    // A shutout: one tracked goalie all game, and no opponent regulation or overtime goal.
    if (projection.score.opponent === 0 && goaliesInNet.tracked.length === 1) add(goaliesInNet.tracked[0], 'hky_so')
  }

  const time = setup.rulesSnapshot.clockModel === 'anchored' ? goalieTimeInNet(projection) : null
  if (time) {
    for (const [goalieId, line] of Object.entries(time)) add(goalieId, 'hky_toi_ms', line.ms)
  }

  if (projection.shootout) {
    for (const attempt of projection.shootout.attempts) {
      if (attempt.side === 'tracked') {
        add(attempt.shooterParticipantId, 'hky_so_att')
        if (attempt.outcome === 'goal') add(attempt.shooterParticipantId, 'hky_so_g')
      } else if (attempt.outcome !== 'missed') {
        add(attempt.goalieId, 'hky_so_sa')
        if (attempt.outcome === 'saved') add(attempt.goalieId, 'hky_so_sv')
      }
    }
  }

  const goals: HockeyGoalLine[] = goalShots.map(shot => {
    const before = input.scoreBeforeGoal[shot.id] ?? { tracked: 0, opponent: 0 }
    const shooter = actor(shot, 'shooter')
    return {
      eventId: shot.id,
      side: shot.teamSide,
      periodId: shot.period.id,
      elapsedMs: shot.elapsedMs,
      strength: shot.payload.strength,
      emptyNet: shot.payload.emptyNet,
      penaltyShot: shot.payload.penaltyShot,
      shooterParticipantId: shot.teamSide === 'tracked' ? shooter?.participantId ?? null : null,
      shooterLabel: shooter?.label ?? null,
      assists: (['assist_primary', 'assist_secondary'] as const).flatMap(role => {
        const assist = actor(shot, role)
        return assist ? [{ participantId: shot.teamSide === 'tracked' ? assist.participantId ?? null : null, label: assist.label ?? null }] : []
      }),
      scoreAfter: { ...before, [shot.teamSide]: before[shot.teamSide] + 1 },
      gameWinning: shot.id === winning.eventId,
    }
  })

  const timeCoverage = time
    ? goaliesInNet.tracked.every(id => time[id]?.coverage === 'complete') ? 'complete' : 'incomplete'
    : null
  return {
    participants,
    goals,
    gameWinningGoalEventId: winning.eventId,
    coverage: {
      plusMinus: projection.plusMinusSkippedGoalIds.length === 0 ? 'complete' : 'partial',
      plusMinusSkippedGoals: projection.plusMinusSkippedGoalIds.length,
      gameWinningGoal: winning.coverage,
      timeInNet: timeCoverage,
    },
    goalieTime: time,
    goaliesInNet,
  }
}

/** The display label for a goal's strength: empty net and penalty shot first, then the stored strength. */
export function hockeyGoalStrengthLabel(goal: Pick<HockeyGoalLine, 'emptyNet' | 'penaltyShot' | 'strength'>): HockeyGoalStrengthLabel {
  if (goal.penaltyShot) return 'PS'
  if (goal.emptyNet) return 'EN'
  if (goal.strength === 'pp') return 'PP'
  if (goal.strength === 'sh') return 'SH'
  if (goal.strength === 'ev') return 'EV'
  return null
}

interface HockeyGameWinningGoal {
  eventId: string | null
  shooterParticipantId: string | null
  coverage: HockeyGameWinningGoalCoverage
}

/**
 * The winner's goal that made its score one more than the loser's final regulation and
 * overtime total. None for a tie, a shootout or an opponent win (no tracked player can get
 * it); unattributed when that goal has no tracked shooter or a score adjustment changed a
 * total, because then the goal that decided the game is not known.
 */
function gameWinningGoal(input: HockeyGameLinesInput, goals: HockeyEvent<'hockey.shot'>[]): HockeyGameWinningGoal {
  const none: HockeyGameWinningGoal = { eventId: null, shooterParticipantId: null, coverage: 'none' }
  const result = input.replay.projection.result
  if (!result || result.outcome === 'tie' || result.decidedIn === 'shootout') return none
  const winner: HockeySide = result.outcome === 'win' ? 'tracked' : 'opponent'
  const loser: HockeySide = winner === 'tracked' ? 'opponent' : 'tracked'
  const adjusted = input.events.some(event => event.eventType === 'hockey.score_adjustment')
  if (adjusted) return winner === 'tracked' ? { ...none, coverage: 'unattributed' } : none
  const loserTotal = input.replay.projection.score[loser]
  const goal = goals.find(shot => shot.teamSide === winner && input.scoreBeforeGoal[shot.id]?.[winner] === loserTotal)
  if (!goal) return winner === 'tracked' ? { ...none, coverage: 'unattributed' } : none
  if (winner === 'opponent') return { ...none, eventId: goal.id }
  const shooter = actor(goal, 'shooter')?.participantId ?? null
  return shooter
    ? { eventId: goal.id, shooterParticipantId: shooter, coverage: 'attributed' }
    : { eventId: goal.id, shooterParticipantId: null, coverage: 'unattributed' }
}

function goaliesByAppearance(projection: HockeyMatchProjection): Record<HockeySide, string[]> {
  const seen: Record<HockeySide, string[]> = { tracked: [], opponent: [] }
  for (const interval of projection.goalieIntervals) {
    if (interval.participantId && !seen[interval.side].includes(interval.participantId)) {
      seen[interval.side].push(interval.participantId)
    }
  }
  return seen
}

/** The tracked goalie in net at the end, or the last one in net when the goalie was pulled. */
function trackedGoalieAtEnd(projection: HockeyMatchProjection): string | null {
  if (projection.goalieInNet.tracked) return projection.goalieInNet.tracked
  const last = [...projection.goalieIntervals].reverse().find(entry => entry.side === 'tracked' && entry.participantId)
  return last?.participantId ?? null
}

interface GamePosition {
  periodIndex: number
  elapsedMs: number
}

/**
 * Time in net for an anchored game, from the goalie change markers (§3 `hky_toi_ms`):
 *
 * - a stint runs from its change to the side's next change, or to the end of the game;
 * - a change made between periods takes effect when the next period starts;
 * - each period counts only the time played in it: its clock at the period end, so a period
 *   ended early counts up to that time;
 * - an empty net (a pulled goalie) is a stint credited to nobody;
 * - positions are clock times after any clock correction, so a corrected clock moves the
 *   stints with it.
 *
 * A total is incomplete when the game is still in progress or suspended, the clock was left
 * running, or a change sits earlier than the change before it (a clock set back behind an
 * earlier change), because then the stints cannot be closed reliably.
 */
function goalieTimeInNet(projection: HockeyMatchProjection): Record<string, HockeyGoalieTimeLine> {
  const periods = projection.periods
  const indexById = new Map(periods.map((period, index) => [period.id, index]))
  const unsettled = projection.status === 'in_progress' || projection.status === 'suspended' ||
    projection.status === 'pregame' || projection.clock?.running === true
  const played = (period: HockeyPeriodRecord): number => {
    if (period.endedAtElapsedMs !== null) return period.endedAtElapsedMs
    if (projection.activePeriodId === period.id && projection.clock) return projection.clock.elapsedMs
    return 0
  }
  const position = (periodId: string, elapsedMs: number | null): GamePosition => {
    const index = indexById.get(periodId)
    if (index === undefined) return { periodIndex: periods.length, elapsedMs: 0 }
    return elapsedMs === null ? { periodIndex: index + 1, elapsedMs: 0 } : { periodIndex: index, elapsedMs }
  }
  const before = (a: GamePosition, b: GamePosition) =>
    a.periodIndex < b.periodIndex || (a.periodIndex === b.periodIndex && a.elapsedMs < b.elapsedMs)
  const span = (from: GamePosition, to: GamePosition | null): number => {
    let total = 0
    const last = to ? Math.min(to.periodIndex, periods.length - 1) : periods.length - 1
    for (let index = from.periodIndex; index <= last; index++) {
      const length = played(periods[index])
      const start = index === from.periodIndex ? Math.min(from.elapsedMs, length) : 0
      const end = to && index === to.periodIndex ? Math.min(to.elapsedMs, length) : length
      total += Math.max(0, end - start)
    }
    return total
  }

  const lines: Record<string, HockeyGoalieTimeLine> = {}
  for (const side of ['tracked', 'opponent'] as const) {
    const stints = projection.goalieIntervals
      .filter(interval => interval.side === side)
      .map(interval => ({ participantId: interval.participantId, at: position(interval.periodId, interval.elapsedMs) }))
    let ordered = !unsettled
    for (let index = 0; index < stints.length; index++) {
      const stint = stints[index]
      const next = stints[index + 1] ?? null
      if (next && before(next.at, stint.at)) ordered = false
      if (!stint.participantId) continue
      const line = lines[stint.participantId] ?? { ms: 0, coverage: 'complete' as HockeyTimeInNetCoverage }
      line.ms += next && before(next.at, stint.at) ? 0 : span(stint.at, next?.at ?? null)
      lines[stint.participantId] = line
    }
    if (!ordered) {
      for (const stint of stints) if (stint.participantId) lines[stint.participantId].coverage = 'incomplete'
    }
  }
  return lines
}

function actor(event: GameEvent, role: string) {
  return event.actors.find(entry => entry.role === role) ?? null
}

import type { GameState } from '../../types'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type {
  GameEvent,
  GameEventDiagnostic,
  SportGameEventProjectionResult,
  SportGameEventProjector,
} from '../gameEvents/types'
import { checkHockeyGoalieChange, checkHockeyOnIce, checkHockeyShotActors, otherHockeySide } from './captureProjection'
import { hockeyPeriod, hockeyPeriodDurationMs, parseHockeyPeriod } from './periods'
import { hockeyOvertimeSuddenDeath } from './rules'
import { hockeyTrackedAttackingDirection } from './setup'
import { createHockeyMatchProjection } from './state'
import {
  accumulateHockeyShotStats,
  emptyHockeyParticipantStats,
  hockeyPlayerStatsById,
  type HockeyParticipantStats,
} from './stats'
import type {
  HockeyClockProjection,
  HockeyEvent,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyPeriodRecord,
  HockeyPeriodRef,
  HockeySide,
  HockeySportGameState,
} from './types'

export class HockeyReplayError extends Error {}

export interface HockeyReplayOutput {
  projection: HockeyMatchProjection
  diagnostics: GameEventDiagnostic[]
  /** Per participant; kept out of the persisted projection. */
  participantStats: HockeyParticipantStats
}

export type HockeyClockMoment =
  | { ok: true; unboundedElapsedMs: number; elapsedMs: number }
  | { ok: false; message: string }

/** Replays Hockey events in capture order and stops at the first invalid event. */
export function replayHockeyEvents(setup: HockeyMatchSetup, events: readonly GameEvent[]): HockeyReplayOutput {
  const replay = new HockeyReplay(setup)
  const ordered = [...events].sort(compareGameEventCaptureOrder)
  for (const event of ordered) {
    try {
      // Each event is checked before it mutates anything, so the projection is the valid prefix.
      replay.apply(event as HockeyEvent)
    } catch (error) {
      if (!(error instanceof HockeyReplayError)) throw error
      return {
        projection: replay.projection,
        diagnostics: [{ code: 'semantic_validation_failed', message: error.message, eventId: event.id }],
        participantStats: replay.stats,
      }
    }
  }
  return { projection: replay.projection, diagnostics: [], participantStats: replay.stats }
}

export const hockeyGameEventProjector: SportGameEventProjector = {
  sportId: 'hockey',
  requiresSportGameState: true,
  project: (state: GameState, events: GameEvent[]): SportGameEventProjectionResult => {
    const sportState = state.sportGameState
    if (!sportState || sportState.sportId !== 'hockey') {
      return {
        projection: {
          playerStatsById: {},
          homeTeamScore: state.homeTeamScore,
          opponentScore: state.opponentScore,
          shotChart: [],
        },
        diagnostics: [{ code: 'missing_authoritative_data', message: 'Hockey setup is missing.', eventId: null }],
      }
    }
    const hockey = sportState as HockeySportGameState
    const { projection, diagnostics, participantStats } = replayHockeyEvents(hockey.setup, events)
    return {
      projection: {
        playerStatsById: hockeyPlayerStatsById(hockey.setup, participantStats),
        homeTeamScore: projection.score.tracked,
        opponentScore: projection.score.opponent,
        shotChart: [],
        currentPeriod: currentPeriodOrder(projection),
        sportGameState: { ...hockey, projection },
      },
      diagnostics,
    }
  },
}

/**
 * Clock position at `occurredAt`. A running clock advances from its anchor and is
 * capped at the period length; `unboundedElapsedMs` shows whether it has expired.
 */
export function hockeyClockMomentAt(
  clock: HockeyClockProjection,
  occurredAt: string,
  durationMs: number
): HockeyClockMoment {
  if (!clock.running || clock.anchorElapsedMs === null || clock.anchorOccurredAt === null) {
    return { ok: true, unboundedElapsedMs: clock.elapsedMs, elapsedMs: clock.elapsedMs }
  }
  const targetMs = Date.parse(occurredAt)
  const anchorMs = Date.parse(clock.anchorOccurredAt)
  if (!Number.isFinite(targetMs) || !Number.isFinite(anchorMs)) {
    return { ok: false, message: 'Hockey clock timestamp is invalid.' }
  }
  const deltaMs = targetMs - anchorMs
  if (deltaMs < 0) return { ok: false, message: 'The Hockey clock cannot run backward.' }
  const unbounded = clock.anchorElapsedMs + deltaMs
  return { ok: true, unboundedElapsedMs: unbounded, elapsedMs: Math.min(unbounded, durationMs) }
}

export function hockeyActivePeriod(projection: HockeyMatchProjection): HockeyPeriodRecord | null {
  return projection.periods.find(period => period.id === projection.activePeriodId) ?? null
}

export function lastHockeyPeriod(projection: HockeyMatchProjection): HockeyPeriodRecord | null {
  return projection.periods[projection.periods.length - 1] ?? null
}

function currentPeriodOrder(projection: HockeyMatchProjection): number {
  const period = hockeyActivePeriod(projection) ?? lastHockeyPeriod(projection)
  return period?.order ?? 1
}

function fail(message: string): never {
  throw new HockeyReplayError(message)
}

/** After a sudden-death goal only these may follow, so the game can be closed or the goal corrected. */
const AFTER_DECISION = new Set<string>([
  'hockey.clock_paused',
  'hockey.period_ended',
  'hockey.match_ended',
  'hockey.match_suspended',
  'hockey.match_abandoned',
  'hockey.match_reopened',
  'hockey.score_adjustment',
])

class HockeyReplay {
  readonly projection: HockeyMatchProjection
  readonly stats: HockeyParticipantStats
  private readonly anchored: boolean

  constructor(private readonly setup: HockeyMatchSetup) {
    this.projection = createHockeyMatchProjection(setup)
    this.stats = emptyHockeyParticipantStats(setup)
    this.anchored = setup.rulesSnapshot.clockModel === 'anchored'
  }

  apply(event: HockeyEvent): void {
    if (event.sportId !== 'hockey') fail('Only Hockey events can be replayed.')
    this.checkPeriodEnvelope(event)
    this.checkElapsed(event)
    if (this.projection.decidedInPeriodId && !AFTER_DECISION.has(event.eventType)) {
      fail('A lead in sudden-death overtime decided the game. End it, or correct the score first.')
    }
    switch (event.eventType) {
      case 'hockey.opening_lineup':
        return this.openingLineup(event)
      case 'hockey.period_started':
        return this.periodStarted(event)
      case 'hockey.period_ended':
        return this.periodEnded(event)
      case 'hockey.clock_started':
      case 'hockey.clock_paused':
      case 'hockey.clock_set':
        return this.clockEvent(event)
      case 'hockey.match_ended':
        return this.matchEnded(event)
      case 'hockey.match_suspended':
      case 'hockey.match_abandoned':
        return this.matchInterrupted(event)
      case 'hockey.match_reopened':
        return this.matchReopened(event)
      case 'hockey.shot':
        return this.shot(event)
      case 'hockey.goalie_change':
        return this.goalieChange(event)
      case 'hockey.score_adjustment':
        return this.scoreAdjustment(event)
      default:
        fail('Unknown Hockey event type.')
    }
  }

  // -- envelope checks -----------------------------------------------------

  private checkPeriodEnvelope(event: HockeyEvent): void {
    if (event.eventType === 'hockey.period_started') {
      const expected = hockeyPeriod(event.payload.kind, event.payload.number)
      if (event.period.id !== expected.id || event.period.order !== expected.order) {
        fail('A period start must name the period it opens.')
      }
      return
    }
    const current = hockeyActivePeriod(this.projection) ?? lastHockeyPeriod(this.projection)
    const expected = current ? { id: current.id, order: current.order } : hockeyPeriod('regulation', 1)
    if (event.period.id !== expected.id || event.period.order !== expected.order) {
      fail('Hockey events must belong to the current period.')
    }
  }

  /** Elapsed is non-null only for anchored games inside an active period. */
  private checkElapsed(event: HockeyEvent): void {
    const p = this.projection
    if (!this.anchored) {
      if (event.elapsedMs !== null) fail('Clockless Hockey events must not carry clock time.')
      return
    }
    if (event.eventType === 'hockey.period_started') {
      if (event.elapsedMs !== 0) fail('An anchored Hockey period starts at elapsed zero.')
      return
    }
    const active = hockeyActivePeriod(p)
    if (!active || p.status !== 'in_progress') {
      if (event.elapsedMs !== null) fail('Hockey events outside a period must not carry clock time.')
      return
    }
    if (event.elapsedMs === null) fail('Anchored Hockey events need the clock time.')
    const clock = p.clock!
    // A clock set moves the paused clock; its own target is checked with the payload.
    if (event.eventType === 'hockey.clock_set') return
    const moment = hockeyClockMomentAt(clock, event.occurredAt, active.durationMs)
    if (!moment.ok) fail(moment.message)
    if (clock.running && moment.unboundedElapsedMs >= active.durationMs && event.eventType !== 'hockey.clock_paused') {
      fail('The period clock has expired; record its pause first.')
    }
    if (event.elapsedMs !== moment.elapsedMs) {
      fail(clock.running ? 'Event time does not match the running clock.' : 'Event time does not match the paused clock.')
    }
  }

  // -- lifecycle -----------------------------------------------------------

  private openingLineup(event: HockeyEvent<'hockey.opening_lineup'>): void {
    const p = this.projection
    if (p.status !== 'pregame' || p.lineupRecorded) fail('The opening lineup is recorded once, before the game.')
    const lineup = this.setup.openingLineup
    const payload = event.payload
    const sameSkaters = payload.skaterParticipantIds.length === lineup.skaterParticipantIds.length &&
      payload.skaterParticipantIds.every((id, index) => id === lineup.skaterParticipantIds[index])
    if (
      payload.goalieParticipantId !== lineup.goalieParticipantId ||
      !sameSkaters ||
      payload.opponentGoalieId !== this.setup.opponentGoalie.id
    ) {
      fail('The opening lineup must match the game setup.')
    }
    p.lineupRecorded = true
    p.nextPeriod = { kind: 'regulation', number: 1 }
    p.goalieInNet = { tracked: payload.goalieParticipantId, opponent: payload.opponentGoalieId }
    const first = hockeyPeriod('regulation', 1)
    for (const side of ['tracked', 'opponent'] as const) {
      p.goalieIntervals.push({
        side,
        participantId: p.goalieInNet[side],
        eventId: event.id,
        periodId: first.id,
        elapsedMs: this.anchored ? 0 : null,
      })
    }
  }

  private periodStarted(event: HockeyEvent<'hockey.period_started'>): void {
    const p = this.projection
    if (!p.lineupRecorded) fail('Record the opening lineup before the first period.')
    if (p.status !== 'pregame' && p.status !== 'in_progress') fail('The match is not in progress.')
    if (p.activePeriodId) fail('End the current period before starting another.')
    const next = p.nextPeriod
    if (!next || next.kind !== event.payload.kind || next.number !== event.payload.number) {
      fail('That period cannot start now.')
    }
    const ref: HockeyPeriodRef = { kind: next.kind, number: next.number }
    const durationMs = hockeyPeriodDurationMs(this.setup.rulesSnapshot, ref)
    if (durationMs === null) fail('The rules do not allow that period.')
    const period = hockeyPeriod(ref.kind, ref.number)
    const direction = hockeyTrackedAttackingDirection(this.setup, ref)
    p.periods.push({
      id: period.id,
      order: period.order,
      kind: ref.kind,
      number: ref.number,
      durationMs,
      trackedAttackingDirection: direction,
      startedEventId: event.id,
      endedEventId: null,
      endedAtElapsedMs: null,
      earlyEndReason: null,
    })
    p.status = 'in_progress'
    p.statusReason = null
    p.activePeriodId = period.id
    p.nextPeriod = null
    p.canEndWithoutReason = false
    p.trackedAttackingDirection = direction
    if (p.clock) {
      Object.assign(p.clock, {
        periodId: period.id,
        running: false,
        elapsedMs: 0,
        anchorElapsedMs: null,
        anchorOccurredAt: null,
        expired: false,
      })
    }
  }

  private periodEnded(event: HockeyEvent<'hockey.period_ended'>): void {
    const p = this.projection
    const active = hockeyActivePeriod(p)
    if (p.status !== 'in_progress' || !active) fail('No period is in progress.')
    let endedAt: number | null = null
    if (p.clock) {
      if (p.clock.running) fail('Pause the clock before ending the period.')
      endedAt = p.clock.elapsedMs
      if (endedAt < active.durationMs && event.payload.reason === null && p.decidedInPeriodId !== active.id) {
        fail('Ending a period before the clock expires needs a reason.')
      }
    }
    active.endedEventId = event.id
    active.endedAtElapsedMs = endedAt
    active.earlyEndReason = event.payload.reason
    p.activePeriodId = null
    this.refreshBetweenPeriods()
  }

  private clockEvent(event: HockeyEvent<'hockey.clock_started' | 'hockey.clock_paused' | 'hockey.clock_set'>): void {
    const p = this.projection
    const clock = p.clock
    if (!clock) fail('This game does not use a clock.')
    const active = hockeyActivePeriod(p)
    if (p.status !== 'in_progress' || !active || clock.periodId !== active.id) {
      fail('The clock can only change during a period.')
    }
    switch (event.eventType) {
      case 'hockey.clock_started':
        if (clock.running) fail('The clock is already running.')
        if (clock.expired || clock.elapsedMs >= active.durationMs) {
          fail('Set the clock below the period length before starting it.')
        }
        if (event.payload.anchorElapsedMs !== clock.elapsedMs) fail('The clock start is stale.')
        clock.running = true
        clock.anchorElapsedMs = clock.elapsedMs
        clock.anchorOccurredAt = event.occurredAt
        return
      case 'hockey.clock_paused': {
        if (!clock.running) fail('The clock is already paused.')
        const moment = hockeyClockMomentAt(clock, event.occurredAt, active.durationMs)
        if (!moment.ok) fail(moment.message)
        if (event.payload.elapsedMs !== moment.elapsedMs) fail('The clock pause is stale.')
        const expired = moment.unboundedElapsedMs >= active.durationMs
        if (expired !== (event.payload.source === 'expiration')) {
          fail(expired ? 'An expired clock is paused by expiration.' : 'The clock has not expired yet.')
        }
        clock.running = false
        clock.elapsedMs = moment.elapsedMs
        clock.anchorElapsedMs = null
        clock.anchorOccurredAt = null
        clock.expired = expired
        return
      }
      case 'hockey.clock_set':
        if (clock.running) fail('Pause the clock before setting it.')
        if (event.payload.fromElapsedMs !== clock.elapsedMs) fail('The clock change is stale.')
        if (event.payload.toElapsedMs !== event.elapsedMs) fail('The clock change must carry its new time.')
        if (event.payload.toElapsedMs > active.durationMs) fail('The clock cannot be set past the period length.')
        clock.elapsedMs = event.payload.toElapsedMs
        clock.expired = event.payload.toElapsedMs === active.durationMs
        return
    }
  }

  private matchEnded(event: HockeyEvent<'hockey.match_ended'>): void {
    const p = this.projection
    if (p.status !== 'in_progress') fail('The match is not in progress.')
    if (p.activePeriodId) fail('End the current period before ending the match.')
    if (!p.canEndWithoutReason && event.payload.reason === null) {
      fail('Ending the match before the rules complete it needs a reason.')
    }
    p.status = 'ended'
    p.statusReason = event.payload.reason
    p.nextPeriod = null
    p.canEndWithoutReason = false
  }

  private matchInterrupted(event: HockeyEvent<'hockey.match_suspended' | 'hockey.match_abandoned'>): void {
    const p = this.projection
    if (p.status !== 'in_progress') fail('The match is not in progress.')
    if (p.clock?.running) fail('Pause the clock first.')
    p.status = event.eventType === 'hockey.match_suspended' ? 'suspended' : 'abandoned'
    p.statusReason = event.payload.reason
  }

  private matchReopened(event: HockeyEvent<'hockey.match_reopened'>): void {
    const p = this.projection
    if (p.status !== 'ended' && p.status !== 'suspended' && p.status !== 'abandoned') {
      fail('Only an ended, suspended or abandoned match can be reopened.')
    }
    p.status = 'in_progress'
    p.statusReason = event.payload.reason
    if (!p.activePeriodId) this.refreshBetweenPeriods()
  }

  // -- capture (HKY-2B) -----------------------------------------------------

  private shot(event: HockeyEvent<'hockey.shot'>): void {
    const p = this.projection
    const active = hockeyActivePeriod(p)
    if (p.status !== 'in_progress' || !active) fail('Shots are recorded during a period.')
    const actorMessage = checkHockeyShotActors(this.setup, p, event)
    if (actorMessage) fail(actorMessage)
    const payload = event.payload
    if (payload.onIce) {
      const onIceMessage = checkHockeyOnIce(this.setup, active, payload.onIce)
      if (onIceMessage) fail(onIceMessage)
    }
    const side = event.teamSide
    const defending = otherHockeySide(side)
    if (!payload.emptyNet) {
      const stamped = event.actors.find(actor => actor.role === 'goalie')?.participantId ?? null
      const resolved = p.goalieInNet[defending]
      if (stamped !== resolved) this.warnGoalieMismatch(event.id, stamped, resolved)
    }
    const totals = this.periodTotals(active.id)
    if (payload.outcome === 'goal' || payload.outcome === 'saved') {
      p.shotsOnGoal[side] += 1
      totals.shotsOnGoal[side] += 1
    }
    if (payload.outcome === 'goal') {
      p.score[side] += 1
      totals.goals[side] += 1
      this.refreshSuddenDeathDecision()
    }
    accumulateHockeyShotStats(this.stats, event)
  }

  private goalieChange(event: HockeyEvent<'hockey.goalie_change'>): void {
    const p = this.projection
    if (p.status !== 'in_progress') fail('Goalie changes are recorded while the match is in progress.')
    const message = checkHockeyGoalieChange(this.setup, p, event)
    if (message) fail(message)
    const side = event.teamSide
    if (event.payload.newOpponentGoalie) p.opponentGoalies.push(structuredClone(event.payload.newOpponentGoalie))
    p.goalieInNet[side] = event.payload.inParticipantId
    const period = hockeyActivePeriod(p) ?? lastHockeyPeriod(p)
    p.goalieIntervals.push({
      side,
      participantId: event.payload.inParticipantId,
      eventId: event.id,
      periodId: period?.id ?? hockeyPeriod('regulation', 1).id,
      elapsedMs: event.elapsedMs,
    })
  }

  /** Adjustments change the score but never create player goals. */
  private scoreAdjustment(event: HockeyEvent<'hockey.score_adjustment'>): void {
    const p = this.projection
    if (p.status !== 'in_progress') fail('Reopen the match to adjust the score.')
    const side: HockeySide = event.teamSide
    const next = p.score[side] + event.payload.delta
    if (next < 0) fail('A score cannot go below zero.')
    p.score[side] = next
    if (!this.refreshSuddenDeathDecision() && p.decidedInPeriodId && p.score.tracked === p.score.opponent) {
      // A tying adjustment after the decided period has ended still reopens the decision.
      p.decidedInPeriodId = null
    }
    if (!p.activePeriodId && p.periods.length > 0) this.refreshBetweenPeriods()
  }

  /**
   * In an active sudden-death overtime the decision follows the score: any goal or
   * adjustment that leaves a leader decides the period, and one that leaves a tie
   * clears it. Returns false outside active sudden-death overtime.
   */
  private refreshSuddenDeathDecision(): boolean {
    const p = this.projection
    const active = hockeyActivePeriod(p)
    if (!active || active.kind !== 'overtime' || !hockeyOvertimeSuddenDeath(this.setup.rulesSnapshot)) return false
    p.decidedInPeriodId = p.score.tracked === p.score.opponent ? null : active.id
    return true
  }

  private periodTotals(periodId: string) {
    const existing = this.projection.periodTotals[periodId]
    if (existing) return existing
    const created = { goals: { tracked: 0, opponent: 0 }, shotsOnGoal: { tracked: 0, opponent: 0 } }
    this.projection.periodTotals[periodId] = created
    return created
  }

  private warnGoalieMismatch(eventId: string, recorded: string | null, resolved: string | null): void {
    const name = (id: string | null) => {
      if (id === null) return 'an empty net'
      const participant = this.setup.participants.find(entry => entry.id === id)
      if (participant) return participant.displayName
      const opponent = this.projection.opponentGoalies.find(entry => entry.id === id)
      return opponent?.label ?? (opponent?.number ? `#${opponent.number}` : 'the opponent goalie')
    }
    this.projection.warnings.push({
      code: 'actor_mismatch',
      eventId,
      role: 'goalie',
      recordedParticipantId: recorded,
      resolvedParticipantId: resolved,
      message: `This shot was recorded against ${name(recorded)}, but the goalie changes now put ${name(resolved)} in net.`,
    })
  }

  // -- derived -------------------------------------------------------------

  /** Decides what may follow the last ended period (HKY-1 §2.1, overtime only on a tie). */
  private refreshBetweenPeriods(): void {
    const p = this.projection
    const rules = this.setup.rulesSnapshot
    const last = lastHockeyPeriod(p)
    const tied = p.score.tracked === p.score.opponent
    let next: HockeyPeriodRef | null = null
    if (!last) {
      next = p.lineupRecorded ? { kind: 'regulation', number: 1 } : null
    } else if (last.kind === 'regulation' && last.number < rules.regulation.periods) {
      next = { kind: 'regulation', number: last.number + 1 }
    } else if (tied && rules.overtime) {
      const candidate: HockeyPeriodRef = last.kind === 'regulation'
        ? { kind: 'overtime', number: 1 }
        : { kind: 'overtime', number: last.number + 1 }
      next = hockeyPeriodDurationMs(rules, candidate) === null ? null : candidate
    }
    p.nextPeriod = next
    const regulationDone = p.periods.some(
      period => period.kind === 'regulation' && period.number === rules.regulation.periods && period.endedEventId
    )
    // A tie that the rules do not allow still needs a shootout (HKY-3C), so it is not complete.
    p.canEndWithoutReason = regulationDone && next === null && (!tied || rules.tiesAllowed)
  }
}

/** Parses the envelope period of a Hockey event, for callers outside replay. */
export function hockeyEventPeriodRef(event: GameEvent): HockeyPeriodRef | null {
  return parseHockeyPeriod(event.period)
}

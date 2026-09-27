import type { GameState } from '../../types'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type {
  GameEvent,
  GameEventDiagnostic,
  SportGameEventProjectionResult,
  SportGameEventProjector,
} from '../gameEvents/types'
import { hockeyPeriod, hockeyPeriodDurationMs, parseHockeyPeriod } from './periods'
import { hockeyTrackedAttackingDirection } from './setup'
import { createHockeyMatchProjection } from './state'
import type {
  HockeyClockProjection,
  HockeyEvent,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyPeriodRecord,
  HockeyPeriodRef,
  HockeySportGameState,
} from './types'

export class HockeyReplayError extends Error {}

export interface HockeyReplayOutput {
  projection: HockeyMatchProjection
  diagnostics: GameEventDiagnostic[]
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
      }
    }
  }
  return { projection: replay.projection, diagnostics: [] }
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
    const { projection, diagnostics } = replayHockeyEvents(hockey.setup, events)
    return {
      projection: {
        playerStatsById: {},
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

class HockeyReplay {
  readonly projection: HockeyMatchProjection
  private readonly anchored: boolean

  constructor(private readonly setup: HockeyMatchSetup) {
    this.projection = createHockeyMatchProjection(setup)
    this.anchored = setup.rulesSnapshot.clockModel === 'anchored'
  }

  apply(event: HockeyEvent): void {
    if (event.sportId !== 'hockey') fail('Only Hockey events can be replayed.')
    this.checkPeriodEnvelope(event)
    this.checkElapsed(event)
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
      if (endedAt < active.durationMs && event.payload.reason === null) {
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
    // A tie that the rules do not allow still needs a shootout (HKY-4), so it is not complete.
    p.canEndWithoutReason = regulationDone && next === null && (!tied || rules.tiesAllowed)
  }
}

/** Parses the envelope period of a Hockey event, for callers outside replay. */
export function hockeyEventPeriodRef(event: GameEvent): HockeyPeriodRef | null {
  return parseHockeyPeriod(event.period)
}

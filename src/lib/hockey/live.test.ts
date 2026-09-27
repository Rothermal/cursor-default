import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { createHockeyEvent } from './events'
import {
  endHockeyMatch,
  endHockeyPeriod,
  formatHockeyClock,
  hockeyClockDisplay,
  hockeySportState,
  initializeHockeyEventGame,
  interruptHockeyMatch,
  pauseHockeyClock,
  pauseRunningHockeyClockForWorkflow,
  reopenHockeyMatch,
  setHockeyClock,
  setHockeyRinkFlipped,
  shouldInterceptRunningHockeyClock,
  startHockeyClock,
  startHockeyGame,
  startNextHockeyPeriod,
} from './live'
import { hockeyPeriod } from './periods'
import { replayHockeyEvents } from './projector'
import {
  CLOCKLESS,
  ctx,
  expectOk,
  freshHockeyGame,
  hockeySetup,
  initializedHockeyGame,
  projection,
} from './testFixtures'
import type { HockeyAttackingDirection, HockeyMatchSetup } from './types'

const YOUTH_PERIOD_S = 15 * 60
const NHL_PERIOD_S = 20 * 60

function started(setup: HockeyMatchSetup = hockeySetup(), seconds = 0): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(setup), ctx(seconds)))
}

/** Runs the anchored clock for a full period starting at `from` and ends the period. */
function playFullPeriod(state: GameState, from: number, lengthS: number): GameState {
  const running = expectOk(startHockeyClock(state, ctx(from)))
  return expectOk(endHockeyPeriod(running, {}, ctx(from + lengthS + 5)))
}

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1]
}

function events(state: GameState): GameEvent[] {
  return state.eventStream!.events as GameEvent[]
}

describe('hockey game creation', () => {
  it('initializes an empty authoritative stream and is idempotent for the same setup', () => {
    const state = initializedHockeyGame()
    expect(state.gameDataAuthority).toBe('sport_events')
    expect(state.eventStream?.events).toEqual([])
    expect(projection(state).status).toBe('pregame')
    const again = initializeHockeyEventGame(state, hockeySetup())
    expect(again.ok && again.state).toBe(state)
    const changed = initializeHockeyEventGame(state, hockeySetup({ direction: 'right_to_left' }))
    expect(changed.ok ? null : changed.code).toBe('already_initialized')
  })

  it('rejects invalid setup, other sports, and games with counter stats', () => {
    const bad = { ...hockeySetup(), openingLineup: { goalieParticipantId: 'p1', skaterParticipantIds: ['p2'] } }
    const invalid = initializeHockeyEventGame(freshHockeyGame(), bad)
    expect(invalid.ok ? null : invalid.code).toBe('invalid_setup')

    const legacy = freshHockeyGame()
    legacy.players[0].stats = { goals: 1 }
    const withStats = initializeHockeyEventGame(legacy, hockeySetup())
    expect(withStats.ok ? null : withStats.code).toBe('legacy_activity_present')

    const other = initializeHockeyEventGame({ ...freshHockeyGame(), sport: null }, hockeySetup())
    expect(other.ok ? null : other.code).toBe('not_hockey')
  })

  it('records the opening lineup and opens period 1 paused at zero in one command', () => {
    const state = started()
    const recorded = events(state)
    expect(recorded.map(event => event.eventType)).toEqual(['hockey.opening_lineup', 'hockey.period_started'])
    expect(recorded.map(event => event.elapsedMs)).toEqual([null, 0])
    const p = projection(state)
    expect(p.status).toBe('in_progress')
    expect(p.activePeriodId).toBe('regulation-1')
    expect(p.clock).toMatchObject({ periodId: 'regulation-1', running: false, elapsedMs: 0, expired: false })
    expect(state.currentPeriod).toBe(1)
    const again = startHockeyGame(state, ctx(1))
    expect(again.ok).toBe(false)
  })
})

describe('anchored clock', () => {
  it('starts, pauses and resumes from anchors', () => {
    let state = started()
    state = expectOk(startHockeyClock(state, ctx(10)))
    expect(projection(state).clock).toMatchObject({ running: true, anchorElapsedMs: 0, anchorOccurredAt: ctx(10).occurredAt })
    state = expectOk(pauseHockeyClock(state, ctx(70)))
    expect(projection(state).clock).toMatchObject({ running: false, elapsedMs: 60_000 })
    expect(last(events(state))?.payload).toMatchObject({ elapsedMs: 60_000, source: 'manual' })
    state = expectOk(startHockeyClock(state, ctx(100)))
    state = expectOk(pauseHockeyClock(state, ctx(130)))
    expect(projection(state).clock?.elapsedMs).toBe(90_000)
  })

  it('pauses by expiration at the period length and refuses to restart until set', () => {
    let state = expectOk(startHockeyClock(started(), ctx(0)))
    state = expectOk(pauseHockeyClock(state, ctx(YOUTH_PERIOD_S + 42)))
    expect(last(events(state))?.payload).toMatchObject({ elapsedMs: YOUTH_PERIOD_S * 1000, source: 'expiration' })
    expect(projection(state).clock).toMatchObject({ elapsedMs: YOUTH_PERIOD_S * 1000, expired: true })
    const restart = startHockeyClock(state, ctx(YOUTH_PERIOD_S + 50))
    expect(restart.ok ? null : restart.message).toMatch(/below the period length/)
  })

  it('never runs backward', () => {
    const running = expectOk(startHockeyClock(started(), ctx(100)))
    const backward = pauseHockeyClock(running, ctx(50))
    expect(backward.ok ? null : backward.message).toMatch(/backward/)
  })

  it('requires the expiration pause before any later event', () => {
    const running = expectOk(startHockeyClock(started(), ctx(0)))
    const sport = hockeySportState(running)!
    const late = createHockeyEvent({
      eventType: 'hockey.match_suspended',
      payload: { captureCommandId: null, reason: 'Lights out' },
      period: hockeyPeriod('regulation', 1),
      elapsedMs: YOUTH_PERIOD_S * 1000,
      recorderUserId: null,
      sequence: 99,
      occurredAt: ctx(YOUTH_PERIOD_S + 10).occurredAt,
    })
    const replay = replayHockeyEvents(sport.setup, [...events(running), late as unknown as GameEvent])
    expect(replay.diagnostics[0]?.message).toMatch(/expired/)
  })

  it('rejects stale elapsed values in replay', () => {
    const running = expectOk(startHockeyClock(started(), ctx(0)))
    const sport = hockeySportState(running)!
    const pause = createHockeyEvent({
      eventType: 'hockey.clock_paused',
      payload: { captureCommandId: null, elapsedMs: 5_000, source: 'manual' },
      period: hockeyPeriod('regulation', 1),
      elapsedMs: 5_000,
      recorderUserId: null,
      sequence: 99,
      occurredAt: ctx(30).occurredAt,
    })
    const replay = replayHockeyEvents(sport.setup, [...events(running), pause as unknown as GameEvent])
    expect(replay.diagnostics).toHaveLength(1)
    expect(replay.projection.clock?.running).toBe(true)
  })

  it('sets a paused clock only with a reason and within the period', () => {
    const state = started()
    const noReason = setHockeyClock(state, { elapsedMs: 30_000, reason: '  ' }, ctx(5))
    expect(noReason.ok ? null : noReason.code).toBe('reason_required')
    const tooFar = setHockeyClock(state, { elapsedMs: (YOUTH_PERIOD_S + 1) * 1000, reason: 'Fix' }, ctx(5))
    expect(tooFar.ok).toBe(false)
    const set = expectOk(setHockeyClock(state, { elapsedMs: 30_000, reason: 'Scoreboard showed 14:30' }, ctx(5)))
    expect(projection(set).clock?.elapsedMs).toBe(30_000)
    const running = expectOk(startHockeyClock(set, ctx(10)))
    const whileRunning = setHockeyClock(running, { elapsedMs: 0, reason: 'Fix' }, ctx(11))
    expect(whileRunning.ok ? null : whileRunning.message).toMatch(/Pause the clock/)
  })

  it('reads the display without writing state', () => {
    const running = expectOk(startHockeyClock(started(), ctx(0)))
    const reading = hockeyClockDisplay(hockeySportState(running)!, ctx(61).occurredAt)
    expect(reading).toEqual({ elapsedMs: 61_000, displayMs: (YOUTH_PERIOD_S - 61) * 1000, expired: false })
    expect(formatHockeyClock(reading!.displayMs)).toBe('13:59')
    expect(projection(running).clock?.elapsedMs).toBe(0)
  })
})

describe('period lifecycle', () => {
  it('ends an expired period without a reason, pausing the running clock in the same command', () => {
    const running = expectOk(startHockeyClock(started(), ctx(0)))
    const ended = expectOk(endHockeyPeriod(running, {}, ctx(YOUTH_PERIOD_S + 3)))
    const tail = events(ended).slice(-2)
    expect(tail.map(event => event.eventType)).toEqual(['hockey.clock_paused', 'hockey.period_ended'])
    expect(tail.map(event => event.elapsedMs)).toEqual([YOUTH_PERIOD_S * 1000, YOUTH_PERIOD_S * 1000])
    const p = projection(ended)
    expect(p.activePeriodId).toBeNull()
    expect(p.periods[0]).toMatchObject({ endedAtElapsedMs: YOUTH_PERIOD_S * 1000, earlyEndReason: null })
    expect(p.nextPeriod).toEqual({ kind: 'regulation', number: 2 })
  })

  it('requires a reason to end an anchored period early', () => {
    const running = expectOk(startHockeyClock(started(), ctx(0)))
    const early = endHockeyPeriod(running, {}, ctx(300))
    expect(early.ok ? null : early.code).toBe('reason_required')
    const ended = expectOk(endHockeyPeriod(running, { reason: 'Time limit on the ice' }, ctx(300)))
    expect(projection(ended).periods[0]).toMatchObject({ endedAtElapsedMs: 300_000, earlyEndReason: 'Time limit on the ice' })
  })

  it('completes youth regulation with no overtime and ends the match without a reason', () => {
    let state = started()
    state = playFullPeriod(state, 0, YOUTH_PERIOD_S)
    for (const [index, from] of [2000, 4000].entries()) {
      state = expectOk(startNextHockeyPeriod(state, ctx(from - 10)))
      expect(projection(state).activePeriodId).toBe(`regulation-${index + 2}`)
      state = playFullPeriod(state, from, YOUTH_PERIOD_S)
    }
    const p = projection(state)
    expect(p.nextPeriod).toBeNull()
    expect(p.canEndWithoutReason).toBe(true)
    expect(startNextHockeyPeriod(state, ctx(6000)).ok).toBe(false)
    const ended = expectOk(endHockeyMatch(state, {}, ctx(6000)))
    expect(projection(ended)).toMatchObject({ status: 'ended', statusReason: null })
    expect(last(events(ended))?.elapsedMs).toBeNull()
  })

  it('offers one NHL overtime on a tie, then needs a reason while the shootout is not built', () => {
    let state = started(hockeySetup({ profile: 'nhl_regular' }))
    let clock = 0
    for (let period = 1; period <= 3; period += 1) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(clock)))
      state = playFullPeriod(state, clock + 1, NHL_PERIOD_S)
      clock += 2000
    }
    expect(projection(state).nextPeriod).toEqual({ kind: 'overtime', number: 1 })
    expect(projection(state).canEndWithoutReason).toBe(false)
    state = expectOk(startNextHockeyPeriod(state, ctx(clock)))
    expect(last(projection(state).periods)).toMatchObject({ id: 'overtime-1', order: 101, durationMs: 5 * 60_000 })
    state = playFullPeriod(state, clock + 1, 5 * 60)
    expect(projection(state).nextPeriod).toBeNull()
    const noReason = endHockeyMatch(state, {}, ctx(clock + 1000))
    expect(noReason.ok ? null : noReason.code).toBe('reason_required')
    expect(expectOk(endHockeyMatch(state, { reason: 'Shootout scored on paper' }, ctx(clock + 1000)))).toBeTruthy()
  })

  it('repeats playoff overtime while tied', () => {
    let state = started(hockeySetup({ profile: 'nhl_playoffs', rules: CLOCKLESS }))
    for (let period = 1; period <= 3; period += 1) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(period * 10)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(period * 10 + 5)))
    }
    for (let overtime = 1; overtime <= 3; overtime += 1) {
      expect(projection(state).nextPeriod).toEqual({ kind: 'overtime', number: overtime })
      state = expectOk(startNextHockeyPeriod(state, ctx(100 + overtime * 10)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(105 + overtime * 10)))
    }
    expect(projection(state).canEndWithoutReason).toBe(false)
  })
})

describe('clockless games', () => {
  const clockless = () => started(hockeySetup({ rules: CLOCKLESS }))

  it('keeps elapsed null on every event and ends periods any time without a reason', () => {
    let state = clockless()
    expect(projection(state).clock).toBeNull()
    state = expectOk(endHockeyPeriod(state, {}, ctx(5)))
    state = expectOk(startNextHockeyPeriod(state, ctx(6)))
    state = expectOk(interruptHockeyMatch(state, { kind: 'suspended', reason: 'Rain delay' }, ctx(7)))
    state = expectOk(reopenHockeyMatch(state, { reason: 'Resumed' }, ctx(8)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(9)))
    expect(events(state).every(event => event.elapsedMs === null)).toBe(true)
    expect(projection(state).periods.map(period => period.endedAtElapsedMs)).toEqual([null, null])
  })

  it('rejects every clock command', () => {
    const state = clockless()
    for (const result of [
      startHockeyClock(state, ctx(1)),
      pauseHockeyClock(state, ctx(1)),
      setHockeyClock(state, { elapsedMs: 1000, reason: 'Fix' }, ctx(1)),
    ]) {
      expect(result.ok ? null : result.code).toBe('clock_unavailable')
    }
    expect(hockeyClockDisplay(hockeySportState(state)!, ctx(1).occurredAt)).toBeNull()
  })

  it('rejects clock time on a clockless event in replay', () => {
    const state = clockless()
    const sport = hockeySportState(state)!
    const bad = createHockeyEvent({
      eventType: 'hockey.period_ended',
      payload: { captureCommandId: null, reason: null },
      period: hockeyPeriod('regulation', 1),
      elapsedMs: 1000,
      recorderUserId: null,
      sequence: 99,
      occurredAt: ctx(5).occurredAt,
    })
    expect(replayHockeyEvents(sport.setup, [...events(state), bad as unknown as GameEvent]).diagnostics[0]?.message)
      .toMatch(/Clockless/)
  })
})

describe('attacking direction', () => {
  const directions = (state: GameState) => projection(state).periods.map(period => period.trackedAttackingDirection)

  it.each<HockeyAttackingDirection>(['left_to_right', 'right_to_left'])(
    'alternates regulation from %s and follows each overtime ends policy',
    first => {
      const opposite = first === 'left_to_right' ? 'right_to_left' : 'left_to_right'
      for (const [endsPolicy, overtimeDirection] of [
        ['continue_alternation', opposite],
        ['same_as_last_regulation', first],
      ] as const) {
        let state = started(hockeySetup({
          profile: 'nhl_playoffs',
          direction: first,
          rules: {
            ...CLOCKLESS,
            overtime: { lengthMs: 20 * 60_000, skaters: 5, repeat: true, endsPolicy },
          },
        }))
        for (let period = 1; period < 5; period += 1) {
          state = expectOk(endHockeyPeriod(state, {}, ctx(period * 10)))
          state = expectOk(startNextHockeyPeriod(state, ctx(period * 10 + 1)))
        }
        // Overtime 2 is sequence 5 under alternation and sequence 3 otherwise: both odd.
        expect(directions(state)).toEqual([first, opposite, first, overtimeDirection, first])
        expect(projection(state).trackedAttackingDirection).toBe(first)
      }
    }
  )

  it('keeps the rink flip out of projection, events and fingerprints', () => {
    const state = started()
    const flipped = setHockeyRinkFlipped(state, true)
    expect(hockeySportState(flipped)?.capturePreferences.rinkFlipped).toBe(true)
    expect(buildGameSyncFingerprint(flipped)).toBe(buildGameSyncFingerprint(state))
    expect(projection(flipped)).toEqual(projection(state))
    expect(flipped.eventStream).toBe(state.eventStream)
  })
})

describe('match interruptions', () => {
  it('pauses a running clock when suspending and continues the same period on reopen', () => {
    let state = expectOk(startHockeyClock(started(), ctx(0)))
    const noReason = interruptHockeyMatch(state, { kind: 'suspended', reason: '' }, ctx(30))
    expect(noReason.ok ? null : noReason.code).toBe('reason_required')
    state = expectOk(interruptHockeyMatch(state, { kind: 'suspended', reason: 'Injury' }, ctx(30)))
    expect(events(state).slice(-2).map(event => event.eventType)).toEqual(['hockey.clock_paused', 'hockey.match_suspended'])
    expect(projection(state)).toMatchObject({ status: 'suspended', statusReason: 'Injury', activePeriodId: 'regulation-1' })
    expect(startHockeyClock(state, ctx(40)).ok).toBe(false)
    expect(endHockeyPeriod(state, { reason: 'x' }, ctx(40)).ok).toBe(false)
    state = expectOk(reopenHockeyMatch(state, { reason: 'Play resumed' }, ctx(50)))
    expect(projection(state)).toMatchObject({ status: 'in_progress', activePeriodId: 'regulation-1' })
    expect(projection(state).clock).toMatchObject({ running: false, elapsedMs: 30_000 })
    state = expectOk(startHockeyClock(state, ctx(60)))
    expect(projection(state).clock?.running).toBe(true)
  })

  it('abandons with a reason and reopens an ended match between periods', () => {
    let state = started(hockeySetup({ rules: CLOCKLESS }))
    state = expectOk(interruptHockeyMatch(state, { kind: 'abandoned', reason: 'Weather' }, ctx(5)))
    expect(projection(state).status).toBe('abandoned')
    state = expectOk(reopenHockeyMatch(state, { reason: 'Mistake' }, ctx(6)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(7)))
    state = expectOk(endHockeyMatch(state, { reason: 'Called early' }, ctx(8)))
    expect(projection(state)).toMatchObject({ status: 'ended', statusReason: 'Called early' })
    state = expectOk(reopenHockeyMatch(state, { reason: 'Keep playing' }, ctx(9)))
    expect(projection(state).nextPeriod).toEqual({ kind: 'regulation', number: 2 })
  })

  it('refuses new events when the stored history does not replay', () => {
    const state = started()
    const broken: GameState = {
      ...state,
      eventStream: { ...state.eventStream!, events: [events(state)[1]] },
    }
    const result = startHockeyClock(broken, ctx(5))
    expect(result.ok ? null : result.code).toBe('history_invalid')
  })
})

describe('active-game mutation guard', () => {
  it('pauses a running clock only for park or replace actions', () => {
    const running = expectOk(startHockeyClock(started(), ctx(0)))
    expect(shouldInterceptRunningHockeyClock(running, 'park_commit')).toBe(true)
    expect(shouldInterceptRunningHockeyClock(running, 'route_navigation')).toBe(false)
    expect(shouldInterceptRunningHockeyClock(started(), 'park_commit')).toBe(false)
    const paused = pauseRunningHockeyClockForWorkflow(running, 'park_commit', {
      recorderUserId: null,
      occurredAt: ctx(45).occurredAt,
    })
    expect(paused.ok && projection(paused.state).clock).toMatchObject({ running: false, elapsedMs: 45_000 })
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import {
  changeHockeyGoalie,
  recordHockeyPenalties,
  recordHockeyShot,
  recordHockeyTimeout,
} from './captureCommands'
import { addHockeyEvents, correctHockeyEvents, hockeyCorrectionConsequences, hockeyCorrectionInput, type HockeyCorrectionInput } from './corrections'
import {
  endHockeyPeriod,
  pauseHockeyClock,
  setHockeyClock,
  startHockeyClock,
  startHockeyGame,
  startNextHockeyPeriod,
  type HockeyPlaceTarget,
} from './live'
import { orderHockeyEvents } from './placement'
import { canRestoreHockeyCapture, restoreHockeyCapture, undoHockeyCapture } from './recentEvents'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import { hockeyTimeline, type HockeyTimelineRow } from './timeline'

const LABELS = { tracked: 'Blades', opponent: 'Rivals' }
const OPTIONS = { recorderUserId: null, now: at(5000) }
const P1 = 'regulation-1'
const P2 = 'regulation-2'

function rows(state: GameState): HockeyTimelineRow[] {
  return hockeyTimeline(state, LABELS).rows
}

function labels(state: GameState, periodId?: string): string[] {
  return rows(state).filter(row => !periodId || row.periodId === periodId).map(row => row.label)
}

function row(state: GameState, label: string | RegExp): HockeyTimelineRow {
  const found = rows(state).find(entry => (typeof label === 'string' ? entry.label === label : label.test(entry.label)))
  if (!found) throw new Error(`No row ${label}: ${labels(state).join(' | ')}`)
  return found
}

function hydrate(state: GameState): GameState {
  return gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
}

function active(state: GameState): GameEvent[] {
  return inspectGameEventStream(state.eventStream!, gameEventRegistry).activeEvents
}

function shot(side: 'tracked' | 'opponent', outcome: 'goal' | 'saved' | 'missed', shooter?: string): HockeyCorrectionInput {
  return { kind: 'shot', input: { side, outcome, ...(shooter ? { shooter: { participantId: shooter } } : {}) } }
}

function add(state: GameState, correction: HockeyCorrectionInput, place: HockeyPlaceTarget, updateGoalies = false) {
  return addHockeyEvents(state, correction, place, { ...OPTIONS, updateGoalies })
}

function gameTime(periodId: string, seconds: number): HockeyPlaceTarget {
  return { periodId, elapsedMs: seconds * 1000, placement: 'game_time' }
}

/** Anchored youth game, clock started at 1 s, so an event at t has elapsed (t - 1) s. */
function running(): GameState {
  return expectOk(startHockeyClock(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0))), ctx(1)))
}

function clockless(): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
}

function literal(name: string): GameState {
  return JSON.parse(readFileSync(`src/lib/hockey/fixtures/${name}.json`, 'utf8')) as GameState
}

describe('Hockey game-order placement (HKY-4C)', () => {
  it('keeps capture order for streams without placed events, so older games replay unchanged', () => {
    for (const name of ['hky1-high-school', 'hky1-nhl-overtime']) {
      const state = literal(name)
      const events = active(state)
      expect(orderHockeyEvents(events).map(event => event.id))
        .toEqual([...events].sort(compareGameEventCaptureOrder).map(event => event.id))
      const reloaded = hydrate(state)
      expect(buildGameSyncFingerprint(reloaded)).toBe(buildGameSyncFingerprint(hydrate(reloaded)))
      expect(projection(reloaded)).toEqual(projection(hydrate(reloaded)))
    }
  })

  it('adds a Period 1 goal while Period 3 runs, placed at its game time', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(61)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'missed' }, ctx(301)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(400)))
    state = expectOk(startNextHockeyPeriod(state, ctx(410)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(420)))
    state = expectOk(startNextHockeyPeriod(state, ctx(430)))
    state = expectOk(startHockeyClock(state, ctx(431)))

    const result = add(state, shot('tracked', 'goal', 'p2'), gameTime(P1, 120))
    const added = expectOk(result)
    expect(projection(added).score).toEqual({ tracked: 1, opponent: 0 })
    expect(projection(added).periodTotals[P1].goals.tracked).toBe(1)
    // Between the saved shot (1:00) and the miss (5:00), as replay applies it.
    expect(labels(added, P1)).toEqual([
      'opening lineup', 'period started', 'clock started', 'Rivals saved', 'Blades goal by Player 2', 'Rivals missed',
      'clock paused', 'period ended',
    ])
    const goal = row(added, 'Blades goal by Player 2')
    expect(goal.recordedLater).toBe(true)
    expect(goal.events[0].payload).toMatchObject({ placement: 'game_time', recordedLater: true })
    expect(goal.events[0].elapsedMs).toBe(120000)
    // Recorded now: it is the newest capture, so quick Undo takes it back.
    const undone = expectOk(undoHockeyCapture(added, at(5001)))
    expect(projection(undone).score.tracked).toBe(0)
    expect(canRestoreHockeyCapture(undone)).toBe(true)
    expect(projection(expectOk(restoreHockeyCapture(undone, at(5002)))).score.tracked).toBe(1)
    expect(rows(hydrate(added))).toEqual(rows(added))
  })

  it('places an addition at 0:00 after shots captured at 0:00, and before the first later shot', () => {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(2)))
    state = expectOk(startHockeyClock(state, ctx(3)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'missed' }, ctx(13)))
    const added = expectOk(add(state, shot('tracked', 'saved'), gameTime(P1, 0)))
    expect(labels(added, P1)).toEqual([
      'opening lineup', 'period started', 'Rivals saved', 'clock started', 'Blades saved', 'Rivals missed',
    ])
  })

  it('uses the first strictly later live event after a backward clock set', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(11)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'missed' }, ctx(21)))
    state = expectOk(pauseHockeyClock(state, ctx(22)))
    state = expectOk(setHockeyClock(state, { elapsedMs: 5000, reason: 'Scoreboard reset' }, ctx(23)))
    state = expectOk(startHockeyClock(state, ctx(24)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'goal' }, ctx(25)))
    const added = expectOk(add(state, shot('tracked', 'saved'), gameTime(P1, 15)))
    const order = labels(added, P1)
    expect(order.indexOf('Blades saved')).toBe(order.indexOf('Rivals missed') - 1)
    expect(order.indexOf('Blades saved')).toBeGreaterThan(order.indexOf('Rivals saved'))
    expect(order.indexOf('Rivals goal')).toBeGreaterThan(order.indexOf('Blades saved'))
  })

  it('adds a penalty in an earlier period that changes the box after it, keeping stored strength', () => {
    let state = running()
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(10)))
    state = expectOk(startNextHockeyPeriod(state, ctx(20)))
    state = expectOk(startHockeyClock(state, ctx(21)))
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, ctx(81)))
    expect(row(state, 'Blades goal by Player 2').strength).toBe('ev')

    const penalty: HockeyCorrectionInput = {
      kind: 'penalties',
      input: { penalties: [{ side: 'opponent', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { label: '#4' } }] },
    }
    const added = expectOk(add(state, penalty, gameTime(P2, 30)))
    const consequences = hockeyCorrectionConsequences(state, added)
    expect(consequences.strength).toEqual([{ eventId: row(state, 'Blades goal by Player 2').id, stored: 'ev', derived: 'pp' }])
    // The box at 1:00 of Period 2 holds the added minor.
    expect(projection(added).penalties.map(entry => entry.periodId)).toEqual([P2])
    expect(rows(hydrate(added))).toEqual(rows(added))
  })

  it('fixes the starting goalie with a period-start goalie change ahead of every shot of the period', () => {
    for (const anchored of [true, false]) {
      let state = anchored
        ? expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0)))
        : clockless()
      // Captured while the opening clock was still paused at 0:00 (anchored), or any time (clockless).
      state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(2)))
      if (anchored) state = expectOk(startHockeyClock(state, ctx(3)))
      state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'goal' }, ctx(33)))
      const shots = rows(state).filter(entry => entry.events[0].eventType === 'hockey.shot').map(entry => entry.id)

      const place: HockeyPlaceTarget = { periodId: P1, elapsedMs: anchored ? 0 : null, placement: 'period_start' }
      const goalie: HockeyCorrectionInput = { kind: 'goalie_change', input: { side: 'tracked', inParticipantId: 'p30', reason: 'tactical', newOpponentGoalie: null } }
      const result = add(state, goalie, place, true)
      expect(result.goalieRepairs.map(entry => [entry.eventId, entry.resolvedParticipantId])).toEqual(shots.map(id => [id, 'p30']))
      const fixed = expectOk(result)
      expect(labels(fixed, P1).slice(0, 3)).toEqual(['opening lineup', 'period started', 'Blades goalie change'])
      const reloaded = hydrate(fixed)
      expect(projection(reloaded).goalieInNet.tracked).toBe('p30')
      expect(projection(reloaded).warnings).toEqual([])
      expect(row(reloaded, 'Rivals goal').events[0].actors.find(actor => actor.role === 'goalie')?.participantId).toBe('p30')
      expect(rows(reloaded)).toEqual(rows(fixed))
    }
  })

  it('places clockless additions at the end of their period', () => {
    let state = clockless()
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(2)))
    state = expectOk(endHockeyPeriod(state, { reason: null }, ctx(3)))
    state = expectOk(startNextHockeyPeriod(state, ctx(4)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'missed' }, ctx(5)))
    const ended = expectOk(add(state, shot('tracked', 'goal'), { periodId: P1, elapsedMs: null, placement: 'game_time' }))
    expect(labels(ended, P1)).toEqual(['opening lineup', 'period started', 'Rivals saved', 'Blades goal', 'period ended'])
    const runningPeriod = expectOk(add(ended, shot('tracked', 'saved'), { periodId: P2, elapsedMs: null, placement: 'game_time' }))
    expect(labels(runningPeriod, P2)).toEqual(['period started', 'Rivals missed', 'Blades saved'])
    // A clockless game takes no clock time.
    expect(add(state, shot('tracked', 'saved'), gameTime(P1, 5)).ok).toBe(false)
  })

  it('refuses times that have not been played and families without a game time', () => {
    const state = expectOk(recordHockeyShot(running(), { side: 'opponent', outcome: 'saved' }, ctx(61)))
    // The clock has run 61 s at 1:02; the default test time (5000 s) is past the period's end.
    const late = addHockeyEvents(state, shot('tracked', 'saved'), gameTime(P1, 62), { ...OPTIONS, now: at(62), updateGoalies: false })
    expect(late.ok ? '' : late.message).toBe('That time has not been played yet in this period.')
    const unstarted = add(state, shot('tracked', 'saved'), gameTime(P2, 10))
    expect(unstarted.ok ? '' : unstarted.message).toBe('Pick a period that has started.')
    const adjustment = add(state, { kind: 'score_adjustment', input: { side: 'tracked', delta: 1, reason: 'Missed' } }, gameTime(P1, 10))
    expect(adjustment.ok ? '' : adjustment.message).toBe('This kind of event cannot be placed at a game time.')
    const startShot = add(state, shot('tracked', 'saved'), { periodId: P1, elapsedMs: 0, placement: 'period_start' })
    expect(startShot.ok ? '' : startShot.message).toBe('Only a goalie change is placed at the period start.')
  })

  it('counts placed timeouts without touching the clock, while a live timeout still pauses it', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(61)))
    const clockBefore = projection(state).clock
    const added = expectOk(add(state, { kind: 'timeout', input: { side: 'tracked' } }, gameTime(P1, 30)))
    expect(projection(added).timeouts.tracked).toBe(1)
    expect(projection(added).clock).toEqual(clockBefore)
    expect(projection(hydrate(added)).clock).toEqual(clockBefore)
    expect(row(added, 'Blades timeout').events.map(event => event.eventType)).toEqual(['hockey.timeout'])

    // A live timeout pauses the running clock; re-timing it leaves that pause where it was.
    let live = expectOk(recordHockeyTimeout(state, { side: 'opponent' }, ctx(91)))
    expect(projection(live).clock?.running).toBe(false)
    live = expectOk(startHockeyClock(live, ctx(100)))
    const clockLive = projection(live).clock
    const unit = row(live, /Rivals timeout/)
    // The pause is its own clock row, so the timeout row moves alone.
    expect(unit.events.map(event => event.eventType)).toEqual(['hockey.timeout'])
    const moved = expectOk(correctHockeyEvents(live, unit.events.map(event => event.id), { kind: 'timeout', input: { side: 'opponent' } }, {
      ...OPTIONS,
      place: gameTime(P1, 20),
    }))
    expect(projection(moved).clock).toEqual(clockLive)
    expect(projection(moved).timeouts.opponent).toBe(1)
    const retimed = row(moved, 'Rivals timeout')
    expect(retimed.retimed).toBe(true)
    expect(labels(moved, P1).indexOf('Rivals timeout')).toBeLessThan(labels(moved, P1).indexOf('Rivals saved'))
    expect(labels(moved, P1)).toContain('clock paused')
    expect(projection(hydrate(moved)).clock).toEqual(clockLive)
  })

  it('re-times a live shot to another period and back', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p3' } }, ctx(61)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(70)))
    state = expectOk(startNextHockeyPeriod(state, ctx(80)))
    state = expectOk(startHockeyClock(state, ctx(81)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(201)))
    const target = row(state, 'Blades goal by Player 3')
    const ids = target.events.map(event => event.id)
    const input = hockeyCorrectionInput(target.events)!

    const moved = expectOk(correctHockeyEvents(state, ids, input, { ...OPTIONS, place: gameTime(P2, 60) }))
    expect(projection(moved).periodTotals[P2].goals.tracked).toBe(1)
    expect(projection(moved).periodTotals[P1]?.goals.tracked ?? 0).toBe(0)
    expect(row(moved, 'Blades goal by Player 3')).toMatchObject({ periodId: P2, retimed: true, recordedLater: false })
    expect(labels(moved, P2).slice(-2)).toEqual(['Blades goal by Player 3', 'Rivals saved'])

    const back = expectOk(correctHockeyEvents(moved, ids, input, { ...OPTIONS, place: gameTime(P1, 60) }))
    expect(projection(back).periodTotals[P1].goals.tracked).toBe(1)
    expect(row(back, 'Blades goal by Player 3')).toMatchObject({ periodId: P1, retimed: true })
    expect(rows(hydrate(back))).toEqual(rows(back))
  })

  it('accepts placement fields only on placeable families, with a reason to be placed', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(61)))
    const event = row(state, 'Rivals saved').events[0]
    const inspect = (payload: Record<string, unknown>) => gameEventRegistry.inspect({ ...event, payload: { ...event.payload, ...payload } })
    expect(inspect({ placement: 'game_time', recordedLater: true }).ok).toBe(true)
    expect(inspect({ placement: 'game_time' }).ok).toBe(false)
    expect(inspect({ recordedLater: true }).ok).toBe(false)
    expect(inspect({ placement: 'period_start', recordedLater: true }).ok).toBe(false)
    expect(inspect({ placement: 'game_time', retimed: false }).ok).toBe(false)
    const goalie = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(70)))
    const change = row(goalie, 'Blades goalie change').events[0]
    expect(gameEventRegistry.inspect({ ...change, payload: { ...change.payload, placement: 'period_start', recordedLater: true } }).ok).toBe(true)
    const penalty = expectOk(recordHockeyPenalties(state, {
      penalties: [{ side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p2' } }],
    }, ctx(70)))
    const lifecycle = row(penalty, 'period started').events[0]
    expect(gameEventRegistry.inspect({ ...lifecycle, payload: { ...lifecycle.payload, placement: 'game_time', recordedLater: true } }).ok).toBe(false)
  })
})

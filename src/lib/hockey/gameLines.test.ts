import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { adjustHockeyScore, changeHockeyGoalie, recordHockeyShootoutAttempt, recordHockeyShot, startHockeyShootout, type RecordHockeyShotInput } from './captureCommands'
import { addHockeyEvents, removeHockeyEvents } from './corrections'
import { hockeyGoalStrengthLabel, type HockeyGameLines } from './gameLines'
import { endHockeyMatch, endHockeyPeriod, pauseHockeyClock, setHockeyClock, startHockeyClock, startHockeyGame, startNextHockeyPeriod } from './live'
import { hockeyGoalieRows } from './summary'
import { hockeySummaryFromState } from './summarySource'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyProfileId, HockeyRuleOverrides } from './types'

const WINNER = '6a1c0b5e-0000-4000-8000-000000000001'
const OPTIONS = { recorderUserId: null, now: at(9000) }

function lines(state: GameState): HockeyGameLines {
  const source = hockeySummaryFromState('local', state, null, null)
  if (!source.lines) throw new Error(`Unhealthy: ${source.diagnostic}`)
  return source.lines
}

function line(state: GameState, participantId: string): Record<string, number> {
  return lines(state).participants[participantId]
}

function clockless(profile: HockeyProfileId = 'usa_hockey_youth', rules: HockeyRuleOverrides = {}): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile, rules: { ...CLOCKLESS, ...rules } })), ctx(0)))
}

function goal(state: GameState, input: Partial<RecordHockeyShotInput> & { side?: 'tracked' | 'opponent' }, seconds: number, id?: string): GameState {
  return expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', ...input }, ctx(seconds, id ? [id] : undefined)))
}

/** Ends the remaining regulation periods of a clockless game, then the match. */
function finish(state: GameState, from = 1, seconds = 500): GameState {
  let next = state
  for (let period = from; period <= 3; period++) {
    if (period > from) next = expectOk(startNextHockeyPeriod(next, ctx(seconds++)))
    next = expectOk(endHockeyPeriod(next, {}, ctx(seconds++)))
  }
  return expectOk(endHockeyMatch(next, {}, ctx(seconds)))
}

describe('Hockey per-game lines (HKY-6 §3)', () => {
  it('moves the game-winning goal with the scorers\' order when the totals are equal', () => {
    const p2First = finish(goal(goal(clockless(), { shooter: { participantId: 'p2' } }, 1), { shooter: { participantId: 'p3' } }, 2))
    const p3First = finish(goal(goal(clockless(), { shooter: { participantId: 'p3' } }, 1), { shooter: { participantId: 'p2' } }, 2))
    expect(projection(p2First).score).toEqual(projection(p3First).score)
    expect(line(p2First, 'p2').hky_g).toBe(line(p3First, 'p2').hky_g)
    expect([line(p2First, 'p2').hky_gwg, line(p2First, 'p3').hky_gwg]).toEqual([1, 0])
    expect([line(p3First, 'p2').hky_gwg, line(p3First, 'p3').hky_gwg]).toEqual([0, 1])
    expect(lines(p2First).coverage.gameWinningGoal).toBe('attributed')
  })

  it('credits empty-net goals only when the goal was stored empty net', () => {
    const base = goal(clockless(), { shooter: { participantId: 'p2' } }, 1)
    const empty = finish(goal(base, { shooter: { participantId: 'p4' }, emptyNet: true }, 2))
    const normal = finish(goal(base, { shooter: { participantId: 'p4' }, emptyNet: false }, 2))
    expect(projection(empty).score).toEqual(projection(normal).score)
    expect(line(empty, 'p4').hky_eng).toBe(1)
    expect(line(normal, 'p4').hky_eng).toBe(0)
    expect(hockeyGoalStrengthLabel(lines(empty).goals[1])).toBe('EN')
  })

  it('re-derives the winner after a removed goal and a recorded-later goal', () => {
    // Period 1: p2, p3. Period 2: p4, then the opponent. 3-1, so p3's goal made it 2 > 1.
    let state = goal(clockless(), { shooter: { participantId: 'p2' } }, 1)
    state = goal(state, { shooter: { participantId: 'p3' } }, 2, WINNER)
    state = expectOk(endHockeyPeriod(state, {}, ctx(3)))
    state = expectOk(startNextHockeyPeriod(state, ctx(4)))
    state = goal(state, { shooter: { participantId: 'p4' } }, 5)
    state = goal(state, { side: 'opponent' }, 6)
    state = finish(state, 2, 10)
    expect(lines(state).gameWinningGoalEventId).toBe(WINNER)
    expect(line(state, 'p3').hky_gwg).toBe(1)

    // Without it, 2-1: p4's goal is now the second.
    const removed = expectOk(removeHockeyEvents(state, [WINNER], at(9000)))
    expect(projection(removed).score).toEqual({ tracked: 2, opponent: 1 })
    expect([line(removed, 'p3').hky_gwg, line(removed, 'p4').hky_gwg]).toEqual([0, 1])

    // A goal recorded later in period 1 comes before p4's in game order, so it decides.
    const placed = expectOk(addHockeyEvents(
      removed,
      { kind: 'shot', input: { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p5' } } },
      { periodId: 'regulation-1', elapsedMs: null, placement: 'game_time' },
      OPTIONS,
    ))
    expect(projection(placed).score).toEqual({ tracked: 3, opponent: 1 })
    expect([line(placed, 'p4').hky_gwg, line(placed, 'p5').hky_gwg]).toEqual([0, 1])
    expect(lines(placed).goals.map(entry => `${entry.scoreAfter.tracked}-${entry.scoreAfter.opponent}`)).toEqual(['1-0', '2-0', '3-0', '3-1'])
  })

  it('leaves the winner unattributed without a tracked scorer or after a score adjustment', () => {
    const unattributed = finish(goal(clockless(), {}, 1))
    expect(lines(unattributed).coverage.gameWinningGoal).toBe('unattributed')
    expect(Object.values(lines(unattributed).participants).every(entry => entry.hky_gwg === 0)).toBe(true)

    let adjusted = goal(clockless(), { shooter: { participantId: 'p2' } }, 1)
    adjusted = expectOk(adjustHockeyScore(adjusted, { side: 'tracked', delta: 1, reason: 'Missed goal' }, ctx(2)))
    adjusted = finish(adjusted)
    expect(lines(adjusted).coverage.gameWinningGoal).toBe('unattributed')
    expect(line(adjusted, 'p2').hky_gwg).toBe(0)

    const lost = finish(goal(clockless(), { side: 'opponent' }, 1))
    expect(lines(lost).coverage.gameWinningGoal).toBe('none')
  })

  it('counts a goalie game only with time in net, and the starter\'s start', () => {
    const state = finish(goal(clockless(), { shooter: { participantId: 'p2' } }, 1))
    expect([line(state, 'p1').hky_gp, line(state, 'p1').hky_gs, line(state, 'p1').hky_w, line(state, 'p1').hky_so]).toEqual([1, 1, 1, 1])
    expect([line(state, 'p30').hky_gp, line(state, 'p30').hky_gs]).toEqual([0, 0])
    expect(line(state, 'p2').hky_gp).toBe(1)
    expect(lines(state).coverage.timeInNet).toBeNull()
    expect(line(state, 'p1').hky_toi_ms).toBe(0)
  })

  it('gives no shutout when two goalies played, and a tie to the goalie in net at the end', () => {
    let state = clockless('recreational', { tiesAllowed: true, overtime: null, shootout: null })
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30', reason: 'tactical' }, ctx(1)))
    state = finish(state)
    expect(projection(state).result?.outcome).toBe('tie')
    expect([line(state, 'p1').hky_t, line(state, 'p30').hky_t]).toEqual([0, 1])
    expect([line(state, 'p1').hky_so, line(state, 'p30').hky_so]).toEqual([0, 0])
    expect([line(state, 'p1').hky_gp, line(state, 'p30').hky_gp]).toEqual([1, 1])
  })

  it('records an overtime loss and match-scoped shootout lines', () => {
    let state = clockless('nhl_regular')
    for (let period = 1; period <= 3; period++) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(period * 2)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(period * 2 + 1)))
    }
    state = expectOk(startNextHockeyPeriod(state, ctx(10)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(11)))
    state = expectOk(startHockeyShootout(state, { firstSide: 'tracked' }, ctx(12)))
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'missed', shooter: { participantId: 'p2' } }, ctx(13)))
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'goal', shooter: { label: '#9' } }, ctx(14)))
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'saved', shooter: { participantId: 'p3' } }, ctx(15)))
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'saved', shooter: { label: '#10' } }, ctx(16)))
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'missed', shooter: { participantId: 'p4' } }, ctx(17)))
    state = expectOk(endHockeyMatch(state, {}, ctx(18)))
    expect(projection(state).result).toMatchObject({ outcome: 'loss', decidedIn: 'shootout' })
    expect(line(state, 'p1')).toMatchObject({ hky_otl: 1, hky_l: 0, hky_so: 1, hky_so_sa: 2, hky_so_sv: 1 })
    expect(line(state, 'p2')).toMatchObject({ hky_so_att: 1, hky_so_g: 0 })
    expect(lines(state).coverage.gameWinningGoal).toBe('none')
  })

  it('closes goalie time at period ends, between periods and around a pulled goalie', () => {
    // Anchored youth game: clock starts at 1 s, so an event at t s has elapsed (t - 1) s.
    let state = expectOk(startHockeyClock(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0))), ctx(1)))
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: null, reason: 'pulled' }, ctx(61)))
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p1', reason: 'return' }, ctx(91)))
    state = expectOk(pauseHockeyClock(state, ctx(301)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(302)))
    // Between periods: the backup takes over when period 2 starts.
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30', reason: 'tactical' }, ctx(303)))
    state = expectOk(startNextHockeyPeriod(state, ctx(304)))
    state = expectOk(startHockeyClock(state, ctx(305)))
    state = expectOk(pauseHockeyClock(state, ctx(425)))
    const midGame = lines(state)
    expect(midGame.coverage.timeInNet).toBe('incomplete')
    // Period 1: 0:00-1:00 and 1:30-5:00 for p1 (the 30 s empty net is nobody's). Period 2: 2:00 for p30.
    expect(midGame.goalieTime?.p1).toEqual({ ms: 270_000, coverage: 'incomplete' })
    expect(midGame.goalieTime?.p30).toEqual({ ms: 120_000, coverage: 'incomplete' })
    expect(midGame.goalieTime?.['opp-goalie'].ms).toBe(420_000)

    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(426)))
    state = expectOk(startNextHockeyPeriod(state, ctx(427)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(428)))
    state = expectOk(endHockeyMatch(state, { reason: 'Test' }, ctx(429)))
    const ended = lines(state)
    expect(ended.coverage.timeInNet).toBe('complete')
    expect(ended.participants.p1.hky_toi_ms).toBe(270_000)
    expect(ended.participants.p30.hky_toi_ms).toBe(120_000)
  })

  it('marks goalie time incomplete when the clock is corrected back behind a change', () => {
    // Anchored youth game: clock starts at 1 s, so an event at t s has elapsed (t - 1) s.
    let state = expectOk(startHockeyClock(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0))), ctx(1)))
    state = goal(state, { side: 'opponent' }, 121)
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30', reason: 'tactical' }, ctx(301)))
    state = expectOk(pauseHockeyClock(state, ctx(302)))
    state = expectOk(setHockeyClock(state, { elapsedMs: 120_000, reason: 'Clock was wrong' }, ctx(303)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(304)))
    for (let period = 2, second = 305; period <= 3; period++, second += 2) {
      state = expectOk(startNextHockeyPeriod(state, ctx(second)))
      state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(second + 1)))
    }
    state = expectOk(endHockeyMatch(state, { reason: 'Test' }, ctx(320)))
    expect(projection(state).status).toBe('ended')

    const ended = lines(state)
    // p30 entered at 5:00 in a period that now ends at 2:00: the boundary cannot be closed.
    expect(ended.goalieTime?.p1).toEqual({ ms: 120_000, coverage: 'incomplete' })
    expect(ended.goalieTime?.p30.coverage).toBe('incomplete')
    expect(ended.coverage.timeInNet).toBe('incomplete')
    const source = hockeySummaryFromState('local', state, null, null)
    const p1 = hockeyGoalieRows(source.sport!, source.lines!, source.inspection.activeEvents).find(row => row.id === 'p1')!
    expect(p1).toMatchObject({ timeInNet: '2:00', timeInNetComplete: false, goalsAgainstAverage: null })
  })
})

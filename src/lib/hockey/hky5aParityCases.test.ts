/**
 * HKY-5A server parity cases. Builds games with the real Hockey commands and checks the client's
 * final score. With HKY5A_CASES_OUT set, also writes them as JSON for the PostgreSQL harness in
 * supabase/tests/hky5a (see its README).
 */
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { GameState } from '../../types'
import { adjustHockeyScore, recordHockeyShootoutAttempt, recordHockeyShot, startHockeyShootout } from './captureCommands'
import { endHockeyMatch, endHockeyPeriod, hockeySportState, interruptHockeyMatch, reopenHockeyMatch, startHockeyGame, startNextHockeyPeriod } from './live'
import { undoHockeyCapture } from './recentEvents'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyProfileId, HockeyRuleOverrides, HockeyShootoutOutcome } from './types'

let second = 1
const next = () => ctx(second++)
function start(profile: HockeyProfileId, rules: HockeyRuleOverrides = {}): GameState {
  second = 1
  return expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile, rules: { ...CLOCKLESS, ...rules } })), ctx(0)))
}
const goal = (s: GameState, side: 'tracked' | 'opponent') => expectOk(recordHockeyShot(s, { side, outcome: 'goal' }, next()))
const shot = (s: GameState, side: 'tracked' | 'opponent', outcome: 'saved' | 'missed' | 'blocked') => expectOk(recordHockeyShot(s, { side, outcome }, next()))
const endPeriod = (s: GameState) => expectOk(endHockeyPeriod(s, {}, next()))
const nextPeriod = (s: GameState) => expectOk(startNextHockeyPeriod(s, next()))
function regulation(s: GameState, during?: (s: GameState, period: number) => GameState, overtimes = 0): GameState {
  for (let period = 1; period <= 3 + overtimes; period++) {
    if (period > 1) s = nextPeriod(s)
    if (during) s = during(s, period)
    s = endPeriod(s)
  }
  return s
}
const attempt = (s: GameState, outcome: HockeyShootoutOutcome, side: 'tracked' | 'opponent') =>
  expectOk(recordHockeyShootoutAttempt(s, { outcome, shooter: side === 'tracked' ? { participantId: ['p2', 'p3', 'p4', 'p5', 'p6'][second % 5] } : { label: `#${second}` } }, next()))
function toShootout(firstSide: 'tracked' | 'opponent' = 'tracked'): GameState {
  const s = regulation(start('nhl_regular'), undefined, 1)
  return expectOk(startHockeyShootout(s, { firstSide }, next()))
}

interface Case { name: string; state: GameState; refuse?: boolean }
const cases: Case[] = []
function add(name: string, state: GameState, refuse = false) { cases.push({ name, state, refuse }) }

it('builds the server parity cases with the client scores the server must match', () => {
  add('regulation win with shots, adjustments and an undone goal', (() => {
    const s = regulation(start('usa_hockey_youth'), (s, p) => {
      if (p === 1) { s = goal(s, 'tracked'); s = shot(s, 'opponent', 'saved'); s = goal(s, 'opponent') }
      if (p === 2) { s = goal(s, 'tracked'); s = goal(s, 'tracked'); s = expectOk(undoHockeyCapture(s, at(second++))) }
      if (p === 3) {
        s = expectOk(adjustHockeyScore(s, { side: 'tracked', delta: 1, reason: 'Missed goal' }, next()))
        s = expectOk(adjustHockeyScore(s, { side: 'opponent', delta: 1, reason: 'Missed goal' }, next()))
        s = expectOk(adjustHockeyScore(s, { side: 'opponent', delta: -1, reason: 'Double count' }, next()))
        s = shot(s, 'tracked', 'blocked'); s = shot(s, 'tracked', 'missed')
      }
      return s
    })
    return expectOk(endHockeyMatch(s, {}, next()))
  })())
  add('youth tie accepted', expectOk(endHockeyMatch(regulation(start('usa_hockey_youth'), (s, p) => p === 2 ? goal(goal(s, 'tracked'), 'opponent') : s), {}, next())))
  add('scoreless youth tie', expectOk(endHockeyMatch(regulation(start('usa_hockey_youth')), {}, next())))
  add('shootout early clinch', (() => {
    let s = toShootout('tracked')
    s = attempt(s, 'goal', 'tracked'); s = attempt(s, 'missed', 'opponent'); s = attempt(s, 'goal', 'tracked'); s = attempt(s, 'saved', 'opponent')
    return expectOk(endHockeyMatch(s, {}, next()))
  })())
  add('shootout sudden death after a complete round', (() => {
    let s = toShootout('opponent')
    for (let r = 0; r < 3; r++) { s = attempt(s, 'saved', 'opponent'); s = attempt(s, 'missed', 'tracked') }
    s = attempt(s, 'goal', 'opponent'); s = attempt(s, 'goal', 'tracked'); s = attempt(s, 'goal', 'opponent'); s = attempt(s, 'saved', 'tracked')
    return expectOk(endHockeyMatch(s, {}, next()))
  })())
  add('review probe 1: reasoned end after one shootout goal', (() => {
    let s = toShootout('tracked')
    s = attempt(s, 'goal', 'tracked')
    return expectOk(endHockeyMatch(s, { reason: 'Ice time ran out' }, next()))
  })())
  add('review probe 2: reasoned end after an unanswered sudden-death goal', (() => {
    let s = toShootout('tracked')
    for (let r = 0; r < 3; r++) { s = attempt(s, 'saved', 'tracked'); s = attempt(s, 'missed', 'opponent') }
    s = attempt(s, 'goal', 'tracked')
    return expectOk(endHockeyMatch(s, { reason: 'Ice time ran out' }, next()))
  })())
  add('shootout abandoned mid-round', (() => {
    let s = toShootout('opponent')
    s = attempt(s, 'goal', 'opponent'); s = attempt(s, 'saved', 'tracked')
    return expectOk(interruptHockeyMatch(s, { kind: 'abandoned', reason: 'Lights failed' }, next()))
  })())
  add('overtime goal after a tied regulation', (() => {
    let s = regulation(start('nhl_regular'), (s, p) => p === 1 ? goal(s, 'opponent') : p === 3 ? goal(s, 'tracked') : s)
    s = nextPeriod(s); s = goal(s, 'opponent'); s = endPeriod(s)
    return expectOk(endHockeyMatch(s, {}, next()))
  })())
  add('abandoned in the second period', (() => {
    let s = start('usa_hockey_youth'); s = goal(s, 'tracked'); s = endPeriod(s); s = nextPeriod(s); s = goal(s, 'tracked'); s = goal(s, 'opponent')
    return expectOk(interruptHockeyMatch(s, { kind: 'abandoned', reason: 'Injury' }, next()))
  })())
  add('ended early with a reason', (() => {
    let s = start('usa_hockey_youth'); s = goal(s, 'opponent'); s = endPeriod(s)
    return expectOk(endHockeyMatch(s, { reason: 'Mercy rule' }, next()))
  })())
  add('reopened and ended again', (() => {
    let s = expectOk(endHockeyMatch(regulation(start('usa_hockey_youth'), (s, p) => p === 1 ? goal(s, 'tracked') : s), {}, next()))
    s = expectOk(reopenHockeyMatch(s, { reason: 'Missed a goal' }, next()))
    s = expectOk(adjustHockeyScore(s, { side: 'opponent', delta: 1, reason: 'Missed goal' }, next()))
    return expectOk(endHockeyMatch(s, {}, next()))
  })())
  add('suspended is refused', (() => {
    let s = start('usa_hockey_youth'); s = goal(s, 'tracked')
    return expectOk(interruptHockeyMatch(s, { kind: 'suspended', reason: 'Weather' }, next()))
  })(), true)
  add('reopened but not ended is refused', (() => {
    const s = expectOk(endHockeyMatch(regulation(start('usa_hockey_youth')), {}, next()))
    return expectOk(reopenHockeyMatch(s, { reason: 'Check' }, next()))
  })(), true)
  add('in progress is refused', goal(start('usa_hockey_youth'), 'tracked'), true)

  const out = cases.map(({ name, state, refuse }) => {
    const p = projection(state)
    const sport = hockeySportState(state)!
    return {
      name,
      refuse: !!refuse,
      status: p.status,
      expected: p.result?.finalScore ?? p.score,
      result: p.result,
      shootoutWinner: p.shootout?.winner ?? null,
      setup: sport.setup,
      events: state.eventStream!.events,
    }
  })
  expect(out.map(c => [c.name, c.refuse ? 'refused' : `${c.expected.tracked}-${c.expected.opponent}`])).toEqual([
    ['regulation win with shots, adjustments and an undone goal', '3-1'],
    ['youth tie accepted', '1-1'],
    ['scoreless youth tie', '0-0'],
    ['shootout early clinch', '1-0'],
    ['shootout sudden death after a complete round', '0-1'],
    ['review probe 1: reasoned end after one shootout goal', '0-0'],
    ['review probe 2: reasoned end after an unanswered sudden-death goal', '0-0'],
    ['shootout abandoned mid-round', '0-0'],
    ['overtime goal after a tied regulation', '1-2'],
    ['abandoned in the second period', '2-1'],
    ['ended early with a reason', '0-1'],
    ['reopened and ended again', '1-1'],
    ['suspended is refused', 'refused'],
    ['reopened but not ended is refused', 'refused'],
    ['in progress is refused', 'refused'],
  ])
  const target = process.env.HKY5A_CASES_OUT
  if (target) writeFileSync(target, JSON.stringify(out, null, 1))
})
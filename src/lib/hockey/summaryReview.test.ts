import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { recordHockeyFaceoff, recordHockeyShootoutAttempt, recordHockeyShot, startHockeyShootout } from './captureCommands'
import { endHockeyMatch, endHockeyPeriod, startHockeyGame, startNextHockeyPeriod } from './live'
import { HOCKEY_FACEOFF_DOT_IDS } from './rinkGeometry'
import { hockeySummaryTabs } from './summary'
import {
  DEFAULT_HOCKEY_SHOT_MAP_FILTERS,
  hockeyFaceoffMap,
  hockeyShotMap,
  hockeyShotMapShots,
  rotateHockeyFaceoffDot,
} from './summaryRink'
import { hockeyShootoutSummary } from './summaryShootout'
import { hockeySummaryFromState, type HockeySummarySource } from './summarySource'
import { CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame } from './testFixtures'
import { hockeyTimeline } from './timeline'

const NAMES = { tracked: 'Blades', opponent: 'Rivals' }

function healthy(state: GameState): HockeySummarySource {
  const source = hockeySummaryFromState('local', state, null, null)
  if (!source.healthy || !source.sport || !source.lines) throw new Error(`Unhealthy: ${source.diagnostic}`)
  return source
}

/** Clockless; the tracked side attacks left to right in period 1 and right to left in period 2. */
function twoPeriods(): GameState {
  let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
  // Period 1: a tracked goal near the right net, an opponent save near the left net, an unlocated miss.
  state = expectOk(recordHockeyShot(state, {
    side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, strength: 'pp', location: { x: 0.9, y: 0.4 },
  }, ctx(1)))
  state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved', shooter: { label: '#12' }, location: { x: 0.1, y: 0.5 } }, ctx(2)))
  state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'missed', shooter: { participantId: 'p3' } }, ctx(3)))
  state = expectOk(recordHockeyFaceoff(state, { dotId: 'left_end_upper', winner: 'tracked', takerParticipantId: 'p2' }, ctx(4)))
  state = expectOk(endHockeyPeriod(state, {}, ctx(5)))
  state = expectOk(startNextHockeyPeriod(state, ctx(6)))
  // Period 2: the same spot from the tracked side's view, played at the other end.
  state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p3' }, location: { x: 0.1, y: 0.6 } }, ctx(7)))
  state = expectOk(recordHockeyFaceoff(state, { dotId: 'right_end_lower', winner: 'opponent', takerParticipantId: 'p4' }, ctx(8)))
  state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p2' }, ctx(9)))
  return state
}

describe('Summary shot map', () => {
  it('turns every period to one direction per side and clusters shots at one spot', () => {
    const source = healthy(twoPeriods())
    const shots = hockeyShotMapShots(source.sport!.setup, source.inspection.activeEvents, NAMES)
    expect(shots.map(shot => [shot.side, shot.outcome, shot.point])).toEqual([
      ['tracked', 'goal', { x: 0.9, y: 0.4 }],
      ['opponent', 'saved', { x: 0.1, y: 0.5 }],
      ['tracked', 'missed', null],
      ['tracked', 'saved', { x: 0.9, y: 0.4 }],
    ])
    expect(shots.map(shot => shot.shooter)).toEqual(['#2 Player 2', '#12', '#3 Player 3', '#3 Player 3'])
    expect(shots.map(shot => shot.strength)).toEqual(['PP', null, null, null])

    const map = hockeyShotMap(source.sport!.setup, shots)
    expect(map.clusters.map(cluster => cluster.shots.length)).toEqual([2, 1])
    expect(map.clusters[0].shots.map(shot => shot.periodLabel)).toEqual(['Period 1', 'Period 2'])
    expect(map.unlocated.map(shot => shot.outcome)).toEqual(['missed'])
    expect(map.shooters.map(shooter => shooter.id)).toEqual(['p2', 'p3'])
    expect(map.periods).toEqual([{ id: 'regulation-1', label: 'Period 1' }, { id: 'regulation-2', label: 'Period 2' }])
  })

  it('filters by side, player, period, outcome and strength', () => {
    const source = healthy(twoPeriods())
    const shots = hockeyShotMapShots(source.sport!.setup, source.inspection.activeEvents, NAMES)
    const kept = (changes: Partial<typeof DEFAULT_HOCKEY_SHOT_MAP_FILTERS>) =>
      hockeyShotMap(source.sport!.setup, shots, { ...DEFAULT_HOCKEY_SHOT_MAP_FILTERS, ...changes }).shots.map(shot => shot.eventId)
    const ids = shots.map(shot => shot.eventId)
    expect(kept({ side: 'opponent' })).toEqual([ids[1]])
    expect(kept({ participantId: 'p3' })).toEqual([ids[2], ids[3]])
    expect(kept({ periodId: 'regulation-2' })).toEqual([ids[3]])
    expect(kept({ outcomes: ['goal', 'missed'] })).toEqual([ids[0], ids[2]])
    expect(kept({ strength: 'PP' })).toEqual([ids[0]])
    expect(kept({ strength: 'EV' })).toEqual([])
    // A filter that hides the located shot of a spot leaves a single mark, not a cluster.
    expect(hockeyShotMap(source.sport!.setup, shots, { ...DEFAULT_HOCKEY_SHOT_MAP_FILTERS, outcomes: ['goal'] }).clusters
      .map(cluster => cluster.shots.length)).toEqual([1])
  })
})

describe('Summary faceoff map', () => {
  it('rotates dots half a turn, so left-upper and right-lower swap', () => {
    expect(rotateHockeyFaceoffDot('left_end_upper')).toBe('right_end_lower')
    expect(rotateHockeyFaceoffDot('right_neutral_upper')).toBe('left_neutral_lower')
    expect(rotateHockeyFaceoffDot('center')).toBe('center')
    for (const id of HOCKEY_FACEOFF_DOT_IDS) expect(rotateHockeyFaceoffDot(rotateHockeyFaceoffDot(id))).toBe(id)
  })

  it('tallies each dot from the tracked side\'s view, by taker and period', () => {
    const source = healthy(twoPeriods())
    const { setup } = source.sport!
    const events = source.inspection.activeEvents
    const map = hockeyFaceoffMap(setup, events)
    // Period 2's right-lower dot is period 1's left-upper dot for the tracked side.
    expect(map.dots.left_end_upper).toEqual({ won: 1, lost: 1, percent: 50 })
    expect(map.dots.center).toEqual({ won: 1, lost: 0, percent: 100 })
    expect(map.dots.right_end_lower).toEqual({ won: 0, lost: 0, percent: null })
    expect(map.total).toEqual({ won: 2, lost: 1, percent: 67 })
    expect(map.takers.map(taker => taker.id)).toEqual(['p2', 'p4'])
    expect(hockeyFaceoffMap(setup, events, { participantId: 'p2', periodId: null }).total).toEqual({ won: 2, lost: 0, percent: 100 })
    expect(hockeyFaceoffMap(setup, events, { participantId: null, periodId: 'regulation-1' }).dots.left_end_upper)
      .toEqual({ won: 1, lost: 0, percent: 100 })
  })
})

/** NHL regular season, clockless, tied through one overtime: a shootout is next. */
function toShootout(): GameState {
  let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile: 'nhl_regular', rules: CLOCKLESS })), ctx(0)))
  let second = 1
  for (let period = 1; period <= 4; period++) {
    if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(second++)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(second++)))
  }
  return state
}

describe('Summary shootout', () => {
  it('appears only once a shootout starts', () => {
    const state = toShootout()
    const source = healthy(state)
    expect(hockeyShootoutSummary(source.sport!, source.lines!)).toBeNull()
    expect(hockeySummaryTabs(source.sport!.projection).map(entry => entry.tab)).not.toContain('shootout')
    const started = healthy(expectOk(startHockeyShootout(state, { firstSide: 'opponent' }, ctx(100))))
    expect(hockeySummaryTabs(started.sport!.projection).map(entry => entry.tab)).toContain('shootout')
    expect(hockeyShootoutSummary(started.sport!, started.lines!)).toMatchObject({ roundRows: [], winner: null, rounds: 3 })
  })

  it('lists rounds first side first, marks the deciding attempt and keeps attempts out of other totals', () => {
    let state = expectOk(startHockeyShootout(toShootout(), { firstSide: 'opponent' }, ctx(100)))
    const attempt = (outcome: 'goal' | 'saved' | 'missed', shooter: { participantId: string } | { label: string } | null) => {
      state = expectOk(recordHockeyShootoutAttempt(state, { outcome, shooter }, ctx(101)))
    }
    attempt('saved', { label: '#9' })
    attempt('goal', { participantId: 'p2' })
    attempt('missed', null)
    attempt('goal', { participantId: 'p3' })
    // 2-0 with one opponent attempt left: decided on the tracked side's second attempt.
    state = expectOk(endHockeyMatch(state, {}, ctx(102)))
    const source = healthy(state)
    const summary = hockeyShootoutSummary(source.sport!, source.lines!)!
    expect(summary).toMatchObject({ firstSide: 'opponent', goals: { tracked: 2, opponent: 0 }, winner: 'tracked' })
    expect(summary.roundRows.map(row => row.attempts.map(entry => [entry.side, entry.shooter, entry.goalie, entry.outcome, entry.deciding]))).toEqual([
      [['opponent', '#9', '#1 Player 1', 'saved', false], ['tracked', '#2 Player 2', '#35', 'goal', false]],
      [['opponent', 'Not named', '#1 Player 1', 'missed', false], ['tracked', '#3 Player 3', '#35', 'goal', true]],
    ])
    expect(summary.shooters).toEqual([
      { participantId: 'p2', name: '#2 Player 2', attempts: 1, goals: 1 },
      { participantId: 'p3', name: '#3 Player 3', attempts: 1, goals: 1 },
    ])
    // The miss is not an attempt on goal.
    expect(summary.goalies).toEqual([{ participantId: 'p1', name: '#1 Player 1', shotsAgainst: 1, saves: 1 }])
    expect(hockeyShotMapShots(source.sport!.setup, source.inspection.activeEvents, NAMES)).toEqual([])
    expect(source.lines!.participants.p2.hky_g ?? 0).toBe(0)
  })
})

describe('Summary Timeline', () => {
  it('reads the selected source, oldest first by period', () => {
    const source = healthy(twoPeriods())
    const timeline = hockeyTimeline(source.state, NAMES)
    const capture = timeline.rows.filter(row => row.capture)
    expect(capture.map(row => row.periodId)).toEqual([
      'regulation-1', 'regulation-1', 'regulation-1', 'regulation-1', 'regulation-2', 'regulation-2', 'regulation-2',
    ])
    expect(capture[0].label).toMatch(/Blades goal/)
    expect(timeline.historyMessage).toBeNull()
  })
})

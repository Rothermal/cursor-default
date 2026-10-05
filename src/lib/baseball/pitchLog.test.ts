import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { baseballMovement, baseballSportState, proposeBaseballMovements, recordBaseballPlateAppearance, substituteBaseball } from './commands'
import {
  BASEBALL_PITCH_DEFAULT_FILTER,
  baseballPitchCounts,
  baseballPitchKind,
  baseballPitchLog,
  baseballPitchPlot,
  baseballPitchPlotClusters,
} from './pitchLog'
import { baseballScoreboardView } from './trackerView'
import { baseballSetup, ctx, expectOk, inPlay, pitch, pitches, projection, startedGame, strikeout } from './testFixtures'
import { baseballActiveEvents } from './units'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const sportOf = (state: GameState) => baseballSportState(state)!
const logOf = (state: GameState) => baseballPitchLog(sportOf(state), baseballActiveEvents(state))

function inPlayOut(state: GameState, location: { x: number; y: number } | null = null): GameState {
  const detail = inPlay('out', { fielders: [6, 3] })
  return pitch(state, {
    result: 'in_play',
    inPlay: detail,
    pitchLocation: location,
    movements: proposeBaseballMovements(projection(state), 'out', [6, 3]),
  })
}

function quickStrikeout(state: GameState, finalCount: [number, number] | null): GameState {
  const batter = projection(state).currentBatterId!
  return expectOk(recordBaseballPlateAppearance(state, {
    result: 'strikeout_swinging',
    finalBalls: finalCount?.[0] ?? null,
    finalStrikes: finalCount?.[1] ?? null,
    movements: [baseballMovement(batter, 'batter', 'out', 'on_play', { fielders: [2] })],
  }, ctx()))
}

function quickWalk(state: GameState): GameState {
  return expectOk(recordBaseballPlateAppearance(state, {
    result: 'walk',
    movements: proposeBaseballMovements(projection(state), 'walk'),
  }, ctx()))
}

describe('Baseball pitch log', () => {
  it('gives the count before every pitch of a plate appearance, two-strike fouls included', () => {
    let state = pitches(startedGame(), 'ball', 'called_strike', 'swinging_strike', 'foul', 'foul', 'ball')
    state = inPlayOut(state)
    const log = logOf(state)
    expect(log.map(entry => entry.count)).toEqual(['0-0', '1-0', '1-1', '1-2', '1-2', '1-2', '2-2'])
    expect(log.map(entry => entry.kind)).toEqual(['ball', 'called_strike', 'swinging_strike', 'foul', 'foul', 'ball', 'in_play'])
    expect(new Set(log.map(entry => entry.pitcherId))).toEqual(new Set(['t1']))
    expect(log.every(entry => entry.batterId === 'o1' && entry.side === 'tracked' && entry.halfLabel === 'Top 1')).toBe(true)
    // The in-play pitch opens its own play.
    expect(log[6].playId).toBe(log[6].eventId)
  })

  it('leaves Quick PA plate appearances out and restarts the count for the next batter', () => {
    let state = quickStrikeout(startedGame(), [1, 2])
    state = pitches(state, 'ball')
    const log = logOf(state)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ batterId: 'o2', count: '0-0' })
  })

  it('takes batter hands from setup and the opponent slot details at that time', () => {
    let state = pitches(startedGame(), 'ball')
    state = expectOk(substituteBaseball(state, 'opponent', { kind: 'opponent_slot', slotId: 'o1', label: 'Garcia', number: '12', position: 'CF', bats: 'L' }, ctx()))
    state = pitches(state, 'ball')
    expect(logOf(state).map(entry => entry.batterHand)).toEqual([null, 'L'])

    // Our batters' hands come from the frozen setup.
    let home = startedGame(baseballSetup({ trackedSide: 'away' }))
    home = pitches(home, 'ball')
    expect(logOf(home)[0]).toMatchObject({ batterId: 't1', batterHand: 'R', side: 'opponent', pitcherId: 'opp-p1' })
  })

  it('groups pad results into six kinds', () => {
    expect(baseballPitchKind('intentional_ball')).toBe('ball')
    expect(baseballPitchKind('pitchout')).toBe('ball')
    expect(baseballPitchKind('foul_tip')).toBe('swinging_strike')
    expect(baseballPitchKind('missed_bunt')).toBe('swinging_strike')
    expect(baseballPitchKind('foul_bunt')).toBe('foul')
    expect(baseballPitchKind('hit_by_pitch')).toBe('hit_by_pitch')
  })
})

describe('Baseball pitch plot', () => {
  it('plots located pitches and filters by pitcher, result, hand and count', () => {
    let state = pitch(startedGame(), { result: 'ball', pitchLocation: { x: -0.3, y: 0.5 } })
    state = pitch(state, { result: 'called_strike', pitchLocation: { x: 0.5, y: 0.5 } })
    state = pitch(state, { result: 'foul' })
    state = inPlayOut(state, { x: 0.4, y: 0.6 })
    const sport = sportOf(state)
    const log = logOf(state)
    const all = baseballPitchPlot(sport, log)
    expect(all.points.map(point => [point.x, point.kind])).toEqual([[-0.3, 'ball'], [0.5, 'called_strike'], [0.4, 'in_play']])
    expect(all.unlocated).toBe(1)
    expect(all.pitchers).toEqual([{ id: 't1', name: '#1 Player 1', side: 'tracked' }])
    expect(all.counts).toEqual(['0-0', '1-0', '1-1', '1-2'])
    expect(all.points[1].label).toBe('#1 Player 1 to Batter 1, 1-0: Called strike')

    const filter = BASEBALL_PITCH_DEFAULT_FILTER
    expect(baseballPitchPlot(sport, log, { ...filter, kind: 'foul' })).toMatchObject({ points: [], unlocated: 1 })
    expect(baseballPitchPlot(sport, log, { ...filter, count: '1-0' }).points.map(point => point.kind)).toEqual(['called_strike'])
    expect(baseballPitchPlot(sport, log, { ...filter, batterHand: 'R' }).points).toHaveLength(0)
    expect(baseballPitchPlot(sport, log, { ...filter, batterHand: 'unknown' }).points).toHaveLength(3)
    expect(baseballPitchPlot(sport, log, { ...filter, pitcherId: 'opp-p1' }).points).toHaveLength(0)
  })
})

describe('Baseball pitch plot overlaps', () => {
  const spot = { x: 0.5, y: 0.5 }

  it('puts identical-location pitches with identical filters into one chooser, in game order', () => {
    let state = startedGame()
    for (const result of ['called_strike', 'called_strike', 'foul', 'foul', 'foul'] as const) {
      state = pitch(state, { result, pitchLocation: spot })
    }
    const sport = sportOf(state)
    const plot = baseballPitchPlot(sport, logOf(state), { ...BASEBALL_PITCH_DEFAULT_FILTER, kind: 'foul', count: '0-2' })
    expect(plot.points).toHaveLength(3)
    expect(plot.clusters).toHaveLength(1)
    const [cluster] = plot.clusters
    expect(cluster.points.map(point => point.eventId)).toEqual(plot.points.map(point => point.eventId))
    expect(new Set(cluster.points.map(point => point.playId)).size).toBe(3)
    // Same filters, same pitch label: the context still tells them apart.
    expect(new Set(cluster.points.map(point => point.label)).size).toBe(1)
    expect(cluster.points.map(point => point.context)).toEqual([
      'Top 1 · Pitch 3 · 0-2 · Foul',
      'Top 1 · Pitch 4 · 0-2 · Foul',
      'Top 1 · Pitch 5 · 0-2 · Foul',
    ])
    // Grouping is stable for the same input.
    expect(baseballPitchPlotClusters(plot.points)).toEqual(plot.clusters)

    // Without filters all five share the spot.
    const all = baseballPitchPlot(sport, logOf(state))
    expect(all.clusters).toHaveLength(1)
    expect(all.clusters[0].points.map(point => point.sequence)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps marks apart once they are farther than a fingertip and joins each to the first nearby group', () => {
    let state = startedGame()
    // Pad frame span is 2.5 zone widths, so 0.1 zone = 0.04 display (joins) and 0.2 = 0.08 (apart).
    state = pitch(state, { result: 'ball', pitchLocation: { x: 0.5, y: 0.5 } })
    state = pitch(state, { result: 'ball', pitchLocation: { x: 0.6, y: 0.5 } })
    state = pitch(state, { result: 'called_strike', pitchLocation: { x: 0.7, y: 0.5 } })
    const plot = baseballPitchPlot(sportOf(state), logOf(state))
    expect(plot.clusters.map(cluster => cluster.points.map(point => point.sequence))).toEqual([[1, 2], [3]])
  })
})

describe('Baseball pitch counts', () => {
  it('splits a mixed total into recorded, estimated, untracked and unlocated, matching the box score and tracker', () => {
    const rules = { pitchCountWarnings: [5], pitchCountLimit: 9 }
    let state = startedGame(baseballSetup({ rules }))
    // o1: three recorded pitches, one without a location.
    state = pitch(state, { result: 'ball', pitchLocation: { x: -0.2, y: 0.3 } })
    state = pitch(state, { result: 'called_strike' })
    state = inPlayOut(state, { x: 0.5, y: 0.5 })
    // o2: Quick PA strikeout with a final count; o3: Quick PA walk without one.
    state = quickStrikeout(state, [1, 2])
    state = quickWalk(state)

    const sport = sportOf(state)
    const line = sport.projection.pitchingLines.t1
    const [tracked] = baseballPitchCounts(sport, baseballActiveEvents(state), logOf(state))
    expect(tracked.side).toBe('tracked')
    expect(tracked.rows).toHaveLength(1)
    const row = tracked.rows[0]
    expect(row).toMatchObject({
      id: 't1',
      pitches: line.pitches,
      strikes: line.strikes,
      balls: line.balls,
      battersFaced: 3,
      recorded: 3,
      estimated: line.pitches - 3,
      untrackedPlateAppearances: 2,
      unlocated: 1,
      lowerBound: true,
    })
    expect(row.estimated).toBeGreaterThan(0)
    expect(row.strikePercent).toBe(Math.round((line.strikes / line.pitches) * 100))
    // The tracker's pitch count and its warning read the same total.
    const scoreboard = baseballScoreboardView(sport, names).pitcher!
    expect(scoreboard.pitches).toBe(row.pitches)
    expect(scoreboard.alert).toEqual(row.alert)
    expect(row.alert).toEqual({ kind: 'warning', threshold: 5 })
  })

  it('reaches the limit on the same pitch as the tracker', () => {
    let state = startedGame(baseballSetup({ rules: { pitchCountWarnings: [3], pitchCountLimit: 4 } }))
    const alerts: Array<[unknown, unknown]> = []
    for (let index = 0; index < 4; index += 1) {
      state = pitches(state, index % 2 === 0 ? 'ball' : 'foul')
      const sport = sportOf(state)
      const [tracked] = baseballPitchCounts(sport, baseballActiveEvents(state), logOf(state))
      alerts.push([tracked.rows[0].alert, baseballScoreboardView(sport, names).pitcher!.alert])
    }
    expect(alerts.map(([summary]) => summary)).toEqual([null, null, { kind: 'warning', threshold: 3 }, { kind: 'limit', threshold: 4 }])
    expect(alerts.every(([summary, tracker]) => JSON.stringify(summary) === JSON.stringify(tracker))).toBe(true)
  })

  it('lists the opponent pitcher once they appear and a recorded-only pitcher without an estimate', () => {
    let state = startedGame()
    for (let index = 0; index < 3; index += 1) state = strikeout(state)
    state = pitches(state, 'ball')
    const counts = baseballPitchCounts(sportOf(state), baseballActiveEvents(state), logOf(state))
    const opponent = counts.find(entry => entry.side === 'opponent')!
    expect(opponent.rows).toEqual([expect.objectContaining({ id: 'opp-p1', pitches: 1, recorded: 1, estimated: 0, lowerBound: false })])
    expect(counts[0].rows[0]).toMatchObject({ recorded: 9, estimated: 0, untrackedPlateAppearances: 0 })
  })
})

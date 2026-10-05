import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { baseballBoxScore } from './boxScore'
import { baseballMovement, baseballSportState, endBaseballGame, recordBaseballBaserunning, recordBaseballPlateAppearance, reopenBaseballGame, substituteBaseball } from './commands'
import {
  baseballSummaryPath,
  baseballSummarySource,
  baseballSummaryView,
  isBaseballSummaryRoute,
  parseBaseballSummaryTab,
} from './summary'
import { baseballActiveEvents } from './units'
import {
  ballInPlay,
  baseballSetup,
  ctx,
  expectOk,
  inPlay,
  projection,
  startedGame,
  strikeout,
  threeUpThreeDown,
  walk,
} from './testFixtures'
import { sports } from '../../config/sports'
import { createInitialState } from '../gameReducer'
import { routeForResumedGame } from '../sportNavigation'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const sportOf = (state: GameState) => baseballSportState(state)!
const box = (state: GameState) => baseballBoxScore(sportOf(state), baseballActiveEvents(state))

/** Plays scoreless halves until the given half of the given inning is up. */
function scorelessUntil(state: GameState, inning: number, half: 'top' | 'bottom'): GameState {
  let next = state
  while (projection(next).inning < inning || (projection(next).inning === inning && projection(next).half !== half)) {
    next = threeUpThreeDown(next)
  }
  return next
}

/** Tracked team at home wins 2-0 in seven: a two-run homer in the bottom 1st. */
function homeWinInSeven(): GameState {
  let state = threeUpThreeDown(startedGame())
  state = ballInPlay(state, 'single', { fielders: [8] })
  state = ballInPlay(state, 'home_run')
  state = strikeout(strikeout(strikeout(state)))
  state = scorelessUntil(state, 7, 'top')
  state = threeUpThreeDown(state)
  expect(projection(state).pendingEnd).toBe('regulation')
  return expectOk(endBaseballGame(state, 'completed', ctx()))
}

describe('Baseball Summary route', () => {
  it('claims local Baseball event games and leaves cloud and other games alone', () => {
    const state = startedGame()
    expect(isBaseballSummaryRoute(state, new URLSearchParams())).toBe(true)
    expect(isBaseballSummaryRoute(state, new URLSearchParams('gameId=abc'))).toBe(false)
    const legacy = { ...createInitialState(), sport: sports.find(sport => sport.id === 'baseball')! }
    expect(isBaseballSummaryRoute(legacy, new URLSearchParams())).toBe(false)
    const basketball = { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')! }
    expect(isBaseballSummaryRoute(basketball, new URLSearchParams())).toBe(false)
  })

  it('resumes a finished game on its Summary and a live one on the tracker', () => {
    const live = { ...startedGame(), gameInfo: { teamName: 'Aces', opponentName: 'Visitors', tournamentName: '', date: '2026-10-03' } }
    expect(routeForResumedGame(live)).not.toBe('/summary?tab=overview')
    const final = { ...homeWinInSeven(), gameInfo: live.gameInfo }
    expect(routeForResumedGame(final)).toBe('/summary?tab=overview')
  })

  it('keeps the tab in the query and falls back to Overview', () => {
    expect(parseBaseballSummaryTab(new URLSearchParams('tab=box'))).toBe('box')
    expect(parseBaseballSummaryTab(new URLSearchParams('tab=plays'))).toBe('plays')
    expect(parseBaseballSummaryTab(new URLSearchParams('tab=spray'))).toBe('spray')
    expect(parseBaseballSummaryTab(new URLSearchParams('tab=pitches'))).toBe('pitches')
    expect(parseBaseballSummaryTab(new URLSearchParams('tab=nonsense'))).toBe('overview')
    expect(baseballSummaryPath('box')).toBe('/summary?tab=box')
  })
})

describe('Baseball Summary source', () => {
  it('replays the stream instead of trusting the stored projection', () => {
    const state = homeWinInSeven()
    const sport = sportOf(state)
    const tampered: GameState = {
      ...state,
      sportGameState: { ...sport, projection: { ...sport.projection, score: { tracked: 99, opponent: 0 } } },
    }
    const source = baseballSummarySource(tampered)
    expect(source.healthy).toBe(true)
    expect(source.sport?.projection.score).toEqual({ tracked: 2, opponent: 0 })
  })

  it('withholds totals from a stream that no longer replays', () => {
    const state = homeWinInSeven()
    const stream = state.eventStream!
    const broken: GameState = {
      ...state,
      eventStream: { ...stream, events: [...stream.events, { not: 'an event' }] },
    }
    const source = baseballSummarySource(broken)
    expect(source.healthy).toBe(false)
    expect(source.diagnostic).toBeTruthy()
    // The setup stays for names and context.
    expect(source.sport?.setup.opponentName).toBe('Visitors')
  })
})

describe('Baseball Summary overview', () => {
  it('shows the result, the line score with an unneeded bottom half as X, and LOB', () => {
    const view = baseballSummaryView(sportOf(homeWinInSeven()), names, '2026-10-03')
    expect(view.scoreLine).toBe('Aces 2, Visitors 0')
    expect(view.statusLabel).toBe('Final')
    expect(view.outcomeForTracked).toBe('Win')
    expect(view.innings).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(view.away).toMatchObject({ name: 'Visitors', runs: 0, hits: 0, errors: 0 })
    expect(view.away.cells).toEqual(['0', '0', '0', '0', '0', '0', '0'])
    expect(view.home).toMatchObject({ name: 'Aces', runs: 2, hits: 2, leftOnBase: 0 })
    expect(view.home.cells).toEqual(['2', '0', '0', '0', '0', '0', 'X'])
    expect(view.facts[0]).toEqual({ label: 'Date', value: '2026-10-03' })
    expect(view.facts).toContainEqual({ label: 'Innings', value: '7 scheduled' })
  })

  it('names the winner first and counts runners left on base', () => {
    let state = startedGame(baseballSetup({ trackedSide: 'away' }))
    state = walk(state)
    state = threeUpThreeDown(state)
    const view = baseballSummaryView(sportOf(state), names)
    expect(view.away.leftOnBase).toBe(1)
    expect(view.statusLabel).toBe('In progress · Bottom 1')
    expect(view.outcomeForTracked).toBeNull()
    expect(view.scoreLine).toBe('Aces 0, Visitors 0')
  })

  it('labels extra innings, ties and suspensions', () => {
    let state = scorelessUntil(startedGame(), 8, 'top')
    state = threeUpThreeDown(state)
    state = ballInPlay(state, 'home_run')
    expect(projection(state).pendingEnd).toBe('walk_off')
    const walkOff = expectOk(endBaseballGame(state, 'completed', ctx()))
    expect(baseballSummaryView(sportOf(walkOff), names)).toMatchObject({
      statusLabel: 'Final in 8',
      scoreLine: 'Aces 1, Visitors 0',
    })
    expect(baseballSummaryView(sportOf(walkOff), names).home.cells.slice(-1)).toEqual(['1'])

    const suspended = expectOk(endBaseballGame(scorelessUntil(startedGame(), 3, 'top'), 'suspended', ctx()))
    expect(baseballSummaryView(sportOf(suspended), names)).toMatchObject({ statusLabel: 'Suspended · Top 3', outcomeForTracked: null })

    const reopened = expectOk(reopenBaseballGame(suspended, 'Resumed', ctx()))
    expect(baseballSummaryView(sportOf(reopened), names).statusLabel).toBe('In progress · Top 3')
  })
})

describe('Baseball box score', () => {
  it('matches the projection lines and lists notes under the table', () => {
    const state = homeWinInSeven()
    const p = projection(state)
    const score = box(state)
    const tracked = score.batting.tracked
    expect(tracked.rows.map(row => row.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'])
    for (const row of tracked.rows) expect(row.line).toEqual(p.battingLines[row.id] ?? expect.objectContaining({ pa: 0 }))
    expect(tracked.rows[0]).toMatchObject({ name: '#1 Player 1', position: 'P', substitute: false })
    expect(tracked.totals).toEqual({
      ab: tracked.rows.reduce((sum, row) => sum + row.line.ab, 0),
      r: 2,
      h: 2,
      rbi: 2,
      bb: 0,
      k: tracked.rows.reduce((sum, row) => sum + row.line.k, 0),
    })
    expect(tracked.notes).toEqual([{ label: 'HR', text: '#2 Player 2' }])
    expect(score.batting.opponent.rows).toHaveLength(9)
    expect(score.batting.opponent.rows[0]).toMatchObject({ name: 'Batter 1', tracked: false })
    expect(score.batting.opponent.totals.h).toBe(0)
  })

  it('formats pitching for both teams in mound order', () => {
    const score = box(homeWinInSeven())
    expect(score.pitching.tracked.rows).toHaveLength(1)
    expect(score.pitching.tracked.rows[0]).toMatchObject({ id: 't1', ip: '7.0' })
    expect(score.pitching.tracked.totals).toMatchObject({ ip: '7.0', h: 0, r: 0, k: 21 })
    expect(score.pitching.opponent.rows[0]).toMatchObject({ name: '#21 Starter', ip: '6.0' })
    expect(score.pitching.opponent.totals).toMatchObject({ h: 2, r: 2, er: 2, hr: 1 })
    expect(score.pitching.opponent.notes).toEqual([{ label: 'HR', text: '#21 Starter' }])
  })

  it('indents substitutes under the slot they took, with PH and positions', () => {
    let state = threeUpThreeDown(startedGame())
    state = strikeout(state)
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't2' }, ctx()))
    state = ballInPlay(state, 'single', { fielders: [7] })
    state = strikeout(strikeout(state))
    // Top 2: t10 takes over at second base, then a reliever comes in.
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 2, incomingId: 't10', outgoingId: null }, ctx()))
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't11', outgoingId: 't1' }, ctx()))
    state = strikeout(state)
    const score = box(state)
    const rows = score.batting.tracked.rows
    expect(rows.slice(0, 4).map(row => [row.id, row.position, row.substitute])).toEqual([
      ['t1', 'P', false],
      ['t11', 'P', true],
      ['t2', 'C', false],
      ['t10', 'C', true],
    ])
    expect(score.pitching.tracked.rows.map(row => [row.id, row.ip])).toEqual([
      ['t1', '1.0'],
      ['t11', '0.1'],
    ])
    expect(score.fielding.rows.map(row => row.id)).toEqual(expect.arrayContaining(['t10', 't11']))
  })

  it('keeps a reliever whose only credit is a wild pitch or balk on a runner play', () => {
    for (const play of ['wild_pitch', 'balk'] as const) {
      let state = walk(startedGame())
      state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
      state = expectOk(recordBaseballBaserunning(state, play, [baseballMovement('o1', 'first', 'second', play)], ctx()))
      state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't11', outgoingId: 't10' }, ctx()))
      const pitching = box(state).pitching.tracked
      // t11 is on the mound now, so it is listed too.
      expect(pitching.rows.map(row => [row.id, row.ip])).toEqual([['t1', '0.0'], ['t10', '0.0'], ['t11', '0.0']])
      expect(pitching.notes).toEqual([{ label: play === 'wild_pitch' ? 'WP' : 'BK', text: '#10 Player 10' }])
    }
  })

  it('keeps an opponent reliever whose only credit is a wild pitch', () => {
    let state = walk(threeUpThreeDown(startedGame()))
    const reliever = { id: 'opp-p2', label: 'Reliever', number: '33', throws: 'R' as const }
    state = expectOk(substituteBaseball(state, 'opponent', { kind: 'opponent_pitcher', pitcher: reliever }, ctx()))
    state = expectOk(recordBaseballBaserunning(state, 'wild_pitch', [baseballMovement('t1', 'first', 'second', 'wild_pitch')], ctx()))
    state = expectOk(substituteBaseball(state, 'opponent', { kind: 'opponent_pitcher', pitcher: { id: 'opp-p3', label: 'Closer', number: '44', throws: 'L' } }, ctx()))
    const pitching = box(state).pitching.opponent
    expect(pitching.rows.map(row => row.name)).toEqual(['#21 Starter', '#33 Reliever', '#44 Closer'])
    expect(pitching.notes).toEqual([{ label: 'WP', text: '#33 Reliever' }])
  })

  it('leaves out a starter replaced before the first pitch', () => {
    let state = startedGame()
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    expect(box(state).pitching.tracked.rows.map(row => row.id)).toEqual(['t10'])
  })

  it('shows PH for a pinch hitter who never fields', () => {
    let state = threeUpThreeDown(startedGame())
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
    state = strikeout(state)
    const row = box(state).batting.tracked.rows.find(entry => entry.id === 't10')
    expect(row).toMatchObject({ position: 'PH', substitute: true })
  })

  it('marks pitch totals that include Quick PA plate appearances as a lower bound', () => {
    let state = startedGame()
    const batter = projection(state).currentBatterId!
    state = expectOk(
      recordBaseballPlateAppearance(
        state,
        {
          result: 'in_play',
          inPlay: inPlay('double', { battedBallType: 'line' }),
          finalBalls: 2,
          finalStrikes: 1,
          movements: [baseballMovement(batter, 'batter', 'second', 'on_play')],
        },
        ctx()
      )
    )
    const score = box(state)
    expect(score.pitching.tracked.rows[0]).toMatchObject({ pitchesLowerBound: true })
    expect(score.pitching.tracked.rows[0].line.pitches).toBe(projection(state).pitchingLines.t1.pitches)
    expect(score.pitching.tracked.pitchesLowerBound).toBe(true)
    expect(score.pitching.opponent.pitchesLowerBound).toBe(false)
  })

  it('lists fielding credit with putouts and assists from the projection', () => {
    let state = startedGame()
    state = ballInPlay(state, 'out', { fielders: [6, 3] })
    const score = box(state)
    const shortstop = score.fielding.rows.find(row => row.id === 't6')
    const first = score.fielding.rows.find(row => row.id === 't3')
    expect(shortstop).toMatchObject({ position: 'SS', line: expect.objectContaining({ a: 1 }) })
    expect(first).toMatchObject({ position: '1B', line: expect.objectContaining({ po: 1 }) })
    expect(score.fielding.totals).toMatchObject({ po: 1, a: 1, e: 0 })
  })
})

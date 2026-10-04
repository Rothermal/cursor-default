import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { baseballMovement, baseballSportState, proposeBaseballMovements, recordBaseballBaserunning, recordBaseballPlateAppearance, substituteBaseball } from './commands'
import { previewBaseballRemoval, removeBaseballPlay } from './corrections'
import { BASEBALL_SPRAY_DEFAULT_FILTER, baseballSprayChart, baseballSprayResult } from './spray'
import { baseballSummaryPlays } from './summaryPlays'
import { ballInPlay, ctx, expectOk, inPlay, pitch, pitches, projection, startedGame, strikeout, threeUpThreeDown, walk } from './testFixtures'
import type { BaseballInPlay } from './types'
import { baseballActiveEvents } from './units'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const sportOf = (state: GameState) => baseballSportState(state)!

function located(state: GameState, result: BaseballInPlay['result'], x: number, y: number, options: Partial<BaseballInPlay> = {}): GameState {
  const detail = inPlay(result, options)
  const movements = proposeBaseballMovements(projection(state), result, detail.fielders)
  return pitch(state, { result: 'in_play', inPlay: detail, movements, location: { x, y } })
}

/** Top 1: a located double, a located fly out, an unlocated ground out, a strikeout. */
function topFirst(): GameState {
  let state = startedGame()
  state = located(state, 'double', 0.2, 0.3, { battedBallType: 'line' })
  state = located(state, 'out', 0.5, 0.25, { battedBallType: 'fly', fielders: [8] })
  state = pitch(state, {
    result: 'in_play',
    inPlay: inPlay('out', { fielders: [6, 3] }),
    movements: proposeBaseballMovements(projection(state), 'out', [6, 3]),
  })
  return strikeout(state)
}

function removeUnit(state: GameState, unitId: string): GameState {
  const preview = previewBaseballRemoval(state, unitId, names)
  if (!preview.ok) throw new Error(preview.message)
  const removed = removeBaseballPlay(state, preview.preview, names, { now: '2026-10-04T00:00:00.000Z', confirmed: true })
  if (!removed.ok) throw new Error(removed.message)
  return removed.state
}

const newestId = (state: GameState) => (events => events[events.length - 1].id)(baseballActiveEvents(state))

describe('Baseball Summary plays', () => {
  it('lists plays oldest first by half with each half line', () => {
    let state = topFirst()
    state = located(state, 'home_run', 0.5, 0.05, { battedBallType: 'fly' })
    const plays = baseballSummaryPlays(sportOf(state), baseballActiveEvents(state), names)
    expect(plays.halves.map(half => half.label)).toEqual(['Top 1', 'Bottom 1'])
    expect(plays.halves[0].line).toBe('0 R, 1 H, 0 E, 1 LOB')
    expect(plays.halves[0].rows.length).toBeGreaterThanOrEqual(4)
    expect(plays.halves[0].rows[0].label.toLowerCase()).toContain('double')
    expect(plays.halves[1].rows).toHaveLength(1)
    expect(plays.halves[1].rows[0]).toMatchObject({ kind: 'play', runs: 1 })
    expect(plays.scoringPlays).toBe(1)
  })

  it('folds count-only pitches into the plate appearance row and names the outcome', () => {
    let state = startedGame()
    state = pitches(state, 'ball', 'foul')
    state = strikeout(state)
    state = walk(state)
    const rows = baseballSummaryPlays(sportOf(state), baseballActiveEvents(state), names).halves[0].rows
    expect(rows.map(row => [row.label, row.pitches])).toEqual([
      ['Batter 1: Strikeout', ['Ball', 'Foul', 'Called strike']],
      ['Batter 2: Walk', ['Ball', 'Ball', 'Ball']],
    ])
  })

  it('groups by the replayed batter after a removed pinch hitter and keeps the recorded one', () => {
    let state = threeUpThreeDown(startedGame())
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
    const sub = newestId(state)
    state = pitches(state, 'ball')
    state = removeUnit(state, sub)
    state = ballInPlay(state, 'out', { fielders: [6, 3] })
    const bottom = baseballSummaryPlays(sportOf(state), baseballActiveEvents(state), names).halves[1]
    expect(bottom.rows).toHaveLength(1)
    expect(bottom.rows[0].label).toMatch(/^#1 Player 1: /)
    expect(bottom.rows[0]).toMatchObject({ pitches: ['Ball'], recordedBatter: '#10 Player 10' })
  })

  it('carries a folded pitch warning onto the plate appearance row', () => {
    let state = expectOk(substituteBaseball(startedGame(), 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    const change = newestId(state)
    state = pitches(state, 'ball')
    state = removeUnit(state, change)
    state = strikeout(state)
    const sport = sportOf(state)
    expect(sport.projection.warnings).toHaveLength(1)
    const [row] = baseballSummaryPlays(sport, baseballActiveEvents(state), names).halves[0].rows
    expect(row).toMatchObject({ label: 'Batter 1: Strikeout', pitches: ['Ball', 'Called strike', 'Called strike'], recordedBatter: null })
    expect(row.warning).toBe(sport.projection.warnings[0].message)
  })

  it('keeps pitches before a runner play as their own rows', () => {
    let state = walk(startedGame())
    state = pitches(state, 'ball')
    const runner = projection(state).bases.first!.runnerId
    state = expectOk(recordBaseballBaserunning(state, 'stolen_base', [baseballMovement(runner, 'first', 'second', 'stolen_base')], ctx()))
    state = pitches(state, 'called_strike')
    const rows = baseballSummaryPlays(sportOf(state), baseballActiveEvents(state), names).halves[0].rows
    expect(rows.slice(1).map(row => row.label)).toEqual(['Batter 2: Ball', 'Steal: Batter 1', 'Batter 2: Called strike'])
  })

  it('filters to scoring plays; lineup changes open details like plays', () => {
    let state = topFirst()
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
    state = located(state, 'home_run', 0.5, 0.05)
    const all = baseballSummaryPlays(sportOf(state), baseballActiveEvents(state), names)
    expect(all.halves[1].rows.map(row => row.kind)).toEqual(['play', 'play'])
    const scoring = baseballSummaryPlays(sportOf(state), baseballActiveEvents(state), names, { scoringOnly: true })
    expect(scoring.halves.map(half => half.label)).toEqual(['Bottom 1'])
    expect(scoring.halves[0].rows).toHaveLength(1)
    expect(scoring.scoringPlays).toBe(1)
  })

  it('leaves removed plays out', () => {
    const state = topFirst()
    const rows = baseballSummaryPlays(sportOf(state), baseballActiveEvents(state), names).halves[0].rows
    const firstPlay = rows[rows.length - 1]
    const preview = previewBaseballRemoval(state, firstPlay.id, names)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const removed = removeBaseballPlay(state, preview.preview, names, { now: '2026-10-04T00:00:00.000Z', confirmed: true })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    const after = baseballSummaryPlays(sportOf(removed.state), baseballActiveEvents(removed.state), names).halves.flatMap(half => half.rows)
    expect(after.map(row => row.id)).not.toContain(firstPlay.id)
  })
})

describe('Baseball spray chart', () => {
  it('plots located balls in play and counts the unlocated ones', () => {
    const state = topFirst()
    const chart = baseballSprayChart(sportOf(state), baseballActiveEvents(state))
    expect(chart.points.map(point => [point.x, point.y, point.result, point.battedBallType])).toEqual([
      [0.2, 0.3, 'hit', 'line'],
      [0.5, 0.25, 'out', 'fly'],
    ])
    expect(chart.points[0]).toMatchObject({ side: 'opponent', batterId: 'o1', label: 'Batter 1: double, line' })
    expect(chart.unlocated).toBe(1)
    expect(chart.batters.map(batter => batter.id)).toEqual(['o1', 'o2', 'o3'])
  })

  it('filters by team, batter, result and batted-ball type', () => {
    let state = topFirst()
    state = located(state, 'error', 0.4, 0.7, { battedBallType: 'ground', errorBy: 6 })
    const sport = sportOf(state)
    const events = baseballActiveEvents(state)
    const filter = BASEBALL_SPRAY_DEFAULT_FILTER
    expect(baseballSprayChart(sport, events, { ...filter, side: 'tracked' }).points.map(point => point.result)).toEqual(['error'])
    expect(baseballSprayChart(sport, events, { ...filter, side: 'opponent' }).points).toHaveLength(2)
    expect(baseballSprayChart(sport, events, { ...filter, batterId: 'o2' }).points.map(point => point.battedBallType)).toEqual(['fly'])
    expect(baseballSprayChart(sport, events, { ...filter, result: 'hit' }).points).toHaveLength(1)
    const ground = baseballSprayChart(sport, events, { ...filter, battedBallType: 'ground' })
    expect(ground.points).toHaveLength(1)
    expect(ground.unlocated).toBe(1)
    expect(baseballSprayChart(sport, events, { ...filter, side: 'tracked' }).batters.map(batter => batter.id)).toEqual(['t1'])
  })

  it('includes Quick PA balls in play and classifies results', () => {
    let state = startedGame()
    const batter = projection(state).currentBatterId!
    state = expectOk(recordBaseballPlateAppearance(state, {
      result: 'in_play',
      inPlay: inPlay('triple', { battedBallType: 'fly' }),
      location: { x: 0.85, y: 0.35 },
      movements: [baseballMovement(batter, 'batter', 'third', 'on_play')],
    }, ctx()))
    const chart = baseballSprayChart(sportOf(state), baseballActiveEvents(state))
    expect(chart.points).toHaveLength(1)
    expect(chart.points[0]).toMatchObject({ result: 'hit', battedBallType: 'fly', x: 0.85 })
    expect(baseballSprayResult('fielders_choice')).toBe('out')
    expect(baseballSprayResult('sacrifice_fly')).toBe('out')
    expect(baseballSprayResult('error')).toBe('error')
    expect(baseballSprayResult('ground_rule_double')).toBe('hit')
  })

  it('opens the whole capture unit from a point', () => {
    const state = threeUpThreeDown(startedGame())
    const next = located(state, 'single', 0.3, 0.5)
    const chart = baseballSprayChart(sportOf(next), baseballActiveEvents(next))
    const event = baseballActiveEvents(next).find(entry => entry.id === chart.points[0].eventId)!
    expect(chart.points[0].playId).toBe(event.id)
  })
})

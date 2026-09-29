import { describe, expect, it } from 'vitest'
import { createInitialState, gameReducer } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import type { GameState } from '../../types'
import { baseballMovement, baseballSportState } from './commands'
import {
  baseballDiamondView,
  baseballLineScoreView,
  baseballPersonLabel,
  baseballScoreboardView,
  setBaseballCapturePreferences,
} from './trackerView'
import { ballInPlay, baseballSetup, pitch, pitches, projection, startedGame, strikeout, threeUpThreeDown, walk } from './testFixtures'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const sportOf = (state: GameState) => baseballSportState(state)!

describe('Baseball scoreboard view', () => {
  it('shows away above home with the tracked team named, and the count', () => {
    let state = startedGame()
    state = pitches(state, 'ball', 'called_strike', 'ball')
    const view = baseballScoreboardView(sportOf(state), names)
    expect(view.away).toEqual({ side: 'opponent', name: 'Visitors', runs: 0 })
    expect(view.home).toEqual({ side: 'tracked', name: 'Aces', runs: 0 })
    expect(view.halfLabel).toBe('Top 1')
    expect([view.balls, view.strikes, view.outs]).toEqual([2, 1, 0])
    expect([view.ballDots, view.strikeDots, view.outDots]).toEqual([3, 2, 2])
    expect(view.pitcher).toMatchObject({ label: '#1 Player 1', pitches: 3, alert: null })
  })

  it('flips home and away when the tracked team is away', () => {
    const view = baseballScoreboardView(sportOf(startedGame(baseballSetup({ trackedSide: 'away' }))), names)
    expect(view.away.side).toBe('tracked')
    expect(view.home.side).toBe('opponent')
  })

  it('warns past a pitch-count threshold and at the limit', () => {
    const setup = baseballSetup({ rules: { pitchCountWarnings: [2], pitchCountLimit: 4 } })
    let state = pitches(startedGame(setup), 'ball', 'ball')
    expect(baseballScoreboardView(sportOf(state), names).pitcher?.alert).toEqual({ kind: 'warning', threshold: 2 })
    state = pitches(state, 'called_strike', 'called_strike')
    expect(baseballScoreboardView(sportOf(state), names).pitcher?.alert).toEqual({ kind: 'limit', threshold: 4 })
  })

  it('has no pitcher line before the game starts', () => {
    const pregame = { ...startedGame() }
    const sport = sportOf(pregame)
    const view = baseballScoreboardView({ ...sport, projection: { ...sport.projection, status: 'pregame' } }, names)
    expect(view.pitcher).toBeNull()
    expect(view.halfLabel).toBe('Pregame')
  })
})

describe('Baseball line score view', () => {
  it('lists runs per inning with R, H and E totals', () => {
    let state = threeUpThreeDown(startedGame())
    // Bottom 1: a single, then a home run for two runs.
    state = ballInPlay(state, 'single', { fielders: [8] })
    state = ballInPlay(state, 'home_run')
    const view = baseballLineScoreView(sportOf(state), names)
    expect(view.innings).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(view.away.innings.slice(0, 2)).toEqual([0, null])
    expect(view.home.innings[0]).toBe(2)
    expect(view.home).toMatchObject({ runs: 2, hits: 2, errors: 0 })
  })

  it('charges errors to the fielding team', () => {
    let state = ballInPlay(startedGame(), 'error', { errorBy: 6 })
    const view = baseballLineScoreView(sportOf(state), names)
    expect(view.home.errors).toBe(1)
    expect(view.away.errors).toBe(0)
    state = strikeout(state)
    expect(baseballLineScoreView(sportOf(state), names).home.errors).toBe(1)
  })
})

describe('Baseball diamond view', () => {
  it('shows the batter slot, runners and the tracked defense by number', () => {
    let state = walk(startedGame())
    const view = baseballDiamondView(sportOf(state))
    expect(view.batter).toMatchObject({ slot: 2, name: 'Batter 2', short: 'B2' })
    expect(view.runners.first?.name).toBe('Batter 1')
    expect(view.runners.second).toBeNull()
    expect(view.fieldingSide).toBe('tracked')
    expect(view.fielders[0]).toEqual({ position: 1, label: '1', name: '#1 Player 1' })
    expect(view.fielders).toHaveLength(9)
    state = pitch(state, { result: 'ball', movements: [baseballMovement(projection(state).bases.first!.runnerId, 'first', 'second', 'stolen_base')] })
    expect(baseballDiamondView(sportOf(state)).runners.second?.name).toBe('Batter 1')
  })

  it('shows opponent fielders by position number only', () => {
    const state = threeUpThreeDown(startedGame())
    const view = baseballDiamondView(sportOf(state))
    expect(view.fieldingSide).toBe('opponent')
    expect(view.fielders.map(fielder => fielder.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(view.batter).toMatchObject({ slot: 1, name: '#1 Player 1' })
  })

  it('draws ten fielders when the rules use a short fielder', () => {
    const view = baseballDiamondView(sportOf(startedGame(baseballSetup({ profile: 'softball_slowpitch' }))))
    expect(view.fielders).toHaveLength(10)
  })

  it('labels opponent slots with their details and falls back to initials', () => {
    const sport = sportOf(startedGame())
    expect(baseballPersonLabel(sport, 'o3')).toEqual({ id: 'o3', name: 'Batter 3', short: 'B3' })
    expect(baseballPersonLabel(sport, 'opp-p1')).toEqual({ id: 'opp-p1', name: '#21 Starter', short: '21' })
    expect(baseballPersonLabel(sport, 'nobody').short).toBe('?')
  })
})

describe('Baseball capture preferences', () => {
  it('change without touching events or the fingerprint, and survive reload', () => {
    const state = startedGame()
    const next = setBaseballCapturePreferences(state, { trackPitchLocation: false })
    expect(sportOf(next).capturePreferences).toEqual({ trackPitchLocation: false, trackBattedBallLocation: true })
    expect(next.eventStream).toBe(state.eventStream)
    expect(buildGameSyncFingerprint(next)).toBe(buildGameSyncFingerprint(state))
    const reloaded = gameReducer(createInitialState(), {
      type: 'HYDRATE_STATE',
      state: JSON.parse(JSON.stringify(next)) as GameState,
    })
    expect(sportOf(reloaded).capturePreferences.trackPitchLocation).toBe(false)
  })

  it('returns the same state when nothing changes', () => {
    const state = startedGame()
    expect(setBaseballCapturePreferences(state, { trackPitchLocation: true })).toBe(state)
  })
})

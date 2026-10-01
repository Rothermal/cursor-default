import { describe, expect, it } from 'vitest'
import { endHockeyPeriod, startHockeyClock, startHockeyGame, startNextHockeyPeriod } from './live'
import {
  hockeyDisplayFromElapsed,
  hockeyElapsedFromDisplay,
  hockeyFaceoffDotLabel,
  hockeyPlaceablePeriods,
  parseHockeyClockText,
} from './placementForm'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame } from './testFixtures'

const LABELS = { tracked: 'Blades', opponent: 'Rivals' }

describe('Hockey placement form (HKY-4C)', () => {
  it('lists started periods with what has been played of each', () => {
    let state = expectOk(startHockeyClock(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0))), ctx(1)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(91)))
    state = expectOk(startNextHockeyPeriod(state, ctx(100)))
    state = expectOk(startHockeyClock(state, ctx(101)))
    const periods = hockeyPlaceablePeriods(state, at(131))
    expect(periods.map(period => [period.label, period.playedMs])).toEqual([['Period 1', 90_000], ['Period 2', 30_000]])
    expect(periods[0].countDown).toBe(true)
  })

  it('has no played time for clockless games', () => {
    const state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
    expect(hockeyPlaceablePeriods(state, at(10)).map(period => period.playedMs)).toEqual([null])
  })

  it('reads clock text and converts count-down readings', () => {
    expect(parseHockeyClockText('12:34')).toBe(754_000)
    expect(parseHockeyClockText(' 45 ')).toBe(45_000)
    expect(parseHockeyClockText('1:75')).toBeNull()
    expect(parseHockeyClockText('abc')).toBeNull()
    const period = { periodId: 'regulation-1', label: 'Period 1', durationMs: 900_000, playedMs: 900_000, countDown: true, trackedAttackingDirection: null }
    expect(hockeyElapsedFromDisplay(period, 600_000)).toBe(300_000)
    expect(hockeyElapsedFromDisplay(period, 960_000)).toBeNull()
    expect(hockeyDisplayFromElapsed(period, 300_000)).toBe(600_000)
    expect(hockeyElapsedFromDisplay({ ...period, countDown: false }, 600_000)).toBe(600_000)
  })

  it('names faceoff dots by the side defending each end', () => {
    expect(hockeyFaceoffDotLabel('center', 'left_to_right', LABELS)).toBe('Center ice')
    expect(hockeyFaceoffDotLabel('left_end_upper', 'left_to_right', LABELS)).toBe('Blades end, top')
    expect(hockeyFaceoffDotLabel('left_end_upper', 'right_to_left', LABELS)).toBe('Rivals end, top')
    expect(hockeyFaceoffDotLabel('right_neutral_lower', 'left_to_right', LABELS)).toBe('Neutral zone, Rivals side, bottom')
    expect(hockeyFaceoffDotLabel('right_end_lower', null, LABELS)).toBe('Right end, bottom')
  })
})

// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BaseballDiamond from './BaseballDiamond'
import BaseballPitchPad from './BaseballPitchPad'
import BaseballScoreboard from './BaseballScoreboard'
import { baseballDiamondView, baseballLineScoreView, baseballScoreboardView } from '../../lib/baseball/trackerView'
import { baseballSportState } from '../../lib/baseball/commands'
import { baseballPitchPadLocation } from '../../lib/baseball/diamondGeometry'
import { startedGame, walk } from '../../lib/baseball/testFixtures'

const state = walk(startedGame()), sport = baseballSportState(state)!
const view = baseballDiamondView(sport), names = { tracked: 'Aces', opponent: 'Bears' }

describe('Baseball surface gesture adapters', () => {
  let root: Root, container: HTMLDivElement, svg: SVGSVGElement
  const location = vi.fn(), runner = vi.fn(), fielder = vi.fn(), result = vi.fn(), editBatter = vi.fn()
  function diamond(captureLocation = true, controls = true, focused = false) {
    act(() => root.render(createElement(StrictMode, null, createElement(BaseballDiamond, {
      view, battingLabel: 'Bears', fieldingLabel: 'Aces', focused,
      onLocation: captureLocation ? location : undefined, onRunner: controls ? runner : undefined,
      onFielder: controls ? fielder : undefined, onEditBatter: editBatter,
    }))))
    layout()
  }
  function pad(enabled = true) {
    act(() => root.render(createElement(StrictMode, null, createElement(BaseballPitchPad, {
      showZone: true, pendingLocation: null, onLocation: location, onResult: enabled ? result : undefined,
    }))))
    layout()
  }
  function layout() {
    svg = container.querySelector('svg[role="group"]')!
    Object.defineProperty(svg, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 10, top: 20, width: 100, height: 100 }) })
  }
  function pointer(type: string, target: Element = svg, x = 35, y = 60, id = 1) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: id === 1 } })
    act(() => target.dispatchEvent(event))
  }
  function click(target: Element = svg) {
    act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
  }
  function tap(target: Element = svg) { pointer('pointerdown', target); pointer('pointerup', target); click(target) }
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    for (const fn of [location, runner, fielder, result, editBatter]) fn.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('places exact repeated batted-ball locations without recording a result', () => {
    diamond()
    tap(); tap()
    expect(location).toHaveBeenCalledTimes(2)
    expect(location.mock.calls[0][0]).toEqual({ x: 0.25, y: 0.4, attackingDirection: 'unknown' })
    expect(location.mock.calls[1][0]).toEqual(location.mock.calls[0][0])
    expect(result).not.toHaveBeenCalled()
  })
  it('keeps fielder sequence selection distinct from batted-ball placement', () => {
    diamond()
    const target = container.querySelector('[data-fielder-position="6"] circle')!
    tap(target); tap(target)
    expect(fielder).toHaveBeenCalledTimes(2)
    expect(fielder).toHaveBeenCalledWith(6)
    expect(location).not.toHaveBeenCalled()
  })
  it('keeps runner selection distinct from batted-ball placement', () => {
    diamond()
    tap(container.querySelector('[data-runner-base="first"] text')!)
    expect(runner).toHaveBeenCalledExactlyOnceWith('first')
    expect(location).not.toHaveBeenCalled()
    expect(fielder).not.toHaveBeenCalled()
  })
  it('still allows runner actions when location tracking is not active', () => {
    diamond(false)
    tap(container.querySelector('[data-runner-base="first"]')!)
    tap()
    expect(runner).toHaveBeenCalledExactlyOnceWith('first')
    expect(location).not.toHaveBeenCalled()
  })
  it('preserves keyboard controls without also placing a location', () => {
    diamond()
    const target = container.querySelector('[data-fielder-position="6"]')!
    act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(fielder).toHaveBeenCalledExactlyOnceWith(6)
    expect(location).not.toHaveBeenCalled()
  })
  it('lets a location tap pass through a noninteractive fielder drawing', () => {
    diamond(true, false)
    tap(container.querySelector('g[role="img"] circle')!)
    expect(location).toHaveBeenCalledTimes(1)
    expect(fielder).not.toHaveBeenCalled()
  })
  it('does not turn a hold on a current fielder into a history edit or sequence entry', () => {
    diamond()
    const target = container.querySelector('[data-fielder-position="6"]')!
    pointer('pointerdown', target); advance(600); pointer('pointerup', target); click(target)
    expect(fielder).not.toHaveBeenCalled()
    expect(location).not.toHaveBeenCalled()
  })
  it('keeps the separate batter label button outside surface capture', () => {
    diamond(true, true, true)
    act(() => container.querySelector<HTMLButtonElement>('button[title="Edit batter label"]')!.click())
    expect(editBatter).toHaveBeenCalledTimes(1)
    expect(location).not.toHaveBeenCalled()
  })
  it('ignores letterbox space around the focused diamond', () => {
    diamond(true, true, true)
    Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 400, height: 100 }) })
    pointer('pointerdown', svg, 10, 50); pointer('pointerup', svg, 10, 50); click()
    expect(location).not.toHaveBeenCalled()
  })
  for (const surface of ['diamond', 'pad']) for (const reason of ['scroll', 'move', 'cancel', 'second pointer']) it(`${surface}: ${reason} cancels location selection`, () => {
    if (surface === 'diamond') diamond()
    else pad()
    pointer('pointerdown')
    if (reason === 'scroll') act(() => container.dispatchEvent(new Event('scroll')))
    if (reason === 'move') pointer('pointermove', svg, 1000, 1000)
    if (reason === 'cancel') pointer('pointercancel')
    if (reason === 'second pointer') pointer('pointerdown', document.body, 0, 0, 2)
    advance(600); pointer('pointerup'); click()
    expect(location).not.toHaveBeenCalled()
    expect(result).not.toHaveBeenCalled()
  })
  it('pitch placement remains optional state, without selecting a pitch result', () => {
    pad(); tap()
    expect(location).toHaveBeenCalledExactlyOnceWith(baseballPitchPadLocation(0.25, 0.4))
    expect(result).not.toHaveBeenCalled()
  })
  it('a held pitch location does nothing on release or click', () => {
    pad()
    pointer('pointerdown'); advance(600); pointer('pointerup'); click()
    expect(location).not.toHaveBeenCalled()
    expect(result).not.toHaveBeenCalled()
  })
  it('a disabled pad cannot change location or record a pitch', () => {
    pad(false); tap()
    expect(location).not.toHaveBeenCalled()
    expect(result).not.toHaveBeenCalled()
  })
  it('focused line score opens in a real dialog and closes without changing the game', () => {
    const before = JSON.stringify(state)
    act(() => root.render(createElement(BaseballScoreboard, {
      focused: true, view: baseballScoreboardView(sport, names), lineScore: baseballLineScoreView(sport, names),
    })))
    act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    advance(20)
    expect(container.querySelector('[role="dialog"] table')).not.toBeNull()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })
})

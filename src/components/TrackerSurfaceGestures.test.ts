// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SoccerField from './soccer/SoccerField'
import HockeyRink from './hockey/HockeyRink'

for (const sport of ['soccer', 'hockey'] as const) describe(`${sport} live surface gestures`, () => {
  let root: Root, container: HTMLDivElement, svg: SVGSVGElement, marker: Element
  const capture = vi.fn(), review = vi.fn(), cluster = vi.fn(), faceoff = vi.fn()
  const height = sport === 'soccer' ? 64 : 85
  const width = sport === 'soccer' ? 100 : 200
  function render({ disabled = false, flipped = false, side = 'tracked', stacked = false, focused = false }: {
    disabled?: boolean; flipped?: boolean; side?: 'tracked' | 'opponent'; stacked?: boolean; focused?: boolean
  } = {}) {
    const props = {
      trackedDirection: 'left_to_right' as const, captureSide: side, disabled, flipped, focused,
      onLocation: capture, onMarker: review, onFlip: vi.fn(),
    }
    act(() => root.render(createElement(StrictMode, null, sport === 'soccer'
      ? createElement(SoccerField, { ...props, onCluster: cluster, markers: [
        { id: 'first', x: 0.5, y: 0.5, teamSide: 'tracked', kind: 'saved', label: 'First shot' },
        ...(stacked ? [{ id: 'second', x: 0.5, y: 0.5, teamSide: 'opponent' as const, kind: 'goal' as const, label: 'Second shot' }] : []),
      ] })
      : createElement(HockeyRink, { ...props, trapezoid: true, onFaceoffDot: faceoff, markers: [
        { id: 'first', x: 0.5, y: 0.5, teamSide: 'tracked', kind: 'saved', label: 'First shot' },
      ] }))))
    svg = container.querySelector('svg[role="group"]')!
    Object.defineProperty(svg, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 10, top: 20, width, height }) })
    marker = container.querySelector('[data-field-marker], [data-rink-marker]')!
  }
  function pointer(type: string, target = marker, x = width / 2 + 10, y = height / 2 + 20, id = 1) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: id === 1 } })
    act(() => target.dispatchEvent(event))
  }
  function click(target = marker) {
    act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
  }
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    for (const fn of [capture, review, cluster, faceoff]) fn.mockReset()
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
  it('tapping a marker captures once, preserving the exact location, including repeated taps', () => {
    render()
    for (let i = 0; i < 2; i++) {
      pointer('pointerdown'); advance(30); pointer('pointerup'); click()
    }
    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture.mock.calls[0][0]).toEqual({ x: 0.5, y: 0.5, attackingDirection: 'left_to_right' })
    expect(capture.mock.calls[1][0]).toEqual(capture.mock.calls[0][0])
    expect(review).not.toHaveBeenCalled()
    expect(faceoff).not.toHaveBeenCalled()
  })
  it('holding a marker reviews once and release/click cannot also capture', () => {
    render()
    pointer('pointerdown'); advance(500); pointer('pointerup'); click()
    expect(review).toHaveBeenCalledExactlyOnceWith('first')
    expect(capture).not.toHaveBeenCalled()
  })
  for (const cancel of ['scroll', 'pointercancel', 'movement', 'second touch']) it(`${cancel} cancels the whole gesture`, () => {
    render()
    pointer('pointerdown')
    if (cancel === 'scroll') act(() => marker.dispatchEvent(new Event('scroll')))
    if (cancel === 'pointercancel') pointer('pointercancel')
    if (cancel === 'movement') pointer('pointermove', marker, 1000, 1000)
    if (cancel === 'second touch') pointer('pointerdown', document.body, 0, 0, 2)
    advance(600); pointer('pointerup'); click()
    expect(capture).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })
  for (const flipped of [false, true]) for (const side of ['tracked', 'opponent'] as const) it(`maps ${side} taps with flip=${flipped} once`, () => {
    render({ flipped, side })
    pointer('pointerdown', svg, width * 0.2 + 10, height * 0.3 + 20)
    pointer('pointerup', svg, width * 0.2 + 10, height * 0.3 + 20)
    const point = capture.mock.calls[0][0]
    expect(point.x).toBeCloseTo(flipped ? 0.8 : 0.2)
    expect(point.y).toBeCloseTo(flipped ? 0.7 : 0.3)
    expect(point.attackingDirection).toBe(side === 'tracked' ? 'left_to_right' : 'right_to_left')
  })
  it('read-only clicks and keyboard activation remain review-only', () => {
    render({ disabled: true })
    click()
    act(() => marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(review).toHaveBeenCalledTimes(2)
    expect(capture).not.toHaveBeenCalled()
  })
  it('keyboard marker activation in live mode reviews without capturing', () => {
    render()
    act(() => marker.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect(review).toHaveBeenCalledExactlyOnceWith('first')
    expect(capture).not.toHaveBeenCalled()
  })
  it('focused letterboxing does not become a baseline event', () => {
    render({ focused: true })
    Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 100 }) })
    pointer('pointerdown', svg, 5, 50); pointer('pointerup', svg, 5, 50); click(svg)
    expect(capture).not.toHaveBeenCalled()
  })
  if (sport === 'soccer') it('holds select the existing cluster, while taps still capture at the same point', () => {
    render({ stacked: true })
    pointer('pointerdown'); pointer('pointerup'); click()
    expect(capture).toHaveBeenCalledTimes(1)
    pointer('pointerdown'); advance(500); pointer('pointerup'); click()
    expect(cluster).toHaveBeenCalledExactlyOnceWith(['first', 'second'])
    expect(capture).toHaveBeenCalledTimes(1)
  })
  if (sport === 'hockey') it('keeps the explicit faceoff-dot shortcut, with no duplicate general capture', () => {
    render()
    const dot = container.querySelector('[data-faceoff-target="center"]')!
    pointer('pointerdown', dot); pointer('pointerup', dot); click(dot)
    expect(faceoff).toHaveBeenCalledExactlyOnceWith('center')
    expect(capture).not.toHaveBeenCalled()
    act(() => dot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(faceoff).toHaveBeenCalledTimes(2)
  })
})

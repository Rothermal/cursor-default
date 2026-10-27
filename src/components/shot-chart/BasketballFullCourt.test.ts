// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShotRecord } from '../../types'
import BasketballFullCourt from './BasketballFullCourt'

const shot: ShotRecord = {
  id: 'shot-1', playerId: 'player-1', x: 50, y: 25, made: true,
  shotType: '2pt', zone: 'paint', timestamp: Date.parse('2026-10-27T12:00:00.000Z'),
}

describe('Basketball full-court gesture wiring', () => {
  let root: Root
  let container: HTMLDivElement
  let marker: SVGGElement
  const capture = vi.fn(), review = vi.fn()

  function render(writable = true) {
    act(() => root.render(createElement(StrictMode, null, createElement(BasketballFullCourt, {
      shots: [shot], onCourtTap: writable ? capture : undefined, onMarkerActivate: review,
    }))))
    const svg = container.querySelector('svg')!
    // JSDOM supplies DOM propagation, not SVG layout; drawing coordinates are identity here.
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({
        x: 0, y: 0,
        matrixTransform() { return { x: this.x, y: this.y } },
      }) },
      getScreenCTM: { value: () => ({ inverse: () => ({}) }) },
    })
    marker = container.querySelector<SVGGElement>('[data-shot-id]')!
  }
  function pointer(type: string, pointerId = 1, isPrimary = true) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 25 })
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: isPrimary } })
    act(() => marker.dispatchEvent(event))
  }
  function click() {
    act(() => marker.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, detail: 1, clientX: 50, clientY: 25,
    })))
  }
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    capture.mockReset()
    review.mockReset()
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

  it('a pointer tap on a marker captures once and never also opens review', () => {
    render()
    pointer('pointerdown')
    advance(50)
    pointer('pointerup')
    click()
    expect(capture).toHaveBeenCalledExactlyOnceWith({ x: 50 / 94, y: 0.5 })
    expect(review).not.toHaveBeenCalled()
  })
  it('a hold followed by release and its click reviews once without capturing', () => {
    render()
    pointer('pointerdown')
    advance(500)
    expect(review).toHaveBeenCalledTimes(1)
    pointer('pointerup')
    click()
    expect(review).toHaveBeenCalledTimes(1)
    expect(capture).not.toHaveBeenCalled()
  })
  it('a non-bubbling descendant scroll cancels the pending gesture', () => {
    render()
    pointer('pointerdown')
    act(() => marker.dispatchEvent(new Event('scroll', { bubbles: false })))
    advance(600)
    pointer('pointerup')
    click()
    expect(capture).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })
  it('pointer cancellation and the following click do not activate either path', () => {
    render()
    pointer('pointerdown')
    pointer('pointercancel')
    advance(600)
    pointer('pointerup')
    click()
    expect(capture).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })
  it('a second touch cancels the first pointer rather than capturing on release', () => {
    render()
    pointer('pointerdown')
    pointer('pointerdown', 2, false)
    advance(600)
    pointer('pointerup')
    click()
    expect(capture).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })
  it('keyboard activation remains direct marker review', () => {
    render()
    act(() => marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(review).toHaveBeenCalledTimes(1)
    expect(review.mock.calls[0][0]).toEqual(shot)
    expect(review.mock.calls[0][1]).toBe(marker)
    expect(review.mock.calls[0][2]).toBeNull()
    expect(capture).not.toHaveBeenCalled()
  })
  it('read-only marker clicks remain review-only', () => {
    render(false)
    click()
    expect(review).toHaveBeenCalledTimes(1)
    expect(review.mock.calls[0][0]).toEqual(shot)
    expect(review.mock.calls[0][1]).toBe(marker)
    expect(review.mock.calls[0][2]).toEqual({ x: 50, y: 25 })
    expect(capture).not.toHaveBeenCalled()
  })
  it('teardown cancels a hold before its callback fires', () => {
    render()
    pointer('pointerdown')
    act(() => root.unmount())
    // Leave afterEach a mounted root to clean up without unmounting twice.
    root = createRoot(container)
    advance(600)
    expect(capture).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })
})

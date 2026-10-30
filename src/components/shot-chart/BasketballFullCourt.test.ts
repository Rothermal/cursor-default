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
  const capture = vi.fn(), review = vi.fn(), clusterReview = vi.fn()

  function render(writable = true, shots = [shot], flipped = false, clustered = false) {
    act(() => root.render(createElement(StrictMode, null, createElement(BasketballFullCourt, {
      shots, flipped, onCourtTap: writable ? capture : undefined, onMarkerActivate: review,
      onClusterActivate: clustered ? clusterReview : undefined,
    }))))
    const svg = container.querySelector('svg')!
    // JSDOM supplies DOM propagation, not SVG layout; drawing coordinates are identity here.
    Object.defineProperties(svg, {
      createSVGPoint: { configurable: true, value: () => ({
        x: 0, y: 0,
        matrixTransform() { return { x: this.x, y: this.y } },
      }) },
      getScreenCTM: { configurable: true, value: () => ({ inverse: () => ({}) }) },
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
  function expectStackReview() {
    expect(clusterReview).toHaveBeenCalledTimes(1)
    expect(clusterReview.mock.calls[0][0].map((item: ShotRecord) => item.id)).toEqual(['shot-2', 'shot-1'])
    expect(clusterReview.mock.calls[0][1]).toBe(marker)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    capture.mockReset()
    review.mockReset()
    clusterReview.mockReset()
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
  const stack = [shot, { ...shot, id: 'shot-2', x: 51, made: false, timestamp: shot.timestamp + 1 }]
  it('renders one counted stack and preserves separate single markers', () => {
    render(true, [...stack, { ...shot, id: 'far', x: 80 }], false, true)
    expect(container.querySelectorAll('[data-shot-id]')).toHaveLength(2)
    expect(marker.getAttribute('data-shot-count')).toBe('2')
    expect(marker.getAttribute('aria-label')).toBe('2 shots at this location')
    expect(marker.querySelector('text')?.textContent).toBe('2')
  })
  it('short taps on the count still capture the exact point once', () => {
    render(true, stack, false, true)
    pointer('pointerdown')
    advance(50)
    pointer('pointerup')
    click()
    expect(capture).toHaveBeenCalledExactlyOnceWith({ x: 50 / 94, y: 0.5 })
    expect(clusterReview).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })
  it('holding anywhere on the count reviews every member, not only the nearest shot', () => {
    render(true, stack, false, true)
    pointer('pointerdown')
    advance(500)
    pointer('pointerup')
    click()
    expectStackReview()
    expect(review).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })
  it.each(['Enter', ' '])('keyboard %s opens the entire stack', key => {
    render(true, stack, false, true)
    act(() => marker.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
    expectStackReview()
    expect(capture).not.toHaveBeenCalled()
  })
  it('read-only stack clicks open all choices without capture', () => {
    render(false, stack, false, true)
    click()
    expectStackReview()
    expect(capture).not.toHaveBeenCalled()
  })
  it('keeps count text upright when the court is flipped', () => {
    render(true, stack, true, true)
    expect(marker.parentElement?.getAttribute('transform')).toBe('rotate(180 47 25)')
    expect(marker.querySelector('text')?.getAttribute('transform')).toBe('rotate(180 50.5 25)')
    pointer('pointerdown')
    advance(50)
    pointer('pointerup')
    expect(capture).toHaveBeenCalledExactlyOnceWith({ x: 44 / 94, y: 0.5 })
  })
  it('recomputes counts when visible shots change without changing source records', () => {
    const before = structuredClone(stack)
    render(true, stack, false, true)
    expect(marker.getAttribute('data-shot-count')).toBe('2')
    render(true, [stack[1]], false, true)
    expect(marker.hasAttribute('data-shot-count')).toBe(false)
    expect(stack).toEqual(before)
  })
  it('cancellation on a count still suppresses both review and capture', () => {
    render(true, stack, false, true)
    pointer('pointerdown')
    pointer('pointercancel')
    advance(600)
    pointer('pointerup')
    click()
    expect(clusterReview).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })
  it('preserves individual markers for callers without a stack-review callback', () => {
    render(false, stack)
    expect(container.querySelector('[data-shot-count]')).toBeNull()
    expect(container.querySelectorAll('[data-shot-id]')).toHaveLength(2)
  })
  it.each([[0, 0], [94, 50]])('keeps the count badge inside the drawing at (%s, %s)', (x, y) => {
    render(true, stack.map(item => ({ ...item, x, y })), false, true)
    const [left, top, width, height] = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number)
    const radius = Number(marker.querySelector('circle')!.getAttribute('r'))
    expect(x - radius - 0.175).toBeGreaterThanOrEqual(left)
    expect(y - radius - 0.175).toBeGreaterThanOrEqual(top)
    expect(x + radius + 0.175).toBeLessThanOrEqual(left + width)
    expect(y + radius + 0.175).toBeLessThanOrEqual(top + height)
  })
  it('fits longer counts without enlarging the badge', () => {
    render(false, Array.from({ length: 1000 }, (_, i) => ({ ...shot, id: `shot-${i}` })), false, true)
    expect(marker.textContent).toBe('1000')
    expect(Number(marker.querySelector('text')!.getAttribute('font-size'))).toBe(1.5)
    expect(container.querySelectorAll('[data-shot-id]')).toHaveLength(1)
  })
})

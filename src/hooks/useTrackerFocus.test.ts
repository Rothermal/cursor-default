// @vitest-environment jsdom
import { act, createElement, StrictMode, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PHONE_LANDSCAPE_QUERY, useTrackerFocus } from './useTrackerFocus'

describe('tracker focus eligibility and explicit exit', () => {
  let root: Root
  let container: HTMLDivElement
  let landscape: boolean
  let phone: boolean
  let orientation: EventTarget & { type: string }
  let media: Map<string, EventTarget>

  function Harness({ enabled }: { enabled: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    const focus = useTrackerFocus(enabled, ref)
    if (!enabled) return createElement('p', { 'data-focused': 'false' }, 'Checking team access')
    return createElement('div', { ref, 'data-focused': String(focus.focused) },
      createElement('button', { onClick: focus.exit, 'aria-label': 'Exit focused court' }, 'Exit'))
  }
  const render = (enabled: boolean) => act(() => root.render(
    createElement(StrictMode, null, createElement(Harness, { enabled }))
  ))
  const focused = () => container.firstElementChild?.getAttribute('data-focused') === 'true'
  const exit = () => act(() => container.querySelector('button')!.click())
  function rotate(nextLandscape: boolean) {
    act(() => {
      landscape = nextLandscape
      orientation.type = landscape ? 'landscape-primary' : 'portrait-primary'
      orientation.dispatchEvent(new Event('change'))
      media.forEach(query => query.dispatchEvent(new Event('change')))
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    landscape = true
    phone = true
    orientation = Object.assign(new EventTarget(), { type: 'landscape-primary' })
    vi.stubGlobal('screen', { orientation })
    media = new Map()
    vi.stubGlobal('matchMedia', (query: string) => {
      const target = media.get(query) ?? Object.defineProperty(new EventTarget(), 'matches', {
        get: () => landscape && (query !== PHONE_LANDSCAPE_QUERY || phone),
      })
      media.set(query, target)
      return target
    })
    vi.spyOn(history, 'back').mockImplementation(() => {})
    history.replaceState(null, '')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('automatically focuses an immediately eligible phone landscape tracker', () => {
    render(true)
    expect(focused()).toBe(true)
  })
  it('automatically focuses after delayed team-role eligibility arrives', () => {
    render(false)
    expect(focused()).toBe(false)
    act(() => vi.advanceTimersByTime(300))
    render(true)
    expect(focused()).toBe(true)
  })
  it('does not turn a temporary eligibility loss into an explicit user exit', () => {
    render(true)
    render(false)
    expect(focused()).toBe(false)
    render(true)
    expect(focused()).toBe(true)
  })
  it('preserves an explicit exit through disable/re-enable and ordinary resize', () => {
    render(true)
    exit()
    render(false)
    render(true)
    act(() => media.forEach(query => query.dispatchEvent(new Event('change'))))
    expect(focused()).toBe(false)
  })
  it('allows automatic entry again after a portrait/landscape cycle', () => {
    render(true)
    exit()
    rotate(false)
    rotate(true)
    expect(focused()).toBe(true)
  })
  it('does not auto-focus a wide desktop after eligibility arrives', () => {
    phone = false
    render(false)
    render(true)
    expect(focused()).toBe(false)
  })
  it('does not mistake a portrait software keyboard for screen rotation', () => {
    orientation.type = 'portrait-primary'
    render(true)
    expect(focused()).toBe(false)
  })
})

// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrackerSurfaceTools from './TrackerSurfaceTools'

describe('Focused surface tools', () => {
  let root: Root, container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })
  function render(focused = true) {
    act(() => root.render(createElement(TrackerSurfaceTools, { focused, children: createElement('button', null, 'Action') })))
  }
  it('keeps normal controls inline without a hidden menu', () => {
    render(false)
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('button')?.textContent).toBe('Action')
  })
  it('Escape closes an open menu and returns focus, but a later Escape can reach the tracker', () => {
    render()
    const details = container.querySelector('details')!, summary = container.querySelector('summary')!
    details.open = true
    const escape = () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => summary.dispatchEvent(event))
      return event
    }
    expect(escape().defaultPrevented).toBe(true)
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(summary)
    expect(escape().defaultPrevented).toBe(false)
  })
  it('closes on a pointer outside, without closing on controls inside the menu', () => {
    render()
    const details = container.querySelector('details')!
    details.open = true
    act(() => container.querySelector('button')!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(details.open).toBe(true)
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(details.open).toBe(false)
  })
  it('keeps a dialog launcher visible while its sheet is in use', () => {
    render()
    const details = container.querySelector('details')!
    details.open = true
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    container.append(dialog)
    act(() => dialog.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(details.open).toBe(true)
    dialog.remove()
  })
})

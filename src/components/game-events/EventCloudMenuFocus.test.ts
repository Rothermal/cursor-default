// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../../lib/gameReducer'
import { EventCloudMenuSection } from './EventCloudSync'

const h = vi.hoisted(() => ({ enable: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
vi.mock('../../context/GameContext', () => ({ useGame: () => ({ enableEventCloudSync: h.enable }) }))

describe('Cloud footer during focused-layout transitions', () => {
  let root: Root, container: HTMLDivElement
  const done = vi.fn(), state = createInitialState(), availability = () => ({ offer: true as const })
  function render(compact: boolean) {
    act(() => root.render(createElement(EventCloudMenuSection, { state, compact, onDone: done, availability })))
  }
  function button(text: string, within: ParentNode = container) {
    return Array.from(within.querySelectorAll('button')).find(item => item.textContent === text)!
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    h.enable.mockReset().mockResolvedValue({ ok: false, reason: 'Rejected synthetic enable' })
    done.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })
  it('keeps an already-open confirmation outside the hidden routine controls', () => {
    render(false)
    act(() => button('Enable cloud sync').click())
    render(true)
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.closest('.hidden')).toBeNull()
    expect(container.querySelector('[aria-label="Game sync status"]')?.closest('.hidden')).not.toBeNull()
    expect(h.enable).not.toHaveBeenCalled()
  })
  it('keeps a rejected enable visible in focus and never reports success', async () => {
    render(false)
    act(() => button('Enable cloud sync').click())
    render(true)
    await act(async () => button('Enable cloud sync', container.querySelector('[role="dialog"]')!).click())
    const error = container.querySelector('[role="alert"]')!
    expect(error.textContent).toBe('Rejected synthetic enable')
    expect(error.closest('.hidden')).toBeNull()
    expect(h.enable).toHaveBeenCalledTimes(1)
    expect(done).not.toHaveBeenCalled()
  })
})

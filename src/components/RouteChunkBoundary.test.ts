// @vitest-environment jsdom
import { act, createElement, lazy } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RouteChunkBoundary from './RouteChunkBoundary'

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate()
  return createElement('button', { type: 'button', onClick: () => navigate(to) }, 'go')
}

describe('RouteChunkBoundary', () => {
  let root: Root, container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  function render(element: ReturnType<typeof createElement>) {
    // Like AppShell, navigation sits outside the boundary.
    act(() => root.render(createElement(MemoryRouter, { initialEntries: ['/a'] },
      createElement('nav', null, createElement(GoTo, { to: '/b' })),
      createElement(RouteChunkBoundary, null, createElement(Routes, null,
        createElement(Route, { path: '/a', element }),
        createElement(Route, { path: '/b', element: createElement('p', null, 'Page B') }))))))
  }

  it('shows the loading fallback, then the page', async () => {
    let resolve!: (value: { default: () => ReturnType<typeof createElement> }) => void
    const Page = lazy(() => new Promise<{ default: () => ReturnType<typeof createElement> }>(done => { resolve = done }))
    render(createElement(Page))
    expect(container.textContent).toContain('Loading...')
    await act(async () => { resolve({ default: () => createElement('p', null, 'Page A') }) })
    expect(container.textContent).toContain('Page A')
  })

  it('offers Reload when a page chunk fails and recovers on navigation', async () => {
    const Broken = lazy(() => Promise.reject(new Error('chunk 404')))
    render(createElement(Broken))
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded')
    expect(container.querySelector('main button')?.textContent).toBe('Reload')
    act(() => (container.querySelector('nav button') as HTMLButtonElement).click())
    expect(container.textContent).toContain('Page B')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { GameState } from '../types'
import BaseballGameTracker from './BaseballGameTracker'
import BaseballSummary from './BaseballSummary'
import { endBaseballGame } from '../lib/baseball/commands'
import { undoBaseballPlay } from '../lib/baseball/recentPlays'
import { expectOk, startedGame, pitch, ctx } from '../lib/baseball/testFixtures'

const h = vi.hoisted(() => ({ state: null as unknown, configured: false, refresh: vi.fn(),
  effects: [] as Array<() => (() => void) | undefined> }))
// Static markup cannot run layout effects; interactive behavior is checked in Chromium.
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useLayoutEffect: () => {},
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    if (deps?.includes(h.refresh)) h.effects.push(effect)
  } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: h.configured ? { id: 'recorder-1' } : null, isConfigured: h.configured }) }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: h.state, dispatch: vi.fn(),
  enableEventCloudSync: vi.fn(), retryCloudSync: vi.fn(), resolveEventConflict: vi.fn(), refreshBaseballCloudGameStatus: h.refresh }) }))
function view(state: GameState, path: string, summary = false) {
  h.state = state
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(summary ? BaseballSummary : BaseballGameTracker)))
}
function finalized(state: GameState): GameState {
  return { ...state, cloudSync: { ...state.cloudSync, gameId: 'game-1', gameStatus: 'final', eventCloudPolicy: 'automatic' } }
}
beforeEach(() => { h.configured = false; h.effects = []; h.refresh.mockReset() })
describe('Baseball finalized cloud UI', () => {
  it('shows optional tournament metadata warnings without hiding live capture', () => {
    const state = startedGame()
    state.cloudSync.tournamentSyncWarning = 'The selected Baseball tournament is unavailable for this team.'
    const html = view(state, '/game')
    expect(html).toContain('Tournament association:')
    expect(html).toContain('Events can still sync.')
    expect(html).toContain('>Quick PA<')
  })
  it('refreshes on tracker mount/focus/online and invalidates its caller on unmount', () => {
    h.configured = true
    view(finalized(expectOk(endBaseballGame(startedGame(), 'time_limit', ctx()))), '/game')
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('window', { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name) })
    try {
      expect(h.effects).toHaveLength(1)
      const cleanup = h.effects[0]()
      expect(h.refresh).toHaveBeenCalledWith('game-1', expect.any(Function))
      const isCurrent = h.refresh.mock.calls[0][1] as () => boolean
      expect(isCurrent()).toBe(true)
      listeners.get('focus')!(); listeners.get('online')!()
      expect(h.refresh).toHaveBeenCalledTimes(3)
      cleanup!()
      expect(isCurrent()).toBe(false)
      expect(listeners.size).toBe(0)
    } finally { vi.unstubAllGlobals() }
  })
  it('does not read cloud status for a local-only tracker', () => {
    h.configured = true
    view(startedGame(), '/game')
    h.effects.forEach(effect => effect())
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('hides capture even if the cached local projection still says in progress', () => {
    const html = view(finalized(startedGame()), '/game')
    expect(html).toContain('finalized and read-only')
    expect(html).not.toContain('>Quick PA<')
    expect(html).not.toContain('>Reopen game<')
  })
  it('keeps removed history visible but removes Restore controls', () => {
    const state = expectOk(undoBaseballPlay(pitch(startedGame(), { result: 'ball' }), ctx().occurredAt))
    const html = view(finalized(state), '/game?tab=timeline')
    expect(html).toContain('Removed (1)')
    expect(html).not.toContain('aria-label="Restore ')
    expect(html).not.toContain('Restore together')
  })
  it('keeps local-only finished games reopenable and their decisions editable', () => {
    const state = expectOk(endBaseballGame(startedGame(), 'time_limit', ctx()))
    expect(view(state, '/game')).toContain('>Reopen game<')
    expect(view(state, '/summary', true)).toContain('>Set decisions<')
    expect(view(finalized(state), '/game')).not.toContain('>Reopen game<')
    expect(view(finalized(state), '/summary', true)).not.toContain('>Set decisions<')
  })
})

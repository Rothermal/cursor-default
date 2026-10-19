import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { GameState } from '../types'
import BaseballGameTracker from './BaseballGameTracker'
import BaseballSummary from './BaseballSummary'
import { endBaseballGame } from '../lib/baseball/commands'
import { undoBaseballPlay } from '../lib/baseball/recentPlays'
import { expectOk, startedGame, pitch, ctx } from '../lib/baseball/testFixtures'

const h = vi.hoisted(() => ({ state: null as unknown }))
// Static markup cannot run layout effects; interactive behavior is checked in Chromium.
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useLayoutEffect: () => {} }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, isConfigured: false }) }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: h.state, dispatch: vi.fn(),
  enableEventCloudSync: vi.fn(), retryCloudSync: vi.fn(), resolveEventConflict: vi.fn() }) }))
function view(state: GameState, path: string, summary = false) {
  h.state = state
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(summary ? BaseballSummary : BaseballGameTracker)))
}
function finalized(state: GameState): GameState {
  return { ...state, cloudSync: { ...state.cloudSync, gameId: 'game-1', gameStatus: 'final', eventCloudPolicy: 'automatic' } }
}
describe('Baseball finalized cloud UI', () => {
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

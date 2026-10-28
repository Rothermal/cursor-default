// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BaseballGameTracker from './BaseballGameTracker'
import { buildGameSyncFingerprint } from '../lib/gameSyncFingerprint'
import { baseballSportState, endBaseballGame, initializeBaseballEventGame } from '../lib/baseball/commands'
import { baseballSetup, ctx, expectOk, startedGame, walk } from '../lib/baseball/testFixtures'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import type { GameAction, GameState } from '../types'
import type { TeamRole } from '../lib/teamPermissions'

const h = vi.hoisted(() => ({ state: null as GameState | null, dispatch: vi.fn(),
  role: { role: null as TeamRole | null, loading: false, error: null } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, isConfigured: false }) }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: h.state, dispatch: h.dispatch,
  refreshBaseballCloudGameStatus: vi.fn(), enableEventCloudSync: vi.fn() }) }))
vi.mock('../hooks/useTeamRole', () => ({ useTeamRole: () => h.role }))

describe('Baseball focused tracker integration', () => {
  let root: Root, container: HTMLDivElement
  function render() {
    root.render(createElement(StrictMode, null, createElement(MemoryRouter, null, createElement(BaseballGameTracker))))
  }
  function button(name: string) {
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(element =>
      element.getAttribute('aria-label') === name || element.textContent === name)
    if (!item) throw new Error(`Missing button: ${name}`)
    return item
  }
  function click(name: string) { act(() => button(name).click()) }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: true }))
    vi.spyOn(history, 'back').mockImplementation(() => {})
    h.role = { role: null, loading: false, error: null }
    h.state = walk(startedGame())
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    h.dispatch.mockReset().mockImplementation((action: GameAction) => {
      if (action.type !== 'HYDRATE_STATE') throw new Error('Unexpected action')
      h.state = action.state
      render()
    })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it('auto-focuses without recording a pitch or changing the game fingerprint', () => {
    const before = buildGameSyncFingerprint(h.state!)
    act(render)
    expect(container.querySelector('.tracker-focus')).not.toBeNull()
    expect(container.querySelector('[aria-label="Team roles"]')?.textContent).toContain('Batting:')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(buildGameSyncFingerprint(h.state!)).toBe(before)
  })
  it('waits for team recording access, then auto-focuses without treating loading as Exit', () => {
    h.state = { ...h.state!, cloudSync: { ...h.state!.cloudSync, teamId: 'team-1' } }
    h.role = { role: null, loading: true, error: null }
    act(render)
    expect(container.querySelector('.tracker-focus')).toBeNull()
    h.role = { role: 'scorer', loading: false, error: null }
    act(render)
    expect(container.querySelector('.tracker-focus')).not.toBeNull()
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  for (const mode of ['pregame', 'ended', 'cloud-final']) it(`does not focus the ${mode} tracker`, () => {
    if (mode === 'pregame') h.state = expectOk(initializeBaseballEventGame({ ...createInitialState(), sport: sports.find(sport => sport.id === 'baseball')! }, baseballSetup()))
    if (mode === 'ended') h.state = expectOk(endBaseballGame(h.state!, 'time_limit', ctx()))
    if (mode === 'cloud-final') h.state = { ...h.state!, cloudSync: { ...h.state!.cloudSync, gameStatus: 'final' } }
    act(render)
    expect(container.querySelector('.tracker-focus')).toBeNull()
    expect(container.querySelector('[aria-label="Expand diamond"]')).toBeNull()
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('keeps an in-play draft through Exit/Expand and commits exactly one checked play', () => {
    const before = buildGameSyncFingerprint(h.state!), count = h.state!.eventStream!.events.length
    act(render)
    click('In play')
    click('1B')
    const fielder = container.querySelector('[data-fielder-position="6"]')!
    act(() => fielder.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    click('Exit focused diamond')
    expect(container.querySelector('.tracker-focus')).toBeNull()
    click('Expand diamond')
    expect(container.querySelector('.tracker-focus')).not.toBeNull()
    expect(buildGameSyncFingerprint(h.state!)).toBe(before)
    expect(h.dispatch).not.toHaveBeenCalled()
    click('Runners')
    click('Confirm')
    expect(h.state!.eventStream!.events).toHaveLength(count + 1)
    expect(h.state!.eventStream!.events[count]).toMatchObject({ eventType: 'baseball.pitch', payload: { inPlay: { result: 'single', fielders: [6] } } })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })
  it('runner controls keep their no-pitch play flow in the focused tracker', () => {
    const count = h.state!.eventStream!.events.length
    act(render)
    const runner = container.querySelector('[data-runner-base="first"]')!
    act(() => runner.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect(container.querySelector('[aria-label="Runner play"]')).not.toBeNull()
    click('Steal')
    expect(h.dispatch).not.toHaveBeenCalled()
    click('Confirm')
    const projection = baseballSportState(h.state!)!.projection
    expect(projection.bases.first).toBeNull()
    expect(projection.bases.second?.runnerId).toBe('o1')
    expect(projection.pitchesInPlateAppearance).toBe(0)
    expect(h.state!.eventStream!.events).toHaveLength(count + 1)
  })
})

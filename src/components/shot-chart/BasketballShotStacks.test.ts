// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import { BASKETBALL_TEAM_STATS_DEFAULTS } from '../../config/teamStatsDefaults'
import { createInitialState } from '../../lib/gameReducer'
import { buildGameSyncFingerprint } from '../../lib/gameSyncFingerprint'
import { captureBasketballCourtEvent, prepareBasketballGameStart } from '../../lib/basketball/commands'
import { loadBasketballSummarySource, type BasketballSummarySource } from '../../lib/basketball/summarySource'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../../lib/teamPlayers'
import type { GameState } from '../../types'
import ShotChartPanel from './ShotChartPanel'
import BasketballShotReview from '../basketball-summary/BasketballShotReview'

const harness = vi.hoisted(() => ({ state: null as unknown as GameState, dispatch: vi.fn() }))
vi.mock('../../context/GameContext', () => ({ useGame: () => harness }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({
  basketballSettings: { capture: { reboundPromptAfterMiss: false } },
}) }))

const id = (n: number) => `af050000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (n: number) => new Date(Date.parse('2026-10-30T12:00:00Z') + n * 1000).toISOString()
function fixture() {
  const start = prepareBasketballGameStart({
    ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Aces', opponentName: 'Bears', tournamentName: '', tournamentId: null, date: '2026-10-30' },
    players: [
      { id: TEAM_PLAYER_HOME_ID, name: 'Aces', number: '', stats: {}, isTeamPlayer: true },
      { id: TEAM_PLAYER_OPP_ID, name: 'Bears', number: '', stats: {}, isTeamPlayer: true, teamSide: 'opponent' },
      { id: 'player-1', name: 'Alex One', number: '4', stats: {} },
      { id: 'player-2', name: 'Blake Two', number: '12', stats: {} },
    ],
    teamStatsConfig: { ...structuredClone(BASKETBALL_TEAM_STATS_DEFAULTS) },
  }, { recorderUserId: null, tipOffDirection: 'left_to_right', participantIds: [id(101), id(102)], eventId: id(1), tipOffEventId: id(2), occurredAt: at(0) })
  if (!start.ok) throw Error(start.message)
  let state = start.state
  for (let i = 0; i < 2; i++) {
    const capture = captureBasketballCourtEvent(state, {
      recorderUserId: null, playerId: `player-${i + 1}`, fullCourtPoint: { x: 0.8 + i * 0.01, y: 0.5 },
      event: { kind: 'shot', made: i === 0, shotType: i === 0 ? '2pt' : '3pt' }, eventIds: [id(10 + i)], occurredAt: at(i + 1),
    })
    if (!capture.ok) throw Error(capture.message)
    state = capture.state
  }
  return state
}

describe('Basketball counted stack review and existing edit flow', () => {
  let root: Root
  let container: HTMLDivElement
  let source: BasketballSummarySource
  const render = (summary = false) => act(() => root.render(createElement(StrictMode, null, summary
    ? createElement(BasketballShotReview, { source })
    : createElement(ShotChartPanel, { selection: { kind: 'all' }, onSelectPlayer: vi.fn(), capturePlayerId: TEAM_PLAYER_HOME_ID }))))
  function button(text: string | RegExp, parent: ParentNode = container) {
    const found = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(element =>
      typeof text === 'string' ? element.textContent?.trim() === text : text.test(element.textContent ?? ''))
    if (!found) throw Error(`Button missing: ${text}; ${container.querySelector('[role="dialog"]')?.textContent}`)
    return found
  }
  const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  function openStack() {
    const marker = container.querySelector('[data-shot-count="2"]')!
    expect(marker).not.toBeNull()
    act(() => marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    return container.querySelector<HTMLElement>('[role="dialog"]')!
  }
  function chooseFirstShot() {
    const dialog = openStack()
    expect(dialog.textContent).toContain('Field goal #2')
    expect(dialog.textContent).toContain('Blake Two')
    expect(dialog.textContent).toContain('Alex One')
    click(button(/Field goal #1/, dialog))
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(100))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
    harness.state = fixture()
    harness.dispatch.mockReset()
    source = await loadBasketballSummarySource(harness.state, null)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('live court lists all counted shots and opens the selected shot with Edit', () => {
    render()
    const before = buildGameSyncFingerprint(harness.state)
    chooseFirstShot()
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Alex One')
    click(button('Edit'))
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Edit shot')
    expect(harness.dispatch).not.toHaveBeenCalled()
    expect(buildGameSyncFingerprint(harness.state)).toBe(before)
  })
  it('existing checked editor updates only the chosen stacked shot', () => {
    render()
    chooseFirstShot()
    click(button('Edit'))
    click(button('Missed'))
    click(button('Review'))
    click(button('Save changes'))
    expect(harness.dispatch).toHaveBeenCalledTimes(1)
    const action = harness.dispatch.mock.calls[0][0]
    expect(action.type).toBe('HYDRATE_STATE')
    const original = harness.state.eventStream!.events
    const saved = action.state.eventStream.events
    expect(saved.find((event: { id: string }) => event.id === id(10))).toMatchObject({ revision: 2, payload: { made: false } })
    expect(saved.find((event: { id: string }) => event.id === id(11)))
      .toEqual(original.find(event => (event as { id: string }).id === id(11)))
  })
  it('Summary reuses the full stack chooser and existing local edit option', () => {
    render(true)
    chooseFirstShot()
    click(button('Edit'))
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Edit shot')
    expect(harness.dispatch).not.toHaveBeenCalled()
  })
  it('read-only Summary still reviews a stack without offering edits', () => {
    source = { ...source, editable: false }
    render(true)
    chooseFirstShot()
    expect([...container.querySelectorAll('button')].some(element => element.textContent?.trim() === 'Edit')).toBe(false)
    expect(harness.dispatch).not.toHaveBeenCalled()
  })
  it('Summary filters update stack membership, not saved events', () => {
    render(true)
    expect(container.querySelector('[data-shot-count="2"]')).not.toBeNull()
    const result = [...container.querySelectorAll('select')].find(element => element.parentElement?.textContent?.startsWith('Result'))!
    act(() => { result.value = 'made'; result.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.querySelector('[data-shot-count]')).toBeNull()
    expect(container.querySelectorAll('[data-shot-id]')).toHaveLength(1)
    expect(harness.dispatch).not.toHaveBeenCalled()
  })
  it('canceling the chooser returns focus to the count without opening capture', () => {
    render()
    const marker = container.querySelector<SVGGElement>('[data-shot-count="2"]')!
    marker.focus()
    openStack()
    click(button('Cancel'))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(marker)
    expect(harness.dispatch).not.toHaveBeenCalled()
  })
})

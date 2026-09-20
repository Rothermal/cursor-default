import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import ShotChartPanel from './ShotChartPanel'
import BasketballCourt from './BasketballCourt'
import CourtEventPopup from './CourtEventPopup'
import { createInitialState } from '../../lib/gameReducer'
import { sports } from '../../config/sports'
import { playersWithTeamPlaceholders, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../../lib/teamPlayers'
import { addBasketballLateParticipant, captureBasketballCourtEvent, prepareBasketballGameStart } from '../../lib/basketball/commands'
import type { GameState } from '../../types'

// Drive the real parent component and its child callbacks without a browser renderer.
// Effects are intentionally excluded; this harness targets the capture wiring.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, state: null as unknown, dispatch: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial
    return [harness.slots[index], (value: unknown) => {
      harness.slots[index] = typeof value === 'function' ? value(harness.slots[index]) : value
    }]
  },
  useRef: (current: unknown) => ({ current }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}))
vi.mock('../../context/GameContext', () => ({ useGame: () => ({ state: harness.state, dispatch: harness.dispatch }) }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({ basketballSettings: { capture: { reboundPromptAfterMiss: false } } }) }))

function findElement<P>(node: ReactNode, type: unknown): ReactElement<P> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findElement<P>(child, type); if (found) return found }
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined
  if (node.type === type) return node as ReactElement<P>
  return findElement<P>(node.props.children, type)
}
function renderPanel(selection: { kind: 'all' } | { kind: 'player'; playerId: string } = { kind: 'all' }) {
  harness.cursor = 0
  return ShotChartPanel({ selection, capturePlayerId: TEAM_PLAYER_HOME_ID, onSelectPlayer: vi.fn() })
}
function popup() {
  const element = findElement<Parameters<typeof CourtEventPopup>[0]>(renderPanel(), CourtEventPopup)
  if (!element) throw new Error('Popup not opened')
  return element.props
}
beforeEach(() => {
  harness.slots = []
  harness.dispatch.mockClear()
  harness.state = { ...createInitialState(), sport: sports.find(s => s.id === 'basketball')!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-09-20' },
    players: playersWithTeamPlaceholders([{ id: 'p1', name: 'Alex', number: '4', stats: {} }], 'Home', 'Away')!,
  } satisfies GameState
})
function tapCourt() {
  const court = findElement<Parameters<typeof BasketballCourt>[0]>(renderPanel(), BasketballCourt)
  if (!court?.props.onCourtTap) throw new Error('Court capture missing')
  court.props.onCourtTap(0, 8)
}
describe('ShotChartPanel legacy capture wiring', () => {
  it('derives opponent sides for old local event rows without mutating saved state', () => {
    const start = prepareBasketballGameStart({ ...(harness.state as GameState), gameDataAuthority: 'sport_events' }, { recorderUserId: null })
    if (!start.ok) throw new Error(start.message)
    const added = addBasketballLateParticipant(start.state, { recorderUserId: null, teamSide: 'opponent', displayName: 'Away', playerId: 'away' })
    if (!added.ok) throw new Error(added.message)
    const shot = captureBasketballCourtEvent(added.state, { recorderUserId: null, playerId: 'away', point: { x: 0, y: 8 }, event: { kind: 'shot', made: true, shotType: '2pt' } })
    if (!shot.ok) throw new Error(shot.message)
    delete shot.state.players.find(player => player.id === 'away')!.teamSide
    harness.state = shot.state
    const before = JSON.stringify(harness.state)
    const opponent = findElement<Parameters<typeof BasketballCourt>[0]>(renderPanel({ kind: 'player', playerId: TEAM_PLAYER_OPP_ID }), BasketballCourt)
    expect(opponent?.props.shots.map(item => item.playerId)).toEqual(['away'])
    const tracked = findElement<Parameters<typeof BasketballCourt>[0]>(renderPanel({ kind: 'player', playerId: TEAM_PLAYER_HOME_ID }), BasketballCourt)
    expect(tracked?.props.shots).toEqual([])
    expect(JSON.stringify(harness.state)).toBe(before)
  })
  it('passes the actor restriction into the actual popup', () => {
    tapCourt()
    expect(popup().shotDisabledMessage).toContain('Choose a tracked player')
  })
  it('rejects an unsupported legacy shot even if the child calls onPick', () => {
    tapCourt()
    popup().onPick({ kind: 'shot', made: true, shotType: '2pt' })
    expect(harness.dispatch).not.toHaveBeenCalled()
    expect(popup().errorMessage).toContain('Choose a tracked player')
  })
  it('allows an explicitly chosen individual through the legacy ADD_SHOT path', () => {
    tapCourt()
    popup().onSelectPlayer('p1')
    expect(popup().shotDisabledMessage).toBeNull()
    popup().onPick({ kind: 'shot', made: true, shotType: '2pt' })
    expect(harness.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_SHOT', shot: expect.objectContaining({ playerId: 'p1' }) }))
  })
  it('keeps event-game team capture on the checked event path', () => {
    const result = prepareBasketballGameStart({ ...(harness.state as GameState), gameDataAuthority: 'sport_events' }, { recorderUserId: null })
    if (!result.ok) throw new Error(result.message)
    harness.state = result.state
    tapCourt()
    expect(popup().shotDisabledMessage).toBeNull()
    popup().onPick({ kind: 'shot', made: true, shotType: '2pt' })
    expect(harness.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'HYDRATE_STATE' }))
    expect(harness.dispatch.mock.calls.some(([action]) => action.type === 'ADD_SHOT')).toBe(false)
  })
})

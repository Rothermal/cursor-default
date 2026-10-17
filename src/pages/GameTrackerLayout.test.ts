import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import GameTracker from './GameTracker'
import Scoreboard from '../components/Scoreboard'
import GameSyncStatus from '../components/GameSyncStatus'
import TrackerOptionsMenu from '../components/TrackerOptionsMenu'
import BasketballClockStrip from '../components/basketball/BasketballClockStrip'
import BasketballLifecycleControls from '../components/basketball/BasketballLifecycleControls'
import BasketballFoulDialog from '../components/basketball/BasketballFoulDialog'
import BasketballQuickFreeThrowDialog from '../components/basketball/BasketballQuickFreeThrowDialog'
import ShotChartPanel from '../components/shot-chart/ShotChartPanel'
import PlayerSelectorStrip from '../components/PlayerSelectorStrip'
import { createInitialState } from '../lib/gameReducer'
import { prepareBasketballGameStart } from '../lib/basketball/commands'
import { buildGameSyncFingerprint } from '../lib/gameSyncFingerprint'
import { DEFAULT_SETTINGS } from '../lib/settingsStorage'
import { playersWithTeamPlaceholders, TEAM_PLAYER_OPP_ID } from '../lib/teamPlayers'
import { sports } from '../config/sports'
import type { GameState } from '../types'

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, state: null as unknown, dispatch: vi.fn() }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial
    return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === 'function' ? value(harness.slots[index]) : value }]
  },
  useEffect: () => {}, useRef: (current: unknown) => ({ current }),
  useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: harness.state, dispatch: harness.dispatch, flushCloudSync: vi.fn() }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ basketballDeviceSettings: DEFAULT_SETTINGS.basketball }) }))
vi.mock('../hooks/useTeamRole', () => ({ useTeamRole: () => ({ role: null, loading: false, error: null }) }))

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : ''
}
function render() { harness.cursor = 0; return GameTracker() }
function child<P>(type: unknown) {
  const element = elements(render()).find(element => element.type === type)
  if (!element) throw new Error('Missing tracker child')
  return element.props as P
}
function button(node: ReactNode, label: string) {
  const element = elements(node).find(element => element.type === 'button' && text(element.props.children as ReactNode) === label)
  if (!element) throw new Error(`Missing button: ${label}`)
  return element.props as { disabled?: boolean; onClick: () => void }
}
function panel() { return child<Parameters<typeof ShotChartPanel>[0]>(ShotChartPanel) }

beforeEach(() => {
  harness.slots = []; harness.dispatch.mockClear()
  const base: GameState = { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Falcons', opponentName: 'Wolves', date: '2026-10-17', tournamentName: '', tournamentId: null },
    players: playersWithTeamPlaceholders([{ id: 'p1', name: 'Avery', number: '1', stats: {} }], 'Falcons', 'Wolves')!,
  }
  const result = prepareBasketballGameStart(base, { recorderUserId: null, tipOffDirection: 'left_to_right' })
  if (!result.ok) throw new Error(result.message)
  harness.state = result.state
})

describe('Basketball compact live workspace wiring', () => {
  it('puts navigation before the score and one clock before workspace content, with routine sync at the bottom', () => {
    const tree = elements(render())
    const at = (type: unknown) => tree.findIndex(element => element.type === type)
    expect(tree.findIndex(element => element.props.role === 'tablist')).toBeLessThan(at(Scoreboard))
    expect(at(Scoreboard)).toBeLessThan(at(BasketballClockStrip))
    expect(at(BasketballClockStrip)).toBeLessThan(at(ShotChartPanel))
    expect(at(GameSyncStatus)).toBeGreaterThan(at(ShotChartPanel))
    expect(tree.filter(element => element.type === BasketballClockStrip)).toHaveLength(1)
    expect(child<Parameters<typeof Scoreboard>[0]>(Scoreboard)).toMatchObject({ compact: true, readOnly: true, showSyncStatus: false })
    expect(child<Parameters<typeof BasketballClockStrip>[0]>(BasketballClockStrip).compact).toBe(true)
  })
  it('keeps lifecycle controls inside the Game menu and score commands in Actions', () => {
    const menu = child<{ children: ReactNode }>(TrackerOptionsMenu)
    expect(elements(menu.children).some(element => element.type === BasketballLifecycleControls)).toBe(true)
    button(menu.children, 'Game actions').onClick()
    const scores = elements(render()).filter(element => element.type === Scoreboard)
    expect(scores).toHaveLength(2)
    const controls = scores[1].props.eventScoreControls as { onAdjust: (side: 'tracked', delta: 1) => void }
    controls.onAdjust('tracked', 1)
    expect(harness.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'HYDRATE_STATE' }))
  })
  it('launches unattributed foul and free throw workflows for the explicitly selected side without recording', () => {
    button(render(), 'Wolves').onClick()
    button(panel().surfaceActions, ' Foul').onClick()
    expect(child<Parameters<typeof BasketballFoulDialog>[0]>(BasketballFoulDialog)).toMatchObject({ defaultSide: 'opponent', defaultPlayerId: null })
    child<Parameters<typeof BasketballFoulDialog>[0]>(BasketballFoulDialog).onClose()
    button(panel().surfaceActions, ' Free throw').onClick()
    expect(child<Parameters<typeof BasketballQuickFreeThrowDialog>[0]>(BasketballQuickFreeThrowDialog)).toMatchObject({ defaultPlayerId: null, teamName: 'Wolves' })
    expect(harness.dispatch).not.toHaveBeenCalled()
  })
  it('keeps filters independent of capture side and gameplay fingerprints', () => {
    const before = buildGameSyncFingerprint(harness.state as GameState)
    button(render(), 'Wolves').onClick()
    const select = elements(panel().reviewControls).find(element => element.type === 'select')!
    ;(select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'p1' } })
    expect(panel().selection).toEqual({ kind: 'player', playerId: 'p1' })
    expect(panel().capturePlayerId).toBe(TEAM_PLAYER_OPP_ID)
    expect(buildGameSyncFingerprint(harness.state as GameState)).toBe(before)
    expect(harness.dispatch).not.toHaveBeenCalled()
  })
  it('does not invent lineup management for clockless event games', () => {
    expect(button(panel().surfaceActions, ' Lineup').disabled).toBe(true)
  })
  it('leaves legacy sibling sports on their established generic layout', () => {
    harness.state = { ...(harness.state as GameState), sport: sports.find(sport => sport.id === 'football')!, gameDataAuthority: null, eventStream: null, sportGameState: null }
    expect(child<Parameters<typeof Scoreboard>[0]>(Scoreboard)).toMatchObject({ compact: false, showSyncStatus: true, readOnly: false })
    expect(elements(render()).some(element => element.type === PlayerSelectorStrip)).toBe(true)
    expect(elements(render()).some(element => element.type === GameSyncStatus)).toBe(false)
  })
})

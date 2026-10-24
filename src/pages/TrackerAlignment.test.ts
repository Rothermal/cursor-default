import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import HockeyGameTracker from './HockeyGameTracker'
import SoccerGameTracker from './SoccerGameTracker'
import HockeyRink from '../components/hockey/HockeyRink'
import HockeyShotDialog from '../components/hockey/HockeyShotDialog'
import HockeyPlayDialog from '../components/hockey/HockeyPlayDialog'
import HockeyFaceoffControl from '../components/hockey/HockeyFaceoffControl'
import HockeyPenaltyBox from '../components/hockey/HockeyPenaltyBox'
import HockeyPenaltyDialog from '../components/hockey/HockeyPenaltyDialog'
import HockeyGoalieDialog from '../components/hockey/HockeyGoalieDialog'
import { HockeyCloudMenuSection } from '../components/hockey/HockeyCloudSync'
import SoccerField from '../components/soccer/SoccerField'
import SoccerQuickShotSheet from '../components/soccer/SoccerQuickShotSheet'
import TrackerSideSelector from '../components/TrackerSideSelector'
import { EventCloudStatus } from '../components/game-events/EventCloudSync'
import { startHockeyClock, startHockeyGame } from '../lib/hockey/live'
import { ctx, expectOk, initializedHockeyGame } from '../lib/hockey/testFixtures'
import { prepareSoccerKickoff } from '../lib/soccer/kickoff'
import { resolveSoccerMatchRules } from '../lib/soccer/rules'
import { createInitialState, gameReducer } from '../lib/gameReducer'
import { buildGameSyncFingerprint } from '../lib/gameSyncFingerprint'
import { sports } from '../config/sports'
import type { GameAction, GameState } from '../types'

const h = vi.hoisted(() => ({ state: null as GameState | null, slots: [] as unknown[], cursor: 0, dispatch: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = typeof initial === 'function' ? initial() : initial
    return [h.slots[index], (value: unknown) => { h.slots[index] = typeof value === 'function' ? value(h.slots[index]) : value }]
  },
  useEffect: () => {}, useRef: (current: unknown) => ({ current }), useId: () => 'dialog-id',
  useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams()], Link: 'a' }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: h.state, dispatch: h.dispatch, flushCloudSync: vi.fn() }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../hooks/useTeamRole', () => ({ useTeamRole: () => ({ role: null, loading: false, error: null }) }))

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(content).join('')
  return isValidElement<{ children?: ReactNode }>(node) ? content(node.props.children) : ''
}
function render() {
  h.cursor = 0
  if (h.state?.sport?.id === 'soccer') return elements(SoccerGameTracker())
  const wrapper = HockeyGameTracker()
  return elements((wrapper.type as (props: unknown) => ReactNode)(wrapper.props))
}
function child<P>(type: unknown) {
  const item = render().find(element => element.type === type)
  if (!item) throw new Error('Missing tracker child')
  return item.props as P
}
function click(label: string) {
  const item = render().find(element => element.type === 'button' &&
    (element.props['aria-label'] === label || content(element.props.children as ReactNode) === label))
  if (!item) throw new Error(`Missing button: ${label}`)
  ;(item.props.onClick as () => void)()
}
function soccerFixture() {
  const state = { ...createInitialState(), sport: sports.find(sport => sport.id === 'soccer')!,
    gameInfo: { teamName: 'Aces', opponentName: 'Bears', date: '2026-10-24', tournamentName: '', tournamentId: null } }
  const result = prepareSoccerKickoff(state, { version: 1, trackedTeamDesignation: 'home', firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: null, sourceSeasonId: null, rulesSnapshot: resolveSoccerMatchRules(),
    participants: [{ id: 'keeper', kind: 'anonymous', playerId: null, displayName: 'Keeper', number: '1', initialStatus: 'starter', initialRole: { group: 'goalkeeper', label: null } }],
  }, { recorderUserId: null, occurredAt: '2026-10-24T12:00:00.000Z' })
  if (!result.ok) throw new Error(result.message)
  return result.state
}
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.state = expectOk(startHockeyGame(initializedHockeyGame(), ctx(0)))
  h.dispatch.mockReset().mockImplementation((action: GameAction) => { h.state = action.type === 'HYDRATE_STATE' ? action.state : gameReducer(h.state!, action) })
})
afterEach(() => vi.unstubAllGlobals())

describe('Aligned Soccer/Hockey trackers', () => {
  it.each(['soccer', 'hockey'])('keeps %s clock, team, surface and footer in order', sport => {
    if (sport === 'soccer') h.state = soccerFixture()
    const tree = render(), field = sport === 'soccer' ? SoccerField : HockeyRink
    const at = (type: unknown) => tree.findIndex(element => element.type === type)
    expect(tree.findIndex(element => element.props['aria-label'] === 'Game clock')).toBeLessThan(at(TrackerSideSelector))
    expect(at(TrackerSideSelector)).toBeLessThan(at(field))
    expect(at(field)).toBeLessThan(tree.findIndex(element => element.type === 'details'))
    expect(at(sport === 'soccer' ? EventCloudStatus : HockeyCloudMenuSection)).toBeGreaterThan(at(field))
    expect(tree.some(element => element.type === 'details' && element.props.open)).toBe(false)
    if (sport === 'soccer') {
      expect(tree.findIndex(element => element.props['aria-label'] === 'Field capture')).toBeGreaterThan(at(field))
      expect(tree[0].props.className).toContain('overflow-x-clip')
    }
    else expect(tree.some(element => element.type === HockeyPenaltyBox)).toBe(false)
  })
  it('seeds Hockey located and unlocated shots/plays from the selected team without an event', () => {
    const before = buildGameSyncFingerprint(h.state!)
    child<Parameters<typeof TrackerSideSelector>[0]>(TrackerSideSelector).onChange('opponent')
    let rink = child<Parameters<typeof HockeyRink>[0]>(HockeyRink)
    expect(rink.captureSide).toBe('opponent')
    click('Rivals shot')
    expect(child<Parameters<typeof HockeyShotDialog>[0]>(HockeyShotDialog).draft).toEqual({ side: 'opponent', location: null })
    child<Parameters<typeof HockeyShotDialog>[0]>(HockeyShotDialog).onClose()
    rink = child<Parameters<typeof HockeyRink>[0]>(HockeyRink)
    rink.onLocation!({ x: 0.2, y: 0.4, attackingDirection: 'right_to_left' })
    click('Shot')
    expect(child<Parameters<typeof HockeyShotDialog>[0]>(HockeyShotDialog).draft).toEqual({ side: 'opponent', location: { x: 0.2, y: 0.4 } })
    child<Parameters<typeof HockeyShotDialog>[0]>(HockeyShotDialog).onClose()
    click('Play')
    expect(child<Parameters<typeof HockeyPlayDialog>[0]>(HockeyPlayDialog).draft.side).toBe('opponent')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(buildGameSyncFingerprint(h.state!)).toBe(before)
  })
  it('keeps Hockey filter changes independent of recording side and saved facts', () => {
    const before = buildGameSyncFingerprint(h.state!)
    child<Parameters<typeof TrackerSideSelector>[0]>(TrackerSideSelector).onChange('opponent')
    for (const [label, value] of [['Marker team', 'tracked'], ['Marker family', 'plays'], ['Marker period', 'current']]) {
      const select = render().find(element => element.props['aria-label'] === label)!
      ;(select.props.onChange as (event: unknown) => void)({ target: { value } })
    }
    expect(child<Parameters<typeof TrackerSideSelector>[0]>(TrackerSideSelector).side).toBe('opponent')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(buildGameSyncFingerprint(h.state!)).toBe(before)
  })
  it('seeds Hockey penalty and goalie forms without changing a goalie or assigning a penalty', () => {
    const before = buildGameSyncFingerprint(h.state!)
    child<Parameters<typeof TrackerSideSelector>[0]>(TrackerSideSelector).onChange('opponent')
    click('Penalty')
    expect(child<Parameters<typeof HockeyPenaltyDialog>[0]>(HockeyPenaltyDialog).defaultSide).toBe('opponent')
    child<Parameters<typeof HockeyPenaltyDialog>[0]>(HockeyPenaltyDialog).onClose()
    click('Goalie')
    expect(child<Parameters<typeof HockeyGoalieDialog>[0]>(HockeyGoalieDialog).defaultSide).toBe('opponent')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(buildGameSyncFingerprint(h.state!)).toBe(before)
  })
  it('keeps faceoff outcome explicit rather than deriving it from the Hockey team selector', () => {
    child<Parameters<typeof TrackerSideSelector>[0]>(TrackerSideSelector).onChange('opponent')
    child<Parameters<typeof HockeyRink>[0]>(HockeyRink).onFaceoffDot!('center')
    child<Parameters<typeof HockeyFaceoffControl>[0]>(HockeyFaceoffControl).onRecord({ winner: 'tracked', takerParticipantId: null, opponentTakerLabel: null })
    const events = h.state!.eventStream!.events
    expect(events[events.length - 1]).toMatchObject({ eventType: 'hockey.faceoff', teamSide: 'neutral', payload: { winner: 'tracked' } })
  })
  it('opens the Hockey penalty box without recording or stopping its clock', () => {
    h.state = expectOk(startHockeyClock(h.state!, ctx(1)))
    const before = buildGameSyncFingerprint(h.state!)
    click('Open penalty box')
    expect(child<Parameters<typeof HockeyPenaltyBox>[0]>(HockeyPenaltyBox).sport).toBe(h.state!.sportGameState)
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(buildGameSyncFingerprint(h.state!)).toBe(before)
    expect(h.state!.sportGameState?.sportId === 'hockey' && h.state!.sportGameState.projection.clock?.running).toBe(true)
  })
  it('keeps Soccer side selection fingerprint-inert and seeds the same quick shot workflow', () => {
    h.state = soccerFixture()
    const before = buildGameSyncFingerprint(h.state)
    child<Parameters<typeof TrackerSideSelector>[0]>(TrackerSideSelector).onChange('opponent')
    expect(buildGameSyncFingerprint(h.state!)).toBe(before)
    const goal = render().find(element => typeof element.type === 'function' && element.props.label === 'Goal')!
    ;(goal.props.onClick as () => void)()
    expect(child<Parameters<typeof SoccerQuickShotSheet>[0]>(SoccerQuickShotSheet).draft?.teamSide).toBe('opponent')
    expect(h.state!.eventStream!.events).toHaveLength(2)
  })
  it('lets a new Hockey play inherit side context but keeps stored edit authority first', () => {
    const sport = h.state!.sportGameState!
    if (sport.sportId !== 'hockey') throw new Error('Fixture')
    const props: Parameters<typeof HockeyPlayDialog>[0] = { draft: { kind: 'hit', location: null, side: 'opponent' }, sport,
      recentOpponentLabels: [], trackedLabel: 'Blades', opponentLabel: 'Rivals', onSubmit: vi.fn(), onTeamSubmit: vi.fn(), onClose: vi.fn() }
    const chosenSide = (initial?: typeof props.initial) => {
      h.cursor = 0; h.slots = []
      return elements(HockeyPlayDialog({ ...props, initial })).find(element => element.props.value === 'opponent' || element.props.value === 'tracked')!.props.value
    }
    expect(chosenSide()).toBe('opponent')
    expect(chosenSide({ kind: 'hit', side: 'tracked', player: null, hitPlayer: null, location: null })).toBe('tracked')
  })
  it('seeds new penalty/goalie forms while stored penalty edits retain their own sides', () => {
    const sport = h.state!.sportGameState!
    if (sport.sportId !== 'hockey') throw new Error('Fixture')
    const props: Parameters<typeof HockeyPenaltyDialog>[0] = { sport, defaultSide: 'opponent', recentOpponentLabels: [],
      trackedLabel: 'Blades', opponentLabel: 'Rivals', onSubmit: vi.fn(), onClose: vi.fn() }
    const side = (initial?: typeof props.initial) => {
      h.cursor = 0; h.slots = []
      return elements(HockeyPenaltyDialog({ ...props, initial })).find(element => element.props.value === 'tracked' || element.props.value === 'opponent')!.props.value
    }
    expect(side()).toBe('opponent')
    expect(side({ penalties: [{ side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player' }] })).toBe('tracked')
    h.cursor = 0; h.slots = []
    const selected = elements(HockeyGoalieDialog({ sport, defaultSide: 'opponent', trackedLabel: 'Blades', opponentLabel: 'Rivals', onSubmit: vi.fn(), onClose: vi.fn() }))
      .find(element => element.type === 'button' && element.props['aria-pressed'] === true)
    expect(selected?.props.children).toBe('Rivals')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import GameInfo from './GameInfo'
import { createInitialState } from '../lib/gameReducer'
import { saveActiveGameState } from '../lib/gameParking'
import { sports } from '../config/sports'
import type { GameState } from '../types'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../lib/authIdentity'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>,
  cleanups: [] as Array<() => void>, userId: 'account-a', role: 'owner', team: true,
  gameId: 'cloud-a', sportId: 'baseball', authority: vi.fn(), load: vi.fn(), independent: vi.fn(), rpc: vi.fn(),
  legacy: vi.fn(), touch: vi.fn(), resume: vi.fn(), prepare: vi.fn(),
  dispatch: vi.fn(), open: vi.fn(), navigate: vi.fn(), reopen: vi.fn(), finalized: vi.fn(), refresh: vi.fn(), state: {} as GameState,
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial
    return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value }]
  },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i] },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const i = h.cursor++, previous = h.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
      previous?.cleanup?.(); const slot = { deps, cleanup: undefined as (() => void) | undefined }; h.slots[i] = slot
      h.effects.push(() => { slot.cleanup = effect(); if (slot.cleanup) h.cleanups.push(slot.cleanup) })
    }
  },
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate,
  useSearchParams: () => [new URLSearchParams({ gameId: h.gameId })], Link: 'a' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: h.userId }, isConfigured: true }) }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: h.state, dispatch: h.dispatch,
  activeLocalGameId: null, parkedGames: [], openGameSnapshot: h.open, prepareActiveGameMutation: h.prepare,
  resumeParkedGame: h.resume, flushCloudGameSync: vi.fn(), markEventCloudGameReopened: h.reopen,
  markBaseballCloudGameFinalized: h.finalized, refreshBaseballCloudGameStatus: h.refresh, parkingError: null }) }))
vi.mock('../lib/baseball/cloudSync', () => ({ loadBaseballCloudDataAuthority: (...args: unknown[]) => h.authority(...args),
  loadBaseballCloudGameById: (...args: unknown[]) => h.load(...args),
  createBaseballIndependentRecorderState: (...args: unknown[]) => h.independent(...args) }))
vi.mock('../lib/basketball/cloudSync', () => ({ loadBasketballCloudDataAuthority: (...args: unknown[]) => h.authority(...args),
  loadBasketballCloudGameById: (...args: unknown[]) => h.load(...args),
  createBasketballIndependentRecorderState: (...args: unknown[]) => h.independent(...args) }))
vi.mock('../lib/cloudSync', () => ({ loadCloudGameById: (...args: unknown[]) => h.legacy(...args),
  touchCloudGameLastOpened: (...args: unknown[]) => h.touch(...args) }))
vi.mock('../components/baseball/BaseballFinalizationPanel', () => ({ default: 'baseball-finalization' }))
vi.mock('../components/baseball/BaseballRecorderManager', () => ({ default: 'baseball-recorders' }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => h.rpc(...args), from: (table: string) => {
  const data = () => table === 'games' ? { id: h.gameId, team_id: h.team ? 'team-1' : null,
    created_by: 'account-a', sport_id: h.sportId, tracked_team_name: 'Falcons', opponent_name: 'Wolves',
    status: 'in_progress', opponent_score: 0, home_team_score: null, home_score_adjustment: 0,
    game_date: '2026-10-18', notes: null, tournament_name: null, tournament_id: null }
    : table === 'teams' ? { id: 'team-1', name: 'Falcons', nickname: 'Falcons', owner_id: h.role === 'owner' ? h.userId : 'owner-b',
      seasons: { id: 'season-1', name: 'Fall', sport: h.sportId } }
      : table === 'team_members' ? { role: h.role, accepted_at: '2026-10-18' } : []
  const builder = { select: () => builder, eq: () => builder,
    single: () => Promise.resolve({ data: data(), error: null }), maybeSingle: () => Promise.resolve({ data: data(), error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve) }
  return builder
} } }))

class MemoryStorage {
  store = new Map<string, string>()
  getItem(key: string) { return this.store.get(key) ?? null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...elements(node.props.children)]
}
function render() { h.cursor = 0; h.effects = []; const tree = elements(GameInfo()); h.effects.forEach(effect => effect()); return tree }
async function drain() { for (let i = 0; i < 16; i++) await Promise.resolve() }
async function loaded() { render(); await drain(); return render() }
async function openLegacy() {
  const tree = await loaded()
  const button = tree.find(element => element.type === 'button' &&
    ['View legacy summary (read-only)', 'Open game'].includes(element.props.children as string))
  if (!button) throw new Error('Missing saved-game open action')
  await (button.props.onClick as () => Promise<void>)()
  return render()
}
function localHistory(): GameState {
  return { ...createInitialState(), sport: sports.find(sport => sport.id === h.sportId)!,
    gameInfo: { teamName: 'Falcons', opponentName: 'Wolves', date: '2026-10-18', tournamentName: '', tournamentId: null },
    notes: 'Unsynced local facts', players: [{ id: 'p', name: 'Pat', number: '1', stats: { ast: 4 } }],
    cloudSync: { ...createInitialState().cloudSync, gameId: h.gameId, status: 'offline' } }
}
function expectNoCloudReplacement() {
  expect(h.legacy).not.toHaveBeenCalled()
  expect(h.load).not.toHaveBeenCalled()
  expect(h.open).not.toHaveBeenCalled()
  expect(h.touch).not.toHaveBeenCalled()
  expect(h.dispatch).not.toHaveBeenCalled()
}
function panel(tree: ReturnType<typeof render>, type = 'baseball-finalization') {
  const item = tree.find(element => element.type === type)
  if (!item) throw new Error(`Missing ${type}`)
  return item.props
}
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.cleanups = []; h.userId = 'account-a'; h.gameId = 'cloud-a'; h.sportId = 'baseball'; h.role = 'owner'; h.team = true
  h.state = createInitialState(); setCurrentAuthUserId(h.userId)
  for (const mock of [h.authority, h.load, h.independent, h.rpc, h.dispatch, h.open, h.navigate, h.reopen, h.finalized, h.refresh,
    h.legacy, h.touch, h.resume, h.prepare]) mock.mockReset()
  h.authority.mockResolvedValue('sport_events'); h.rpc.mockResolvedValue({ data: [], error: null }); h.open.mockReturnValue(true)
  h.legacy.mockResolvedValue(null); h.touch.mockResolvedValue(undefined); h.resume.mockReturnValue(true); h.prepare.mockReturnValue(true)
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('window', { confirm: () => true })
})
afterEach(() => { h.cleanups.forEach(cleanup => cleanup()); resetCurrentAuthUserIdForTests(); vi.unstubAllGlobals() })

describe('Game Info retired legacy local bindings', () => {
  it.each([['basketball', 'active'], ['basketball', 'parked'], ['baseball', 'active'], ['baseball', 'parked']])(
    'preserves dirty %s %s history instead of replacing it with cloud data', async (sport, kind) => {
      h.sportId = sport; h.authority.mockResolvedValue('legacy')
      const local = localHistory()
      const parked = kind === 'parked' ? saveActiveGameState(local, h.userId) : []
      if (kind === 'active') h.state = local
      const before = new Map((localStorage as unknown as MemoryStorage).store)
      await openLegacy()
      expect(h.navigate).toHaveBeenCalledWith('/summary')
      expectNoCloudReplacement()
      if (kind === 'parked') {
        expect(h.prepare).toHaveBeenCalledWith('resume_commit')
        expect(h.resume).toHaveBeenCalledWith(parked[0].localGameId)
      } else {
        expect(h.resume).not.toHaveBeenCalled()
        expect(h.state).toBe(local)
      }
      expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
    }
  )
  it.each(['active', 'parked'])('refuses incompatible Basketball %s event authority without replacing history', async kind => {
    h.sportId = 'basketball'; h.authority.mockResolvedValue('legacy')
    const local = { ...localHistory(), gameDataAuthority: 'sport_events' as const }
    if (kind === 'active') h.state = local
    else saveActiveGameState(local, h.userId)
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    const tree = await openLegacy()
    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
    expectNoCloudReplacement()
    expect(tree.some(element => typeof element.props.children === 'string' &&
      /incompatible authority|conflicting local bindings/.test(element.props.children))).toBe(true)
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
  it('refuses unknown Basketball authority even with compatible local history', async () => {
    h.sportId = 'basketball'; h.authority.mockResolvedValue(null); h.state = localHistory()
    const tree = await openLegacy()
    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
    expectNoCloudReplacement()
    expect(tree.some(element => element.props.children ===
      'Basketball authority is unavailable. Reload before opening this game.')).toBe(true)
  })
  it.each(['prepare', 'resume'] as const)('does not navigate when a parked Basketball %s guard refuses', async guard => {
    h.sportId = 'basketball'; h.authority.mockResolvedValue('legacy')
    saveActiveGameState(localHistory(), h.userId); h[guard].mockReturnValue(false)
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    await openLegacy()
    expect(h.prepare).toHaveBeenCalledWith('resume_commit')
    if (guard === 'prepare') expect(h.resume).not.toHaveBeenCalled()
    else expect(h.resume).toHaveBeenCalled()
    expect(h.navigate).not.toHaveBeenCalled()
    expectNoCloudReplacement()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
})

describe('BSB-6B2 Game Info', () => {
  it.each(['owner', 'admin', 'scorer', 'viewer'])('exposes manager controls only for %s authority', async role => {
    h.role = role; const tree = await loaded()
    expect(panel(tree).canManage).toBe(role === 'owner' || role === 'admin')
    expect(panel(tree, 'baseball-recorders').canManage).toBe(role === 'owner' || role === 'admin')
    expect(panel(tree).sideLabels).toEqual({ tracked: 'Falcons', opponent: 'Wolves' })
    expect(h.rpc).not.toHaveBeenCalledWith('get_game_stats_resolved', expect.anything())
  })
  it('keeps legacy Baseball out of event management and preserves resolved-stat reads', async () => {
    h.authority.mockResolvedValue('legacy'); const tree = await loaded()
    expect(tree.some(element => element.type === 'baseball-finalization')).toBe(false)
    expect(h.rpc).toHaveBeenCalledWith('get_game_stats_resolved', { p_game_id: 'cloud-a' })
  })
  it('allows the personal-game creator to manage', async () => {
    h.team = false; expect(panel(await loaded()).canManage).toBe(true)
  })
  it('does not label an unconfirmed preview as the published score', async () => {
    const props = panel(await loaded())
    ;(props.onFinalized as (result: unknown) => void)({ serverScoreConfirmed: false,
      score: { tracked: 3, opponent: 2 }, previewScore: { tracked: 3, opponent: 2 } })
    const next = render()
    expect(panel(next).trackedScore).toBeNull()
    expect(panel(next).opponentScore).toBeNull()
    expect(next.some(element => typeof element.props.children === 'string' && element.props.children.includes('could not be read back'))).toBe(true)
  })
  it('routes Baseball open through the event loader and cancels after unmount', async () => {
    let resolve!: (state: ReturnType<typeof createInitialState>) => void
    h.load.mockReturnValue(new Promise(done => { resolve = done }))
    const tree = await loaded(), button = tree.find(element => element.type === 'button' && element.props.children === 'Open game')
    if (!button) throw new Error('open button')
    const opening = (button.props.onClick as () => Promise<void>)(); await drain()
    expect(h.load).toHaveBeenCalledWith('account-a', 'cloud-a')
    h.cleanups.forEach(cleanup => cleanup()); resolve(createInitialState()); await opening
    expect(h.open).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled()
  })
  it('ignores lifecycle callbacks after a pre-render account change', async () => {
    const props = panel(await loaded()); setCurrentAuthUserId('account-b')
    await (props.onReopened as (result: unknown, publication: unknown) => Promise<void>)(
      { publicationId: 'pub-1', reason: 'Correct runner', reopenedAt: '2026-10-18T12:00:00Z' }, { primaryRecorderId: 'account-a' })
    expect(h.reopen).not.toHaveBeenCalledWith('cloud-a', expect.objectContaining({ publicationId: 'pub-1' }))
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('hands a manager reopen to the matching owned binding without inventing a durable server receipt', async () => {
    const props = panel(await loaded()); h.reopen.mockClear()
    await (props.onReopened as (result: unknown, publication: unknown) => Promise<void>)(
      { publicationId: 'pub-1', reason: 'Correct runner', reopenedAt: '2026-10-18T12:00:00Z' }, { primaryRecorderId: 'recorder-b' })
    expect(h.reopen).toHaveBeenCalledWith('cloud-a', { sportId: 'baseball', publicationId: 'pub-1', primaryRecorderId: 'recorder-b',
      reason: 'Correct runner', reopenedAt: '2026-10-18T12:00:00Z' })
  })
  it('marks matching parked bindings final even while another game is active', async () => {
    const props = panel(await loaded())
    h.state = { ...createInitialState(), cloudSync: { ...createInitialState().cloudSync, gameId: 'cloud-b' } }
    render()
    ;(props.onFinalized as (result: unknown) => void)({ serverScoreConfirmed: true,
      score: { tracked: 3, opponent: 2 }, previewScore: { tracked: 3, opponent: 2 } })
    expect(h.finalized).toHaveBeenCalledWith('cloud-a')
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})

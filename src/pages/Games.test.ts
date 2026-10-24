import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import Games from './Games'
import { createInitialState } from '../lib/gameReducer'
import { saveActiveGameState, type ParkedGameSummary } from '../lib/gameParking'
import type { GameState } from '../types'
import { sports } from '../config/sports'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../lib/authIdentity'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void>,
  userId: 'account-a', sportId: 'baseball', authority: vi.fn(), load: vi.fn(), independent: vi.fn(), legacy: vi.fn(), touch: vi.fn(),
  open: vi.fn(), navigate: vi.fn(), refresh: vi.fn(), resume: vi.fn(), state: null as GameState | null,
  activeId: null as string | null, parked: [] as ParkedGameSummary[],
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial
    return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === 'function' ? value(harness.slots[index]) : value }]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      previous?.cleanup?.()
      const slot = { deps, cleanup: undefined as (() => void) | undefined }
      harness.slots[index] = slot
      harness.effects.push(() => { slot.cleanup = effect(); if (slot.cleanup) harness.cleanups.push(slot.cleanup) })
    }
  },
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => harness.navigate, useSearchParams: () => [new URLSearchParams()], Link: 'a',
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: harness.userId }, isConfigured: true }) }))
vi.mock('../context/GameContext', async () => {
  const { saveActiveGameState } = await import('../lib/gameParking')
  const { createInitialState } = await import('../lib/gameReducer')
  return { useGame: () => {
    const owner = harness.userId
    return { state: harness.state ?? createInitialState(), dispatch: vi.fn(), activeLocalGameId: harness.activeId, parkedGames: harness.parked, parkingError: null,
      prepareActiveGameMutation: () => true, resumeParkedGame: harness.resume, refreshBaseballCloudGameStatus: harness.refresh,
      openGameSnapshot: (state: Parameters<typeof saveActiveGameState>[0]) => { harness.open(state); saveActiveGameState(state, owner); return true },
    }
  } }
})
vi.mock('../lib/baseball/cloudSync', () => ({
  loadBaseballCloudDataAuthority: (...args: unknown[]) => harness.authority(...args),
  loadBaseballCloudGameById: (...args: unknown[]) => harness.load(...args),
  createBaseballIndependentRecorderState: (...args: unknown[]) => harness.independent(...args),
}))
vi.mock('../lib/hockey/cloudSync', () => ({
  loadHockeyCloudDataAuthority: (...args: unknown[]) => harness.authority(...args),
  loadHockeyCloudGameById: (...args: unknown[]) => harness.load(...args),
  createHockeyIndependentRecorderState: (...args: unknown[]) => harness.independent(...args),
}))
vi.mock('../lib/basketball/cloudSync', () => ({
  loadBasketballCloudDataAuthority: (...args: unknown[]) => harness.authority(...args),
  loadBasketballCloudGameById: (...args: unknown[]) => harness.load(...args),
  createBasketballIndependentRecorderState: (...args: unknown[]) => harness.independent(...args),
}))
vi.mock('../lib/soccer/cloudSync', () => ({ loadSoccerCloudGameById: (...args: unknown[]) => harness.load(...args) }))
vi.mock('../lib/soccer/recorders', () => ({ createSoccerIndependentRecorderState: (...args: unknown[]) => harness.independent(...args) }))
vi.mock('../lib/cloudSync', () => ({
  loadCloudGameById: (...args: unknown[]) => harness.legacy(...args), touchCloudGameLastOpened: (...args: unknown[]) => harness.touch(...args),
}))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const builder = {
    select: () => builder, order: () => builder, eq: () => builder, in: () => builder, not: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'games' ? [{
      id: 'cloud-a', team_id: null, created_by: 'account-a', sport_id: harness.sportId,
      tracked_team_name: 'Home', opponent_name: 'Away', opponent_score: 0, home_team_score: 0,
      home_score_adjustment: 0, tournament_name: null, tournament_id: null, game_date: '2026-10-18', status: 'in_progress', created_at: '2026-10-18',
    }] : [], error: null }).then(resolve),
  }
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
function render() {
  harness.cursor = 0; harness.effects = []
  const tree = elements(Games())
  harness.effects.forEach(effect => effect())
  return tree
}
async function drain() { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
async function open() {
  render(); await drain()
  const button = render().find(element => element.type === 'button' && ['View Details', 'Review Game', 'View Summary', 'Open saved game'].includes(element.props.children as string))
  if (!button) throw new Error('Missing cloud open action')
  const click = button.props.onClick as () => void
  click()
  return click
}
function candidate() {
  return { ...createInitialState(), sport: sports.find(sport => sport.id === harness.sportId)!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', date: '2026-10-18', tournamentName: '', tournamentId: null } }
}
beforeEach(() => {
  setCurrentAuthUserId('account-a')
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.cleanups = []
  harness.userId = 'account-a'; harness.sportId = 'baseball'
  harness.state = null; harness.activeId = null; harness.parked = []
  for (const mock of [harness.authority, harness.load, harness.independent, harness.legacy, harness.touch, harness.open, harness.navigate, harness.refresh, harness.resume]) mock.mockReset()
  harness.refresh.mockResolvedValue('in_progress'); harness.resume.mockReturnValue(candidate())
  harness.authority.mockResolvedValue('sport_events'); harness.touch.mockResolvedValue(undefined)
  harness.legacy.mockResolvedValue(null)
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('window', { confirm: () => true })
})
afterEach(() => { harness.cleanups.forEach(cleanup => cleanup()); resetCurrentAuthUserIdForTests(); vi.unstubAllGlobals() })

describe('Cloud Games open lifetime', () => {
  it.each([['basketball', 'active'], ['basketball', 'parked'], ['baseball', 'active'], ['baseball', 'parked']])(
    'preserves dirty %s %s history instead of loading an older cloud snapshot', async (sport, kind) => {
      harness.sportId = sport; harness.authority.mockResolvedValue('legacy')
      const local = { ...candidate(), notes: 'Unsynced local facts',
        players: [{ id: 'p', name: 'Pat', number: '1', stats: { ast: 4 } }],
        cloudSync: { ...createInitialState().cloudSync, gameId: 'cloud-a', status: 'offline' as const } }
      if (kind === 'active') harness.state = local
      else { harness.parked = saveActiveGameState(local, 'account-a'); harness.activeId = 'another-slot' }
      const before = new Map((localStorage as unknown as MemoryStorage).store)
      await open(); await drain()
      expect(harness.navigate).toHaveBeenCalledWith('/summary')
      expect(harness.legacy).not.toHaveBeenCalled()
      expect(harness.open).not.toHaveBeenCalled()
      expect(harness.touch).not.toHaveBeenCalled()
      if (kind === 'parked') expect(harness.resume).toHaveBeenCalledWith(harness.parked[0].localGameId)
      else expect(harness.state).toBe(local)
      expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
    }
  )
  it('refuses a legacy Basketball open with incompatible event-bound local history', async () => {
    harness.sportId = 'basketball'; harness.authority.mockResolvedValue('legacy')
    harness.state = { ...candidate(), gameDataAuthority: 'sport_events',
      cloudSync: { ...createInitialState().cloudSync, gameId: 'cloud-a' } }
    await open(); await drain()
    expect(harness.navigate).not.toHaveBeenCalled()
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.legacy).not.toHaveBeenCalled()
  })
  it.each(['active', 'parked'])('refreshes a reopened %s Baseball binding before opening its local history', async kind => {
    const local = { ...candidate(), gameDataAuthority: 'sport_events' as const,
      cloudSync: { ...createInitialState().cloudSync, gameId: 'cloud-a', gameStatus: 'final' } }
    if (kind === 'active') harness.state = local
    else {
      harness.parked = saveActiveGameState(local, 'account-a')
      harness.activeId = 'another-active-slot'
    }
    let settle!: (value: string) => void
    harness.refresh.mockReturnValue(new Promise(resolve => { settle = resolve }))
    await open(); await drain()
    expect(harness.refresh).toHaveBeenCalledWith('cloud-a', expect.any(Function))
    expect(harness.navigate).not.toHaveBeenCalled(); expect(harness.resume).not.toHaveBeenCalled()
    settle('in_progress'); await drain()
    expect(harness.navigate).toHaveBeenCalledWith('/game')
    if (kind === 'parked') expect(harness.resume).toHaveBeenCalledWith(harness.parked[0].localGameId)
    expect(harness.load).not.toHaveBeenCalled()
  })
  it('passes an unmount/auth/request guard into Baseball status refresh', async () => {
    let settle!: (value: string) => void
    harness.refresh.mockReturnValue(new Promise(resolve => { settle = resolve }))
    const click = await open(); await drain()
    const isCurrent = harness.refresh.mock.calls[0][1] as () => boolean
    expect(isCurrent()).toBe(true)
    click(); await drain()
    expect(isCurrent()).toBe(false)
    const latest = harness.refresh.mock.calls[1][1] as () => boolean
    setCurrentAuthUserId('account-b'); expect(latest()).toBe(false)
    harness.cleanups.forEach(cleanup => cleanup())
    settle('in_progress'); await drain()
    expect(harness.navigate).not.toHaveBeenCalled()
  })
  it.each(['baseball', 'hockey', 'basketball', 'soccer'])('cancels %s adoption when auth changes before React rerenders', async sport => {
    harness.sportId = sport
    let settle!: (value: ReturnType<typeof candidate>) => void
    harness.load.mockReturnValue(new Promise(resolve => { settle = resolve }))
    await open()
    await vi.waitFor(() => expect(harness.load).toHaveBeenCalledOnce())
    setCurrentAuthUserId('account-b')
    saveActiveGameState(candidate(), 'account-b')
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    settle(candidate()); await drain()
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.navigate).not.toHaveBeenCalled()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
  it('does not revive an old request when the rendered account changes A to B to A', async () => {
    let settle!: (value: ReturnType<typeof candidate>) => void
    harness.load.mockReturnValue(new Promise(resolve => { settle = resolve }))
    await open()
    await vi.waitFor(() => expect(harness.load).toHaveBeenCalledOnce())
    harness.userId = 'account-b'; setCurrentAuthUserId('account-b'); render()
    harness.userId = 'account-a'; setCurrentAuthUserId('account-a'); render()
    saveActiveGameState(candidate(), 'account-a')
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    settle(candidate()); await drain()
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.navigate).not.toHaveBeenCalled()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
  it('lets a newer request supersede an earlier open for the same account', async () => {
    let settle!: (value: ReturnType<typeof candidate>) => void
    harness.load.mockReturnValueOnce(new Promise(resolve => { settle = resolve }))
    harness.load.mockResolvedValue(candidate())
    const reopen = await open()
    await vi.waitFor(() => expect(harness.load).toHaveBeenCalledOnce())
    reopen(); await drain()
    expect(harness.open).toHaveBeenCalledOnce()
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    settle(candidate()); await drain()
    expect(harness.open).toHaveBeenCalledOnce()
    expect(harness.navigate).toHaveBeenCalledOnce()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
  it.each(['baseball', 'hockey', 'basketball', 'soccer'])('does not open stale %s data after unmount and account switch', async sport => {
    harness.sportId = sport
    let settle!: (value: ReturnType<typeof candidate>) => void
    harness.load.mockReturnValue(new Promise(resolve => { settle = resolve }))
    await open()
    await vi.waitFor(() => expect(harness.load).toHaveBeenCalledOnce())
    harness.cleanups.forEach(cleanup => cleanup())
    harness.userId = 'account-b'
    saveActiveGameState(candidate(), 'account-b')
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    settle(candidate()); await drain()
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.navigate).not.toHaveBeenCalled()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
  it('cancels a mounted open when the account changes while creating an independent stream', async () => {
    harness.load.mockResolvedValue(null)
    let settle!: (value: ReturnType<typeof candidate>) => void
    harness.independent.mockReturnValue(new Promise(resolve => { settle = resolve }))
    await open()
    await vi.waitFor(() => expect(harness.independent).toHaveBeenCalledOnce())
    harness.userId = 'account-b'; saveActiveGameState(candidate(), 'account-b'); render()
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    settle(candidate()); await drain()
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.navigate).not.toHaveBeenCalled()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
  it('does not fall through to legacy loading when an old authority request settles after unmount', async () => {
    let settle!: (value: string) => void
    harness.authority.mockReturnValue(new Promise(resolve => { settle = resolve }))
    await open()
    await vi.waitFor(() => expect(harness.authority).toHaveBeenCalledOnce())
    harness.cleanups.forEach(cleanup => cleanup())
    harness.userId = 'account-b'; saveActiveGameState(candidate(), 'account-b')
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    settle('legacy'); await drain()
    expect(harness.legacy).not.toHaveBeenCalled()
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.navigate).not.toHaveBeenCalled()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
  })
  it('still opens a current recorder stream', async () => {
    harness.load.mockResolvedValue(candidate())
    await open(); await drain()
    expect(harness.open).toHaveBeenCalledOnce()
    expect(harness.navigate).toHaveBeenCalledWith('/game')
  })
  it.each(['legacy-read', 'last-opened'])('cancels legacy opening after pending %s settles on an unmounted page', async stage => {
    harness.sportId = 'football'
    let settle!: (value: unknown) => void
    const pending = new Promise(resolve => { settle = resolve })
    if (stage === 'legacy-read') harness.legacy.mockReturnValue(pending)
    else {
      harness.legacy.mockResolvedValue({ gameId: 'cloud-a' })
      harness.touch.mockReturnValue(pending)
    }
    await open()
    await vi.waitFor(() => expect(stage === 'legacy-read' ? harness.legacy : harness.touch).toHaveBeenCalledOnce())
    harness.cleanups.forEach(cleanup => cleanup())
    harness.userId = 'account-b'; saveActiveGameState(candidate(), 'account-b')
    const before = new Map((localStorage as unknown as MemoryStorage).store)
    settle({ gameId: 'cloud-a' }); await drain()
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.navigate).not.toHaveBeenCalled()
    expect((localStorage as unknown as MemoryStorage).store).toEqual(before)
    if (stage === 'legacy-read') expect(harness.touch).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameProvider } from './GameContext'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import { createBaseballEventGameState } from '../lib/baseball/setupBuilder'
import { baseballSetup } from '../lib/baseball/testFixtures'
import { saveActiveGameState, parkActiveGame, getActiveLocalGameId, getParkedGameRecord } from '../lib/gameParking'
import type { GameState } from '../types'

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, userId: 'account-a', state: null as unknown,
  dispatch: vi.fn(), sync: vi.fn(), automatic: false, renderRequested: false,
  effects: [] as Array<() => void>, cleanups: [] as Array<() => void>,
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useReducer: () => [harness.state, harness.dispatch],
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial
    return [harness.slots[index], (value: unknown) => {
      const next = typeof value === 'function' ? value(harness.slots[index]) : value
      if (harness.automatic && !Object.is(next, harness.slots[index])) harness.renderRequested = true
      harness.slots[index] = next
    }]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as { callback: unknown; deps: unknown[] } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) harness.slots[index] = { callback, deps }
    return (harness.slots[index] as { callback: unknown }).callback
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    if (!harness.automatic) return
    // Drive the queue/retry and 150ms debounce effects, not unrelated auth/persistence effects.
    const queueEffect = deps.length === 6 && typeof deps[3] === 'function' && typeof deps[4] === 'number'
    const debounceEffect = deps.length === 4 && typeof deps[0] === 'function' && typeof deps[1] === 'boolean'
    if (!queueEffect && !debounceEffect) return
    const index = harness.cursor++
    const previous = harness.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    previous?.cleanup?.()
    const slot = { deps, cleanup: undefined as (() => void) | undefined }
    harness.slots[index] = slot
    harness.effects.push(() => { slot.cleanup = effect(); if (slot.cleanup) harness.cleanups.push(slot.cleanup) })
  },
  useLayoutEffect: (effect: () => void) => { if (harness.automatic) effect() },
}))
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: harness.userId }, isConfigured: true }) }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/baseball/cloudSync', async original => ({ ...await original<typeof import('../lib/baseball/cloudSync')>(),
  syncBaseballEventGameToCloud: (...args: unknown[]) => harness.sync(...args),
}))
vi.mock('../lib/cloudSync', async original => ({ ...await original<typeof import('../lib/cloudSync')>(),
  syncGameSnapshotToCloud: (...args: unknown[]) => harness.sync(...args),
}))

class MemoryStorage {
  store = new Map<string, string>()
  writes: string[] = []
  getItem(key: string) { return this.store.get(key) ?? null }
  setItem(key: string, value: string) { this.writes.push(key); this.store.set(key, value) }
  removeItem(key: string) { this.writes.push(key); this.store.delete(key) }
}
function render() {
  harness.cursor = 0; harness.effects = []; harness.renderRequested = false
  const value = GameProvider({ children: null }).props.value
  harness.effects.forEach(effect => effect())
  return value
}
async function drain() { for (let i = 0; i < 16; i += 1) await Promise.resolve() }
async function drainAutomaticRenders() {
  for (let i = 0; i < 16; i += 1) {
    await Promise.resolve()
    if (harness.renderRequested) render()
  }
}
function fixture(kind: string): GameState {
  if (kind === 'baseball') {
    const created = createBaseballEventGameState({ sport: sports.find(sport => sport.id === 'baseball')!,
      setup: baseballSetup(), teamName: 'Home', date: '2026-10-18', cloudPolicy: 'automatic' })
    if (!created.ok) throw new Error(created.message)
    return created.state
  }
  return { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', date: '2026-10-18', tournamentName: '', tournamentId: null },
    players: [{ id: 'p1', name: 'Alex', number: '1', stats: {} }],
  }
}
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.userId = 'account-a'
  harness.automatic = false; harness.renderRequested = false; harness.effects = []; harness.cleanups = []
  harness.dispatch.mockClear(); harness.sync.mockReset()
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', { clearTimeout: vi.fn() })
})
afterEach(() => { harness.cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals() })

describe('sync settlement account isolation', () => {
  it.each(['success', 'rejection'])('automatically drains B after its queued worker waits for stale A %s', async settlement => {
    harness.automatic = true
    let timerId = 0
    const timers = new Map<number, { callback: () => void; delay: number }>()
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { callback, delay }); return id },
      clearTimeout: (id: number) => timers.delete(id),
    })
    const first = fixture('baseball')
    harness.state = first
    saveActiveGameState(first, 'account-a')
    let finishA!: (value: unknown) => void
    let rejectA!: (reason: unknown) => void
    let finishB!: (value: unknown) => void
    const pendingA = new Promise((resolve, reject) => { finishA = resolve; rejectA = reject })
    const pendingB = new Promise(resolve => { finishB = resolve })
    harness.sync.mockImplementation((input: { userId: string }) => input.userId === 'account-a' ? pendingA : pendingB)
    render()
    await drainAutomaticRenders()
    expect(harness.sync).toHaveBeenCalledOnce()

    harness.userId = 'account-b'
    const second = fixture('baseball')
    harness.state = second
    saveActiveGameState(second, 'account-b')
    const bId = getActiveLocalGameId('account-b')!
    render()
    await drainAutomaticRenders()
    const debounce = [...timers.entries()].find(([, timer]) => timer.delay === 150)
    expect(debounce).toBeDefined()
    timers.delete(debounce![0]); debounce![1].callback()
    await drainAutomaticRenders()
    expect(harness.sync).toHaveBeenCalledOnce()
    expect(getParkedGameRecord(bId, 'account-b')?.sync).toMatchObject({ dirty: true, nextAttemptAt: null })
    const storage = localStorage as unknown as MemoryStorage
    const before = new Map(storage.store)
    const writes = storage.writes.length
    expect(harness.renderRequested).toBe(false)

    if (settlement === 'rejection') rejectA(new Error('Account changed'))
    else finishA({ gameId: 'cloud-a' })
    await drain()
    expect(storage.store).toEqual(before)
    expect(storage.writes).toHaveLength(writes)
    await drainAutomaticRenders()
    expect(harness.sync).toHaveBeenCalledTimes(2)
    expect(harness.sync.mock.calls[1][0]).toMatchObject({ userId: 'account-b', localGameId: bId })
    finishB({ seasonId: null, teamId: null, gameId: 'cloud-b', gameStatus: 'in_progress',
      playerIdMap: {}, syncedAt: '2026-10-18T12:00:00.000Z', syncedState: second })
    await drainAutomaticRenders()
    expect(getActiveLocalGameId('account-b')).toBe(bId)
    expect(getParkedGameRecord(bId, 'account-b')).toMatchObject({ ownerId: 'account-b', sync: { dirty: false },
      gameState: { cloudSync: { gameId: 'cloud-b', status: 'synced' } } })
    expect(harness.sync).toHaveBeenCalledTimes(2)
  })
  it('settles a current-account sync normally', async () => {
    const state = fixture('baseball')
    harness.state = state
    saveActiveGameState(state, 'account-a')
    harness.sync.mockResolvedValue({ seasonId: null, teamId: null, gameId: 'cloud-a', gameStatus: 'in_progress',
      playerIdMap: {}, syncedAt: '2026-10-18T12:00:00.000Z', syncedState: state })
    expect(await render().flushCloudSync()).toEqual({ ok: true })
    expect(harness.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'HYDRATE_STATE' }))
    expect(render().parkedGames[0]).toMatchObject({ cloudGameId: 'cloud-a', syncDirty: false, syncStatus: 'synced' })
  })
  it.each([
    ['baseball', 'success'], ['baseball', 'rejection'], ['aggregate', 'success'], ['aggregate', 'rejection'],
  ])('preserves B storage when A %s sync settles with %s', async (kind, settlement) => {
    const first = fixture(kind)
    saveActiveGameState(first, 'account-a')
    parkActiveGame('account-a')
    saveActiveGameState({ ...first, gameInfo: { ...first.gameInfo!, opponentName: 'Second game' } }, 'account-a')
    harness.state = first
    let resolve!: (value: unknown) => void
    let reject!: (reason: unknown) => void
    harness.sync.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no }))
    const pending = render().flushCloudSync()
    await vi.waitFor(() => expect(harness.sync).toHaveBeenCalledOnce())
    harness.userId = 'account-b'
    const second = fixture('aggregate')
    harness.state = second
    saveActiveGameState(second, 'account-b')
    render()
    const storage = localStorage as unknown as MemoryStorage
    const before = new Map(storage.store)
    const writes = storage.writes.length
    harness.dispatch.mockClear()
    if (settlement === 'rejection') reject(new Error('Account changed'))
    else resolve({ seasonId: null, teamId: null, gameId: 'cloud-a', gameStatus: 'in_progress', playerIdMap: {}, syncedAt: '2026-10-18T12:00:00.000Z' })
    expect(await pending).toMatchObject({ ok: false })
    expect(storage.store).toEqual(before)
    expect(storage.writes).toHaveLength(writes)
    expect(harness.dispatch).not.toHaveBeenCalled()
    expect(harness.sync).toHaveBeenCalledOnce()
  })
})

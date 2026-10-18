import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameProvider } from './GameContext'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import { createBaseballEventGameState } from '../lib/baseball/setupBuilder'
import { baseballSetup } from '../lib/baseball/testFixtures'
import { saveActiveGameState, parkActiveGame } from '../lib/gameParking'
import type { GameState } from '../types'

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, userId: 'account-a', state: null as unknown,
  dispatch: vi.fn(), sync: vi.fn(),
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useReducer: () => [harness.state, harness.dispatch],
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
  useCallback: (callback: unknown) => callback, useEffect: () => {}, useLayoutEffect: () => {},
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
function render() { harness.cursor = 0; return GameProvider({ children: null }).props.value }
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
  harness.dispatch.mockClear(); harness.sync.mockReset()
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', { clearTimeout: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('sync settlement account isolation', () => {
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

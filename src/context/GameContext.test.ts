import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameProvider } from './GameContext'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import { saveActiveGameState, parkActiveGame, getParkedGameRecord, hasDirtyParkedGames } from '../lib/gameParking'
import { getPendingSyncFlag, setPendingSyncFlag } from '../lib/gameStorageKeys'
import { basketballSetupDraftKey, createBasketballSetupDraft, loadBasketballSetupDraft, saveBasketballSetupDraft } from '../lib/basketball/setupDraft'

// Drive the provider's real callbacks and storage. Background effects/network stay off.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useReducer: () => [createInitialState(), vi.fn()],
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial
    return [harness.slots[index], (value: unknown) => { harness.slots[index] = value }]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useLayoutEffect: () => {},
}))
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' }, isConfigured: false }) }))
vi.mock('../lib/supabase', () => ({ supabase: null }))

class MemoryStorage {
  store = new Map<string, string>()
  failRemove: string | null = null
  getItem(key: string) { return this.store.get(key) ?? null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) {
    if (key === this.failRemove) throw Error('Storage unavailable')
    this.store.delete(key)
  }
}
const resumeKey = 'statkeeper_cloud_resume_targets'
const scope = 'user:user-1' as const
function render() {
  harness.cursor = 0
  return GameProvider({ children: null }).props.value
}
function seedGame(cloudId: string) {
  const state = { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-09-22' },
    players: [{ id: 'p1', name: 'Alex', number: '1', stats: {} }],
    cloudSync: { ...createInitialState().cloudSync, teamId: 'team', gameId: cloudId } }
  const summaries = saveActiveGameState(state, 'user-1')
  const id = summaries.find(summary => summary.cloudGameId === cloudId)!.localGameId
  parkActiveGame('user-1')
  return id
}
function seedDraft(id: string) {
  const draft = createBasketballSetupDraft({ accountScope: scope, source: { kind: 'personal', teamName: 'Home', seasonId: null, seasonName: '' } })
  draft.committedLocalGameId = id
  const saved = saveBasketballSetupDraft(draft)
  if (!saved.ok) throw Error(saved.error)
}
beforeEach(() => {
  harness.slots = []; harness.cursor = 0
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('GameProvider parked deletion cleanup', () => {
  it('clears matching draft/resume shortcuts and the last pending-sync flag', () => {
    const id = seedGame('cloud-a')
    seedDraft(id)
    localStorage.setItem(resumeKey, JSON.stringify({ 'user-1': 'cloud-a', 'user-2': 'cloud-b' }))
    setPendingSyncFlag(true)
    expect(hasDirtyParkedGames('user-1')).toBe(true)
    expect(render().discardParkedGame(id, { allowUnsyncedLocalDelete: true })).toBe(true)
    expect(getParkedGameRecord(id, 'user-1')).toBeNull()
    expect(loadBasketballSetupDraft(scope)).toBeNull()
    expect(JSON.parse(localStorage.getItem(resumeKey)!)).toEqual({ 'user-2': 'cloud-b' })
    expect(getPendingSyncFlag()).toBe(false)
    expect(render().parkedGames).toEqual([])
    expect(render().parkingError).toBeNull()
  })
  it('preserves unrelated shortcuts, remaining dirty games and their pending flag', () => {
    const deleted = seedGame('cloud-a')
    const kept = seedGame('cloud-b')
    seedDraft(kept)
    localStorage.setItem(resumeKey, JSON.stringify({ 'user-1': 'cloud-b' }))
    setPendingSyncFlag(false)
    expect(render().discardParkedGame(deleted, { allowUnsyncedLocalDelete: true })).toBe(true)
    expect(loadBasketballSetupDraft(scope)?.committedLocalGameId).toBe(kept)
    expect(JSON.parse(localStorage.getItem(resumeKey)!)).toEqual({ 'user-1': 'cloud-b' })
    expect(getParkedGameRecord(kept, 'user-1')).not.toBeNull()
    expect(getPendingSyncFlag()).toBe(true)
  })
  it('rejects an already-removed game without clearing unrelated shortcuts', () => {
    seedDraft('another-game')
    const before = localStorage.getItem(basketballSetupDraftKey(scope))
    expect(before).not.toBeNull()
    expect(render().discardParkedGame('missing', { allowUnsyncedLocalDelete: true })).toBe(false)
    expect(render().parkingError).toBe('That local game is no longer available.')
    expect(localStorage.getItem(basketballSetupDraftKey(scope))).toBe(before)
  })
  it('reports shortcut cleanup failure as a successful deletion with a warning', () => {
    const id = seedGame('cloud-a')
    seedDraft(id)
    ;(localStorage as unknown as MemoryStorage).failRemove = basketballSetupDraftKey(scope)
    expect(render().discardParkedGame(id, { allowUnsyncedLocalDelete: true })).toBe(true)
    expect(getParkedGameRecord(id, 'user-1')).toBeNull()
    expect(render().parkingError).toContain('Local game deleted, but')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameProvider } from './GameContext'
import { createInitialState } from '../lib/gameReducer'
import { sports } from '../config/sports'
import { saveActiveGameState, parkActiveGame, getParkedGameRecord, hasDirtyParkedGames, saveParkedGameRecordStateAtomically } from '../lib/gameParking'
import { getPendingSyncFlag, setPendingSyncFlag } from '../lib/gameStorageKeys'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../lib/authIdentity'
import { createBaseballEventGameState } from '../lib/baseball/setupBuilder'
import { baseballSetup } from '../lib/baseball/testFixtures'
import { endBaseballGame, startBaseballGame } from '../lib/baseball/commands'
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

describe('GameProvider callbacks after the account changes', () => {
  afterEach(() => resetCurrentAuthUserIdForTests())

  /** Callbacks captured while user-1 was signed in, then user-2 signs in and parks a game. */
  function staleUserOneCallbacks() {
    setCurrentAuthUserId('user-1')
    const stale = render()
    setCurrentAuthUserId('user-2')
    const state = { ...createInitialState(), sport: sports.find(sport => sport.id === 'baseball')!,
      gameInfo: { teamName: 'B team', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-10-18' } }
    const id = saveActiveGameState(state, 'user-2').find(summary => summary.teamName === 'B team')!.localGameId
    parkActiveGame('user-2')
    return { stale, state, id }
  }

  it("never reads or writes storage as the old account, so the new account's games survive", async () => {
    const { stale, state, id } = staleUserOneCallbacks()
    expect(stale.openGameSnapshot(state)).toBe(false)
    expect(stale.resumeParkedGame(id)).toBeNull()
    expect(stale.prepareActiveGameMutation('resume_commit')).toBe(false)
    await expect(stale.flushCloudSync()).resolves.toEqual({ ok: false, reason: 'The signed-in account changed. Try again.' })
    await expect(stale.flushCloudGameSync('cloud-x')).resolves.toMatchObject({ ok: false })
    expect(getParkedGameRecord(id, 'user-2')).not.toBeNull()
  })

  it('without the guard, reading as the old account would clear the new account games', () => {
    const { id } = staleUserOneCallbacks()
    // What the stale handler used to do: any parked-game read as user-1.
    expect(getParkedGameRecord(id, 'user-1')).toBeNull()
    hasDirtyParkedGames('user-1')
    expect(getParkedGameRecord(id, 'user-2')).toBeNull()
  })

  it('still opens a game for the signed-in account', () => {
    setCurrentAuthUserId('user-1')
    const state = { ...createInitialState(), sport: sports.find(sport => sport.id === 'baseball')!,
      gameInfo: { teamName: 'A team', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-10-18' } }
    expect(render().openGameSnapshot(state)).toBe(true)
  })
})

describe('Baseball cloud reopen parking handoff', () => {
  function seed() {
    setCurrentAuthUserId('user-1')
    const made = createBaseballEventGameState({ sport: sports.find(sport => sport.id === 'baseball')!,
      setup: baseballSetup(), teamName: 'Falcons', date: '2026-10-18' })
    if (!made.ok) throw Error(made.message)
    const started = startBaseballGame(made.state, { recorderUserId: 'user-1', occurredAt: '2026-10-18T12:00:00Z' })
    if (!started.ok) throw Error(started.message)
    const ended = endBaseballGame(started.state, 'time_limit', { recorderUserId: 'user-1', occurredAt: '2026-10-18T12:01:00Z' })
    if (!ended.ok) throw Error(ended.message)
    const state = { ...ended.state, cloudSync: { ...ended.state.cloudSync, gameId: 'baseball-cloud', gameStatus: 'final' as const, eventCloudPolicy: 'automatic' as const } }
    const id = saveActiveGameState(state, 'user-1')[0].localGameId
    parkActiveGame('user-1')
    return { id, state }
  }
  afterEach(() => resetCurrentAuthUserIdForTests())
  it('persists one matching recorder-owned event and dirty retry metadata', async () => {
    const { id, state } = seed(), api = render()
    const handoff = { sportId: 'baseball' as const, publicationId: 'pub-1', primaryRecorderId: 'user-1',
      reason: 'Correct runner', reopenedAt: '2026-10-18T12:02:00Z' }
    await api.markEventCloudGameReopened('baseball-cloud', handoff)
    const first = getParkedGameRecord(id, 'user-1')!
    expect(first.gameState.eventStream!.events).toHaveLength(state.eventStream!.events.length + 1)
    expect(first.gameState.cloudSync.gameStatus).toBe('in_progress')
    expect(first.sync).toMatchObject({ dirty: true, nextAttemptAt: null })
    await api.markEventCloudGameReopened('baseball-cloud', handoff)
    expect(getParkedGameRecord(id, 'user-1')!.gameState.eventStream!.events).toEqual(first.gameState.eventStream!.events)
  })
  it('a refresh without a receipt changes status only, preserving the ended recording and later sync errors', async () => {
    const { id, state } = seed(), api = render()
    await api.markEventCloudGameReopened('baseball-cloud', null)
    const opened = getParkedGameRecord(id, 'user-1')!
    expect(opened.gameState.eventStream).toEqual(state.eventStream)
    expect(opened.gameState.cloudSync.gameStatus).toBe('in_progress')
    // A later Game Info visit must not acknowledge an unrelated failure.
    const failed = { ...opened.gameState, cloudSync: { ...opened.gameState.cloudSync, status: 'error' as const, lastError: 'Still offline' } }
    saveParkedGameRecordStateAtomically(id, failed, 'user-1', { dirty: true })
    expect(getParkedGameRecord(id, 'user-1')!.gameState.cloudSync.lastError).toBe('Still offline')
    await api.markEventCloudGameReopened('baseball-cloud', null)
    expect(getParkedGameRecord(id, 'user-1')!.gameState.cloudSync.lastError).toBe('Still offline')
  })
  it('persists the binding-only change when this manager is not the primary recorder', async () => {
    const { id, state } = seed()
    await render().markEventCloudGameReopened('baseball-cloud', { sportId: 'baseball', publicationId: 'pub-1',
      primaryRecorderId: 'other-recorder', reason: 'Correct runner', reopenedAt: '2026-10-18T12:02:00Z' })
    const record = getParkedGameRecord(id, 'user-1')!
    expect(record.gameState.cloudSync.gameStatus).toBe('in_progress')
    expect(record.gameState.eventStream).toEqual(state.eventStream)
  })
})

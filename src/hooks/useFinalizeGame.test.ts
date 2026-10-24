import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../types'
import { sports } from '../config/sports'
import { createInitialState } from '../lib/gameReducer'
import { withLastSyncedGameFingerprint } from '../lib/gameSyncFingerprint'
import { useFinalizeGame } from './useFinalizeGame'

const harness = vi.hoisted(() => ({
  state: null as GameState | null, role: 'owner', ref: { current: null as GameState | null },
  dispatch: vi.fn(), flush: vi.fn(), navigate: vi.fn(), clear: vi.fn(), update: vi.fn(),
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: () => harness.ref,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => harness.navigate }))
vi.mock('../context/GameContext', () => ({ useGame: () => ({ state: harness.state, dispatch: harness.dispatch, flushCloudSync: harness.flush }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' }, isConfigured: true }) }))
vi.mock('./useTeamRole', () => ({ useTeamRole: () => ({ role: harness.role }) }))
vi.mock('../lib/gameParking', () => ({ clearActiveParkedGame: (...args: unknown[]) => harness.clear(...args) }))
vi.mock('../lib/gameStorageKeys', () => ({ getPendingSyncFlag: () => false }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ update: (body: unknown) => {
  harness.update(body); return { eq: async () => ({ error: null }) }
} }) } }))

function game(sportId: string): GameState {
  return withLastSyncedGameFingerprint({ ...createInitialState(), sport: sports.find(sport => sport.id === sportId)!,
    gameInfo: { teamName: 'Aces', opponentName: 'Visitors', tournamentName: '', date: '2026-10-24' },
    players: [{ id: 'p', name: 'Pat', number: '1', stats: {} }],
    cloudSync: { ...createInitialState().cloudSync, gameId: 'cloud', teamId: 'team', gameStatus: 'in_progress' } })
}

beforeEach(() => {
  vi.clearAllMocks(); harness.role = 'owner'; harness.state = game('baseball')
  harness.ref.current = harness.state; harness.flush.mockResolvedValue({ ok: true })
})

describe('legacy Baseball raw finalization refusal', () => {
  it.each(['owner', 'admin', 'scorer', 'viewer'])('refuses before sync/write/reset for %s', async role => {
    harness.role = role
    const hook = useFinalizeGame()
    expect(hook.canFinalizeCloudGame).toBe(false)
    await hook.handleFinalizeCloudGame()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.update).not.toHaveBeenCalled()
    expect(harness.clear).not.toHaveBeenCalled()
    expect(harness.dispatch).not.toHaveBeenCalled()
    expect(harness.navigate).not.toHaveBeenCalled()
  })

  it('rejects a stale otherwise-authorized finalize callback after switching to legacy Baseball', async () => {
    harness.state = game('football')
    const previous = useFinalizeGame()
    expect(previous.canFinalizeCloudGame).toBe(true)
    harness.state = game('baseball'); useFinalizeGame()
    await previous.handleFinalizeCloudGame()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.update).not.toHaveBeenCalled()
    expect(harness.clear).not.toHaveBeenCalled()
  })

  it('rechecks retirement after an in-flight flush before a raw write', async () => {
    harness.state = game('football')
    let release!: () => void
    harness.flush.mockImplementation(() => new Promise(resolve => { release = () => resolve({ ok: true }) }))
    const pending = useFinalizeGame().handleFinalizeCloudGame()
    expect(harness.flush).toHaveBeenCalledTimes(1)
    harness.state = game('baseball'); useFinalizeGame(); release(); await pending
    expect(harness.update).not.toHaveBeenCalled()
    expect(harness.clear).not.toHaveBeenCalled()
    expect(harness.dispatch).not.toHaveBeenCalled()
  })

  it('preserves the existing Football aggregate finalization path', async () => {
    harness.state = game('football')
    const hook = useFinalizeGame()
    expect(hook.canFinalizeCloudGame).toBe(true)
    await hook.handleFinalizeCloudGame()
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'final' }))
    expect(harness.clear).toHaveBeenCalledWith('owner')
    expect(harness.dispatch).toHaveBeenCalledWith({ type: 'RESET_GAME' })
    expect(harness.navigate).toHaveBeenCalledWith('/games')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import type { SyncEventGameResult } from '../gameEvents/cloudTransport'
import { aggregateUuid, AGGREGATE_USER } from './aggregateTestFixtures'
import { BASEBALL_PERSONAL_LINK_CAPABILITIES } from './featureClient'
import { createBaseballLinkIntentStore } from './personalLinkIntents'
import { persistBaseballSetupPlayerLinks } from './setupPersonalLinks'
import { baseballSetup, startedGame } from './testFixtures'

const mock = vi.hoisted(() => ({ sync: vi.fn(), rpc: vi.fn() }))
vi.mock('../gameEvents/cloudTransport', async original => ({ ...await original<typeof import('../gameEvents/cloudTransport')>(), syncEventGameToCloud: (...args: unknown[]) => mock.sync(...args) }))
vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mock.rpc(...args) } }))
vi.mock('./releaseCapabilities', () => ({ ensureBaseballReleaseCapabilities: async () => ({ status: 'ready' }) }))
const { BaseballCloudRecoveryError, syncBaseballEventGameToCloud } = await import('./cloudSync')

function fixture() {
  const rows = new Map<string, string>(), storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
  vi.stubGlobal('localStorage', storage)
  const setup = baseballSetup(), state = startedGame(setup), gameId = aggregateUuid(900), target = aggregateUuid(901)
  state.gameInfo = { teamName: 'Home', opponentName: 'Visitors', tournamentName: '', date: '2026-10-23' }
  state.eventStream!.events = state.eventStream!.events.map(event => ({ ...event as object, recorderUserId: AGGREGATE_USER }))
  state.cloudSync.eventCloudPolicy = 'automatic'
  persistBaseballSetupPlayerLinks(AGGREGATE_USER, 'local', setup, [{ playerId: setup.participants[0].playerId!, displayName: 'Chosen', number: null, position: null, personalPlayerId: target }], storage)
  const result: SyncEventGameResult = { seasonId: null, teamId: null, gameId, gameStatus: 'in_progress', playerIdMap: { t1: 'bound-t1' }, syncedAt: '2026-10-23T12:00:00Z', syncedState: structuredClone(state) }
  mock.sync.mockResolvedValue(result)
  mock.rpc.mockImplementation(async (name: string) => ({ error: null, data: name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES : {
    contractVersion: 1, sportId: 'baseball', gameId, mapFingerprint: 'a'.repeat(32), activePublicationId: null,
    participantSourceMap: Object.fromEntries(setup.participants.map((p, i) => [p.id, i === 0 ? target : null])),
  } }))
  return { state, gameId, storage, rows, input: { state, userId: AGGREGATE_USER, localGameId: 'local' } }
}
beforeEach(() => { setCurrentAuthUserId(AGGREGATE_USER); mock.sync.mockReset(); mock.rpc.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); resetCurrentAuthUserIdForTests() })
describe('Baseball first-upload setup links', () => {
  it('applies the returned binding before reviewing personal links on the very first sync', async () => {
    const f = fixture()
    expect(f.state.cloudSync.gameId).toBeNull()
    const synced = await syncBaseballEventGameToCloud(f.input)
    expect(mock.rpc).toHaveBeenCalledWith('get_baseball_personal_participant_links', { p_game_id: f.gameId })
    expect(createBaseballLinkIntentStore(f.storage).read(AGGREGATE_USER, 'local', 't1')).toBeNull()
    expect(synced.syncedState.cloudSync).toMatchObject({ gameId: f.gameId, playerIdMap: { t1: 'bound-t1' } })
    expect(f.state.cloudSync.gameId).toBeNull()
  })
  it('preserves the new binding, checkpoint and intent when link review fails after upload', async () => {
    const f = fixture(); mock.rpc.mockRejectedValue(Error('Offline'))
    try { await syncBaseballEventGameToCloud(f.input); throw Error('Expected recovery') } catch (error) {
      expect(error).toBeInstanceOf(BaseballCloudRecoveryError)
      const recovered = (error as InstanceType<typeof BaseballCloudRecoveryError>).recoveredState
      expect(recovered.cloudSync).toMatchObject({ gameId: f.gameId, playerIdMap: { t1: 'bound-t1' } })
      expect(recovered.eventStream).toEqual(f.state.eventStream)
      expect(createBaseballLinkIntentStore(f.storage).read(AGGREGATE_USER, 'local', 't1')).not.toBeNull()
    }
  })
  it('does not attempt link work if the raw upload itself fails', async () => {
    const f = fixture(); mock.sync.mockRejectedValue(Error('Upload refused'))
    await expect(syncBaseballEventGameToCloud(f.input)).rejects.toThrow('Upload refused')
    expect(mock.rpc).not.toHaveBeenCalled(); expect(f.rows.size).toBe(1)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { commitGameSetupState, getActiveLocalGameId, saveActiveGameState } from '../gameParking'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { createInitialState, gameReducer } from '../gameReducer'
import { aggregateUuid, AGGREGATE_USER } from './aggregateTestFixtures'
import { BASEBALL_PERSONAL_LINK_CAPABILITIES } from './featureClient'
import { createBaseballLinkIntentStore } from './personalLinkIntents'
import { createBaseballEventGameState, type BaseballSetupRosterPlayer } from './setupBuilder'
import { persistBaseballSetupPlayerLinks, syncBaseballSetupPlayerLinks } from './setupPersonalLinks'
import { baseballSetup, startedGame } from './testFixtures'

function fixture() {
  const rows = new Map<string, string>()
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) }, clear: () => rows.clear() }
  vi.stubGlobal('localStorage', storage)
  const setup = baseballSetup()
  const roster: BaseballSetupRosterPlayer[] = setup.participants.map((row, i) => ({ playerId: row.playerId!, displayName: row.displayName, number: row.number, position: row.position, ...(i < 2 ? { personalPlayerId: aggregateUuid(101 + i) } : {}) }))
  const state = startedGame(setup)
  state.cloudSync.gameId = aggregateUuid(500)
  const map: Record<string, string | null> = Object.fromEntries(setup.participants.map(p => [p.id, null]))
  const receipts = new Map<string, unknown>()
  let publication: string | null = null, lost = false, hold: (() => Promise<void>) | null = null
  let fingerprint = 'a'.repeat(32)
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (hold) { const pause = hold; hold = null; await pause() }
    if (name.includes('capabilities')) return { data: BASEBALL_PERSONAL_LINK_CAPABILITIES, error: null }
    if (name === 'get_baseball_personal_participant_links') return { data: { contractVersion: 1, sportId: 'baseball', gameId: state.cloudSync.gameId, participantSourceMap: { ...map }, mapFingerprint: fingerprint, activePublicationId: publication }, error: null }
    if (name !== 'link_baseball_personal_participant') throw Error('Unexpected RPC')
    const operation = String(args!.p_operation_id)
    if (receipts.has(operation)) return { data: receipts.get(operation), error: null }
    expect(args!.p_expected_map_fingerprint).toBe(fingerprint)
    map[String(args!.p_client_participant_id)] = String(args!.p_target_player_id)
    fingerprint = (Object.values(map).filter(Boolean).length === 1 ? 'b' : 'c').repeat(32)
    const receipt = { contractVersion: 1, gameId: state.cloudSync.gameId, operationId: operation, participantId: args!.p_client_participant_id, targetPlayerId: args!.p_target_player_id, participantSourceMap: { ...map }, mapFingerprint: fingerprint, reopen: null }
    receipts.set(operation, receipt)
    if (lost) { lost = false; throw Error('Lost response') }
    return { data: receipt, error: null }
  })
  const sync = () => syncBaseballSetupPlayerLinks({ state, userId: AGGREGATE_USER, localGameId: 'local', assertCurrent: () => {} }, storage, { client: { rpc } })
  return { storage, rows, setup, roster, state, map, rpc, sync, receipts,
    final: () => { publication = aggregateUuid(600) }, lose: () => { lost = true },
    hold: () => { let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve }); hold = () => gate; return release },
    persist: () => persistBaseballSetupPlayerLinks(AGGREGATE_USER, 'local', setup, roster, storage),
  }
}
beforeEach(() => setCurrentAuthUserId(AGGREGATE_USER))
afterEach(() => { resetCurrentAuthUserIdForTests(); vi.unstubAllGlobals() })

describe('Baseball setup choices and post-bind links', () => {
  it('persists only explicitly selected My Players, not UUID-looking local identities', () => {
    const f = fixture(); f.roster[2].playerId = aggregateUuid(900); f.setup.participants[2].playerId = f.roster[2].playerId
    const before = JSON.stringify(f.setup)
    f.persist()
    expect(f.rows.size).toBe(2)
    expect(JSON.stringify(f.setup)).toBe(before)
    const intent = createBaseballLinkIntentStore(f.storage).read(AGGREGATE_USER, 'local', 't1')
    expect(intent).toMatchObject({ targetPlayerId: aggregateUuid(101), reviewed: null, revision: 1 })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('ignores team games and refuses duplicate personal targets before writing', () => {
    const f = fixture(); f.setup.sourceTeamId = aggregateUuid(700); f.persist(); expect(f.rows.size).toBe(0)
    f.setup.sourceTeamId = null; f.roster[1].personalPlayerId = f.roster[0].personalPlayerId
    expect(f.persist).toThrow('only appear once'); expect(f.rows.size).toBe(0)
  })
  it('restores every intent key when a later storage write fails', () => {
    const f = fixture(), original = f.storage.setItem
    let calls = 0
    f.storage.setItem = (key, value) => { if (++calls === 2) throw Error('Quota'); original(key, value) }
    expect(f.persist).toThrow('Quota'); expect(f.rows.size).toBe(0)
  })
  it('rolls parking and the active mirror back when intent persistence fails', () => {
    const f = fixture(); const previous = createInitialState(); previous.sport = sports[0]; previous.gameInfo = { teamName: 'Existing', opponentName: 'Keep', tournamentName: '', date: '2026-10-23' }
    saveActiveGameState(previous, AGGREGATE_USER)
    const before = [...f.rows], active = getActiveLocalGameId(AGGREGATE_USER)
    const original = f.storage.setItem
    f.storage.setItem = (key, value) => { if (key.startsWith('statkeeper_baseball_link_intent:')) throw Error('Quota'); original(key, value) }
    expect(() => commitGameSetupState(previous, f.state, AGGREGATE_USER, null, false, localId => persistBaseballSetupPlayerLinks(AGGREGATE_USER, localId, f.setup, f.roster, f.storage))).toThrow('Quota')
    expect(getActiveLocalGameId(AGGREGATE_USER)).toBe(active)
    expect([...f.rows].sort()).toEqual(before.sort())
  })
  it('creates one slot with durable intents in the same successful commit', () => {
    const f = fixture()
    const result = commitGameSetupState(createInitialState(), f.state, AGGREGATE_USER, null, false, localId => persistBaseballSetupPlayerLinks(AGGREGATE_USER, localId, f.setup, f.roster, f.storage))
    expect(getActiveLocalGameId(AGGREGATE_USER)).toBe(result.localGameId)
    expect(createBaseballLinkIntentStore(f.storage).read(AGGREGATE_USER, result.localGameId, 't1')?.reviewed).toBeNull()
  })
  it('does not send a request for unlinked or unbound games', async () => {
    const f = fixture(); await f.sync(); expect(f.rpc).not.toHaveBeenCalled()
    f.persist(); f.state.cloudSync.gameId = null; await f.sync(); expect(f.rpc).not.toHaveBeenCalled()
  })
  it('links sequentially using fresh maps after binding without changing setup, events or fingerprints', async () => {
    const f = fixture(); f.persist()
    const before = buildGameSyncFingerprint(f.state)
    await f.sync()
    expect(f.map.t1).toBe(aggregateUuid(101)); expect(f.map.t2).toBe(aggregateUuid(102))
    expect(f.rows.size).toBe(0)
    expect(buildGameSyncFingerprint(f.state)).toBe(before)
    expect(f.rpc.mock.calls.filter(([name]) => name === 'link_baseball_personal_participant')).toHaveLength(2)
  })
  it('retains an uncertain operation and settles it only after a fresh confirmed server map', async () => {
    const f = fixture(); f.persist(); f.lose()
    await expect(f.sync()).rejects.toThrow('Retry when online')
    const first = createBaseballLinkIntentStore(f.storage).read(AGGREGATE_USER, 'local', 't1')!
    expect(first.reviewed?.expectedPublicationId).toBeNull()
    await f.sync()
    const attempts = f.rpc.mock.calls.filter(([name]) => name === 'link_baseball_personal_participant')
    expect(attempts.filter(([, args]) => args!.p_client_participant_id === 't1')).toHaveLength(1)
    expect(f.rows.size).toBe(0)
  })
  it('acknowledges an already confirmed target without another write', async () => {
    const f = fixture(); f.persist(); f.map.t1 = aggregateUuid(101); f.map.t2 = aggregateUuid(102)
    await f.sync(); expect(f.rows.size).toBe(0)
    expect(f.rpc.mock.calls.some(([name]) => name === 'link_baseball_personal_participant')).toBe(false)
  })
  it('never automatically reopens a published result to drain a setup selection', async () => {
    const f = fixture(); f.persist(); f.final()
    await expect(f.sync()).rejects.toThrow('published result')
    expect(f.rows.size).toBe(2)
    expect(f.rpc.mock.calls.some(([name]) => name === 'link_baseball_personal_participant')).toBe(false)
  })
  it('does not overwrite an existing different player link', async () => {
    const f = fixture(); f.persist(); f.map.t1 = aggregateUuid(999)
    await expect(f.sync()).rejects.toThrow('cannot be replaced')
    expect(f.rows.size).toBe(2)
  })
  it('refuses late A -> B -> A results and retains the original account intent', async () => {
    const f = fixture(); f.persist(); const release = f.hold(); const pending = f.sync()
    setCurrentAuthUserId(aggregateUuid(22)); setCurrentAuthUserId(AGGREGATE_USER); release()
    await expect(pending).rejects.toThrow('account changed')
    expect(f.rows.size).toBe(2)
    expect(f.rpc).toHaveBeenCalledTimes(1)
  })
  it('refuses a reviewed intent for another binding or participant set before requesting or acknowledging', async () => {
    const f = fixture(); f.persist()
    const store = createBaseballLinkIntentStore(f.storage), previous = store.read(AGGREGATE_USER, 'local', 't1')!
    const reviewed = { gameId: aggregateUuid(999), expectedMapFingerprint: 'a'.repeat(32), expectedPublicationId: null, reason: '', participantIds: f.setup.participants.map(row => row.id) }
    store.save({ ...previous, revision: 2, operationId: aggregateUuid(800), reviewed }, 1)
    f.map.t1 = aggregateUuid(101)
    await expect(f.sync()).rejects.toThrow('pending player link')
    const next = store.read(AGGREGATE_USER, 'local', 't1')!
    store.save({ ...next, revision: 3, operationId: aggregateUuid(801), reviewed: { ...reviewed, gameId: f.state.cloudSync.gameId!, participantIds: ['t1'] } }, 2)
    await expect(f.sync()).rejects.toThrow('pending player link')
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.rows.size).toBe(2)
  })
  it('allows explicit cancellation of one pending device request without changing any recorded facts', async () => {
    const f = fixture(); f.persist(); const before = buildGameSyncFingerprint(f.state)
    const store = createBaseballLinkIntentStore(f.storage), intent = store.read(AGGREGATE_USER, 'local', 't1')!
    expect(store.discard(intent)).toBe(true)
    expect(store.discard(intent)).toBe(false)
    expect(store.read(AGGREGATE_USER, 'local', 't2')).not.toBeNull()
    await f.sync()
    expect(f.map.t1).toBeNull(); expect(f.map.t2).toBe(aggregateUuid(102))
    expect(buildGameSyncFingerprint(f.state)).toBe(before)
  })
  it('never automatically retries a manual version-1 reviewed request', async () => {
    const f = fixture(); f.persist(); const store = createBaseballLinkIntentStore(f.storage)
    for (const participantId of ['t1', 't2']) {
      const previous = store.read(AGGREGATE_USER, 'local', participantId)!
      store.discard(previous)
      const manual = { ...previous, version: 1 as const }
      delete manual.origin
      store.save(manual, null)
    }
    await f.sync()
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.rows.size).toBe(2)
  })
})

describe('Baseball device capture defaults', () => {
  it('seeds only a new game and remains outside historical gameplay fingerprints through reload', () => {
    fixture()
    const setup = baseballSetup(), input = { sport: sports.find(s => s.id === 'baseball')!, setup, teamName: 'Aces', date: '2026-10-23' }
    const a = createBaseballEventGameState(input), b = createBaseballEventGameState({ ...input, captureDefaults: { trackPitchLocation: false, trackBattedBallLocation: false } })
    if (!a.ok || !b.ok) throw Error('Invalid fixture')
    expect(a.state.sportGameState?.sportId === 'baseball' && a.state.sportGameState.capturePreferences.trackPitchLocation).toBe(true)
    expect(b.state.sportGameState?.sportId === 'baseball' && b.state.sportGameState.capturePreferences.trackPitchLocation).toBe(false)
    expect(buildGameSyncFingerprint(a.state)).toBe(buildGameSyncFingerprint(b.state))
    const reload = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(b.state)) })
    expect(reload.sportGameState?.sportId === 'baseball' && reload.sportGameState.capturePreferences.trackBattedBallLocation).toBe(false)
    expect(setup).toEqual(input.setup)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { eventRevisionCheckpoint, eventStreamFingerprint } from '../gameEvents/cloudTransport'
import { AGGREGATE_PLAYER, AGGREGATE_USER, aggregateUuid, finishedAggregateState, MAP_FINGERPRINT } from './aggregateTestFixtures'
import { BASEBALL_PERSONAL_LINK_CAPABILITIES, type BaseballRpcResponse } from './featureClient'
import { createBaseballPersonalIdentityClient, parseBaseballPersonalLinkReview } from './personalIdentity'
import { createBaseballLinkIntentStore, type BaseballPersonalLinkIntent } from './personalLinkIntents'

const gameId = aggregateUuid(1001)
const publication = aggregateUuid(2001)
const operation = aggregateUuid(3001)
const participantIds = ['t1', 't2']
const linkedMap = { t1: AGGREGATE_PLAYER, t2: null }
const savedFingerprint = 'b'.repeat(32)
const ok = (data: unknown): BaseballRpcResponse => ({ data, error: null })
const review = (map = linkedMap, fingerprint = savedFingerprint, activePublicationId: string | null = null) => ({
  contractVersion: 1, sportId: 'baseball', gameId, participantSourceMap: map, mapFingerprint: fingerprint, activePublicationId,
})
function intent(): BaseballPersonalLinkIntent {
  return { version: 1, userId: AGGREGATE_USER, localGameId: 'local-one', participantId: 't1', targetPlayerId: AGGREGATE_PLAYER,
    operationId: operation, revision: 1, reviewed: { gameId, expectedMapFingerprint: MAP_FINGERPRINT,
      expectedPublicationId: null, reason: '', participantIds: [...participantIds] } }
}
function receipt(value = intent(), reopen: unknown = null) {
  return { contractVersion: 1, gameId, operationId: value.operationId, participantId: value.participantId,
    targetPlayerId: value.targetPlayerId, participantSourceMap: linkedMap, mapFingerprint: savedFingerprint, reopen }
}
function storage() {
  const values = new Map<string, string>()
  return { values, getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }), removeItem: vi.fn((key: string) => { values.delete(key) }) }
}
const deferred = () => {
  let resolve!: (response: BaseballRpcResponse) => void
  const promise = new Promise<BaseballRpcResponse>(r => { resolve = r })
  return { promise, resolve }
}
function setup(value = intent(), response = receipt(value)) {
  const local = storage()
  const store = createBaseballLinkIntentStore(local)
  store.save(value, null)
  const rpc = vi.fn(async (name: string) => ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES
    : name === 'link_baseball_personal_participant' ? response : review()))
  const client = createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } })
  return { local, store, rpc, client, value }
}
beforeEach(() => setCurrentAuthUserId(AGGREGATE_USER))
afterEach(resetCurrentAuthUserIdForTests)

describe('BSB-7A checked online personal identity', () => {
  it('reviews exact canonical participant IDs including explicit null without storage writes', async () => {
    const rpc = vi.fn(async (name: string) => ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES : review()))
    const result = await createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } }).review(gameId, participantIds)
    expect(result.participantSourceMap).toEqual(linkedMap)
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['get_baseball_personal_link_capabilities', 'get_baseball_personal_participant_links'])
    for (const invalid of [{ ...review(), extra: true }, { ...review(), gameId: publication },
      { ...review(), participantSourceMap: { t1: AGGREGATE_PLAYER } },
      { ...review(), participantSourceMap: { ...linkedMap, alias: null } },
      { ...review(), participantSourceMap: { t1: 'not-a-cloud-player', t2: null } }]) {
      expect(() => parseBaseballPersonalLinkReview(invalid, gameId, participantIds)).toThrow()
    }
  })
  it('dispatches only a durably persisted exact request and reconciles before acknowledgement', async () => {
    const { client, store, local, rpc, value } = setup()
    const result = await client.link(value, store)
    expect(result.acknowledged).toBe(true)
    expect(result.receipt.lifecycleAuthority).toBe('unverified')
    expect(local.removeItem).toHaveBeenCalledOnce()
    expect(store.read(AGGREGATE_USER, value.localGameId, value.participantId)).toBeNull()
    expect(rpc).toHaveBeenNthCalledWith(2, 'link_baseball_personal_participant', {
      p_game_id: gameId, p_client_participant_id: 't1', p_target_player_id: AGGREGATE_PLAYER,
      p_expected_map_fingerprint: MAP_FINGERPRINT, p_expected_publication_id: null, p_reason: '', p_operation_id: operation,
    })
    expect(rpc).toHaveBeenNthCalledWith(3, 'get_baseball_personal_participant_links', { p_game_id: gameId })
  })
  it('settles a lost-reply retry after another participant link changes the current map', async () => {
    const first = intent()
    const local = storage()
    const store = createBaseballLinkIntentStore(local)
    store.save(first, null)
    const currentMap: Record<string, string | null> = { t1: null, t2: null }
    let currentFingerprint = MAP_FINGERPRINT
    const receipts = new Map<string, { request: Record<string, unknown>; response: Record<string, unknown> }>()
    const rpc = vi.fn(async (name: string, parameters?: Record<string, unknown>) => {
      if (name === 'get_baseball_personal_link_capabilities') return ok(BASEBALL_PERSONAL_LINK_CAPABILITIES)
      if (name === 'get_baseball_personal_participant_links') return ok({
        ...review(), participantSourceMap: { ...currentMap }, mapFingerprint: currentFingerprint,
      })
      expect(name).toBe('link_baseball_personal_participant')
      const request = parameters!
      const operationId = request.p_operation_id as string
      const previous = receipts.get(operationId)
      if (previous) {
        expect(request).toEqual(previous.request)
        return ok(structuredClone(previous.response))
      }
      expect(request.p_expected_map_fingerprint).toBe(currentFingerprint)
      expect(request.p_expected_publication_id).toBeNull()
      currentMap[request.p_client_participant_id as string] = request.p_target_player_id as string
      currentFingerprint = operationId === first.operationId ? savedFingerprint : 'c'.repeat(32)
      const response = {
        contractVersion: 1, gameId, operationId, participantId: request.p_client_participant_id,
        targetPlayerId: request.p_target_player_id, participantSourceMap: { ...currentMap },
        mapFingerprint: currentFingerprint, reopen: null,
      }
      receipts.set(operationId, { request: structuredClone(request), response })
      if (operationId === first.operationId) throw new Error('Network error after server commit')
      return ok(response)
    })
    const client = createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } })
    await expect(client.link(first, store)).rejects.toMatchObject({ code: 'transport' })
    expect(store.matches(first)).toBe(true)
    expect(currentMap.t1).toBe(first.targetPlayerId)

    const second: BaseballPersonalLinkIntent = {
      ...intent(), participantId: 't2', targetPlayerId: aggregateUuid(102), operationId: aggregateUuid(3002),
      reviewed: { ...first.reviewed!, expectedMapFingerprint: savedFingerprint },
    }
    store.save(second, null)
    expect((await client.link(second, store)).acknowledged).toBe(true)
    expect(store.matches(first)).toBe(true)

    const retried = await client.link(first, store)
    expect(retried.receipt.participantSourceMap.t2).toBeNull()
    expect(retried.currentReview.participantSourceMap.t2).toBe(second.targetPlayerId)
    expect(retried.currentReview.mapFingerprint).not.toBe(retried.receipt.mapFingerprint)
    expect(retried.receipt.lifecycleAuthority).toBe('unverified')
    expect(retried.acknowledged).toBe(true)
    expect(store.read(first.userId, first.localGameId, first.participantId)).toBeNull()
    expect(store.read(second.userId, second.localGameId, second.participantId)).toBeNull()
    const writes = rpc.mock.calls.filter(([name]) => name === 'link_baseball_personal_participant')
    expect(writes).toHaveLength(3)
    expect(writes[2][1]).toEqual(writes[0][1])
  })
  it.each([aggregateUuid(2002), null])('never grants lifecycle authority to a historical P1 receipt after P2 republish/reopen (active %s)', async active => {
    const value = intent(); value.reviewed!.expectedPublicationId = publication; value.reviewed!.reason = 'Link the reviewed player'
    const historical = { game_id: gameId, publication_id: publication, reopened_at: '2026-10-20T12:00:00Z' }
    const { client, store, rpc } = setup(value, receipt(value, historical))
    rpc.mockImplementation(async name => ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES
      : name === 'link_baseball_personal_participant' ? receipt(value, historical) : review(linkedMap, savedFingerprint, active)))
    const result = await client.link(value, store)
    expect(result.receipt).toMatchObject({ lifecycleAuthority: 'unverified', historicalReopen: { publicationId: publication } })
    expect(result.receipt).not.toHaveProperty('reopen')
    expect(result.receipt).not.toHaveProperty('primaryRecorderId')
    expect(rpc.mock.calls.some(([name]) => /reopen|finalize/.test(name))).toBe(false)
  })
  it('retains intent when the current server target for this participant differs from the receipt', async () => {
    const { client, store, value, rpc, local } = setup()
    rpc.mockImplementation(async name => ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES
      : name === 'link_baseball_personal_participant' ? receipt(value) : review({ t1: aggregateUuid(901), t2: null }, 'c'.repeat(32))))
    const result = await client.link(value, store)
    expect(result.acknowledged).toBe(false)
    expect(store.matches(value)).toBe(true)
    expect(local.removeItem).not.toHaveBeenCalled()
  })
  it.each(['capability', 'write', 'reconcile'] as const)('retains intent after %s network failure and retries the original UUID/payload', async stage => {
    const { store, value, local } = setup()
    const rpc = vi.fn(async (name: string) => {
      if ((stage === 'capability' && name.includes('capabilities')) || (stage === 'write' && name === 'link_baseball_personal_participant')
        || (stage === 'reconcile' && name === 'get_baseball_personal_participant_links')) throw new Error('Network error')
      return ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES : receipt(value))
    })
    const client = createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } })
    await expect(client.link(value, store)).rejects.toMatchObject({ code: 'transport' })
    expect(store.matches(value)).toBe(true); expect(local.removeItem).not.toHaveBeenCalled()
    rpc.mockImplementation(async name => ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES
      : name === 'link_baseball_personal_participant' ? receipt(value) : review()))
    expect((await client.link(value, store)).acknowledged).toBe(true)
    expect(rpc).toHaveBeenCalledWith('link_baseball_personal_participant', expect.objectContaining({ p_operation_id: operation, p_expected_map_fingerprint: MAP_FINGERPRINT }))
  })
  it('retains selected links on a 078-only backend without release/legacy fallback', async () => {
    const { store, value, local } = setup()
    const rpc = vi.fn(async () => ok({ contractVersion: 0 }))
    await expect(createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } }).link(value, store)).rejects.toMatchObject({ code: 'backend_update_required' })
    expect(store.matches(value)).toBe(true); expect(local.removeItem).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['capability', 'write', 'reconcile'] as const)('rejects an auth A -> B -> A at %s await without acknowledging', async stage => {
    const { store, value, local } = setup()
    const pending = deferred()
    let reached!: () => void
    const atStage = new Promise<void>(r => { reached = r })
    const rpc = vi.fn((name: string) => {
      if ((stage === 'capability' && name.includes('capabilities')) || (stage === 'write' && name === 'link_baseball_personal_participant')
        || (stage === 'reconcile' && name === 'get_baseball_personal_participant_links')) { reached(); return pending.promise }
      return Promise.resolve(ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES : receipt(value)))
    })
    const task = createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } }).link(value, store)
    await atStage
    setCurrentAuthUserId('B'); setCurrentAuthUserId(AGGREGATE_USER)
    pending.resolve(ok(stage === 'capability' ? BASEBALL_PERSONAL_LINK_CAPABILITIES : stage === 'write' ? receipt(value) : review()))
    await expect(task).rejects.toMatchObject({ code: 'stale_account' })
    expect(store.matches(value)).toBe(true); expect(local.removeItem).not.toHaveBeenCalled()
  })
  it('does not acknowledge or overwrite a newer participant intent while a write is pending', async () => {
    const { store, value, local } = setup()
    const pending = deferred(); let dispatched!: () => void; const sent = new Promise<void>(r => { dispatched = r })
    const rpc = vi.fn((name: string) => {
      if (name.includes('capabilities')) return Promise.resolve(ok(BASEBALL_PERSONAL_LINK_CAPABILITIES))
      dispatched(); return pending.promise
    })
    const task = createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } }).link(value, store)
    await sent
    const replacement = { ...value, revision: 2, operationId: aggregateUuid(3002), targetPlayerId: aggregateUuid(102) }
    store.save(replacement, 1)
    pending.resolve(ok(receipt(value)))
    await expect(task).rejects.toMatchObject({ code: 'conflict' })
    expect(store.matches(replacement)).toBe(true); expect(local.removeItem).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('treats abort after dispatch as uncertain and retains the intent', async () => {
    const { store, value, local } = setup()
    const controller = new AbortController()
    const rpc = vi.fn(async (name: string) => {
      if (name.includes('capabilities')) return ok(BASEBALL_PERSONAL_LINK_CAPABILITIES)
      controller.abort(); return ok(receipt(value))
    })
    await expect(createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc }, signal: controller.signal }).link(value, store)).rejects.toMatchObject({ code: 'aborted' })
    expect(store.matches(value)).toBe(true); expect(local.removeItem).not.toHaveBeenCalled()
  })
  it.each(['operationId', 'targetPlayerId', 'participantId', 'gameId'] as const)('rejects mismatched receipt %s without clearing intent', async key => {
    const value = intent(); const bad = { ...receipt(value), [key]: key === 'participantId' ? 't2' : aggregateUuid(899) }
    const { client, store, local } = setup(value, bad)
    await expect(client.link(value, store)).rejects.toMatchObject({ code: 'invalid_response' })
    expect(local.removeItem).not.toHaveBeenCalled()
  })
  it('does not dispatch an unpersisted or unreviewed intent', async () => {
    const { client, store, value, rpc } = setup()
    await expect(client.link({ ...value, revision: 2 }, store)).rejects.toMatchObject({ code: 'conflict' })
    await expect(client.link({ ...value, reviewed: null }, store)).rejects.toMatchObject({ code: 'invalid_response' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('BSB-7A persisted-intent boundaries', () => {
  it('isolates accounts, local games and participants, with revision/operation CAS', () => {
    const { store, value } = setup()
    expect(store.read(AGGREGATE_USER, 'other-game', 't1')).toBeNull()
    expect(store.read(AGGREGATE_USER, value.localGameId, 't2')).toBeNull()
    expect(() => store.save({ ...value, revision: 2, targetPlayerId: aggregateUuid(103) }, 1)).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(() => store.save({ ...value, operationId: aggregateUuid(3002), revision: 2 }, null)).toThrow(expect.objectContaining({ code: 'conflict' }))
    setCurrentAuthUserId(aggregateUuid(2))
    expect(() => store.read(AGGREGATE_USER, value.localGameId, 't1')).toThrow(expect.objectContaining({ code: 'stale_account' }))
    expect(store.read(aggregateUuid(2), value.localGameId, 't1')).toBeNull()
  })
  it('preserves pending data on corrupt storage and persistence/remove failures', async () => {
    const { store, local, value, client, rpc } = setup()
    local.removeItem.mockImplementation(() => { throw new Error('Storage unavailable') })
    await expect(client.link(value, store)).rejects.toThrow('Storage unavailable')
    expect(store.matches(value)).toBe(true)
    const contents = [...local.values.values()][0]
    local.setItem.mockImplementation(() => { throw new Error('Quota') })
    expect(() => store.save({ ...value, revision: 2, operationId: aggregateUuid(3002) }, 1)).toThrow('Quota')
    expect([...local.values.values()][0]).toBe(contents)
    local.getItem.mockReturnValue('{broken')
    rpc.mockClear()
    await expect(client.link(value, store)).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('BSB-7A reviewed-map finalization', () => {
  function input() {
    const state = finishedAggregateState()
    state.cloudSync.gameId = gameId
    const ids = state.sportGameState!.setup.participants.map(p => p.id)
    const reviewed = parseBaseballPersonalLinkReview({ ...review(), participantSourceMap: Object.fromEntries(ids.map(id => [id, null])) }, gameId, ids)
    return { state, review: reviewed, assertReviewCurrent: vi.fn() }
  }
  it('sends the exact checkpoint/snapshot and reviewed fingerprint to only the new fixed wrapper', async () => {
    const request = input()
    const rpc = vi.fn(async (name: string) => ok(name.includes('capabilities') ? BASEBALL_PERSONAL_LINK_CAPABILITIES : {
      publication_id: publication, publication_number: 2, primary_recorded_by: AGGREGATE_USER, finalized_at: '2026-10-20T12:00:00Z',
    }))
    const result = await createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } }).finalizeReviewed(request)
    expect(result.publicationId).toBe(publication)
    expect(rpc).toHaveBeenLastCalledWith('finalize_baseball_event_game_reviewed', expect.objectContaining({
      p_expected_map_fingerprint: savedFingerprint, p_event_revisions: eventRevisionCheckpoint(request.state),
      p_stream_fingerprint: eventStreamFingerprint(request.state), p_primary_recorded_by: AGGREGATE_USER,
    }))
    expect(request.assertReviewCurrent).toHaveBeenCalledTimes(3)
  })
  it('withholds writes when the local review lifetime changes during capability lookup', async () => {
    const request = input(); let current = true
    request.assertReviewCurrent.mockImplementation(() => { if (!current) throw new Error('Review changed') })
    const rpc = vi.fn(async () => { current = false; return ok(BASEBALL_PERSONAL_LINK_CAPABILITIES) })
    await expect(createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } }).finalizeReviewed(request)).rejects.toThrow('Review changed')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('withholds finalization acknowledgement after auth A -> B -> A during the write', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name.includes('capabilities')) return ok(BASEBALL_PERSONAL_LINK_CAPABILITIES)
      setCurrentAuthUserId('B'); setCurrentAuthUserId(AGGREGATE_USER)
      return ok({ publication_id: publication, publication_number: 1, primary_recorded_by: AGGREGATE_USER, finalized_at: '2026-10-20T12:00:00Z' })
    })
    await expect(createBaseballPersonalIdentityClient(AGGREGATE_USER, { client: { rpc } }).finalizeReviewed(input())).rejects.toMatchObject({ code: 'stale_account' })
  })
})

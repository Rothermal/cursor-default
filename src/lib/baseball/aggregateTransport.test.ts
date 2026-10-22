import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { loadBaseballAggregates, parseBaseballAggregateSource } from './aggregateTransport'
import { BASEBALL_AGGREGATE_CAPABILITIES, type BaseballRpcResponse } from './featureClient'
import { AGGREGATE_PLAYER, AGGREGATE_TEAM, AGGREGATE_USER, aggregateUuid, baseballAggregateSource, finishedAggregateState } from './aggregateTestFixtures'
import { baseballSetup, startedGame } from './testFixtures'
import type { BaseballCanonicalAggregateSource } from './aggregateTypes'
import { allocateBaseballRefreshGeneration } from '../../hooks/useBaseballAggregateDestination'

const scope = { type: 'career' as const, playerId: AGGREGATE_PLAYER }
const options = { userId: AGGREGATE_USER, variant: 'baseball' as const }
const ok = (data: unknown): BaseballRpcResponse => ({ data, error: null })
const page = (items: unknown[], more = false) => ({ items, nextCursor: more ? {
  finalizedAt: (items[items.length - 1] as BaseballCanonicalAggregateSource).finalizedAt,
  publicationId: (items[items.length - 1] as BaseballCanonicalAggregateSource).publicationId,
} : null })
function rpcPages(pages: unknown[]) {
  let next = 0
  return vi.fn(async (name: string) => ok(name === 'get_baseball_aggregate_capabilities' ? BASEBALL_AGGREGATE_CAPABILITIES : pages[next++]))
}
const deferred = () => {
  let resolve!: (data: BaseballRpcResponse) => void
  const promise = new Promise<BaseballRpcResponse>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => setCurrentAuthUserId(AGGREGATE_USER))
afterEach(resetCurrentAuthUserIdForTests)

describe('BSB-7A complete canonical paging', () => {
  it('drains every page through other variants and forwards the paired keyset', async () => {
    const first = baseballAggregateSource(finishedAggregateState(startedGame(baseballSetup({ profile: 'nfhs_softball_fastpitch' }))))
    const second = baseballAggregateSource(undefined, 2)
    const rpc = rpcPages([page([first], true), page([second])])
    const result = await loadBaseballAggregates(scope, { ...options, client: { rpc }, pageSize: 1 })
    expect(result.aggregate.games).toHaveLength(1)
    expect(result.aggregate.filteredVariantCount).toBe(1)
    expect(result.metrics).toMatchObject({ pageCount: 2, sourceCount: 2, payloadBytes: 1000 })
    expect(rpc).toHaveBeenLastCalledWith('get_baseball_player_aggregate_publications', expect.objectContaining({
      p_before_finalized_at: first.finalizedAt, p_before_publication_id: first.publicationId, p_limit: 1, p_player_id: AGGREGATE_PLAYER,
    }))
  })
  it('isolates malformed/invalid sources while preserving valid peers and null links', async () => {
    const valid = baseballAggregateSource()
    valid.participantSourceMap!.t2 = null
    const invalid = baseballAggregateSource(undefined, 2)
    invalid.identityStatus = 'invalid'; invalid.identityDiagnostic = 'missing_pin'; invalid.participantSourceMap = null; invalid.participantMapFingerprint = null
    const malformed = { ...baseballAggregateSource(undefined, 3), canonicalSnapshot: {} }
    const rpc = rpcPages([page([valid, invalid, malformed])])
    const result = await loadBaseballAggregates(scope, { ...options, client: { rpc } })
    expect(result.aggregate.games).toHaveLength(1)
    expect(result.aggregate.exclusions).toHaveLength(2)
    expect(result.aggregate.unlinkedAppearances).toBe(1)
    expect(result.aggregate.quality).toBe('partial')
  })
  it.each(['map', 'pin', 'snapshot', 'publication'] as const)('quarantines %s collisions in either arrival order', async field => {
    const first = baseballAggregateSource()
    const second = structuredClone(first)
    if (field === 'map') second.participantSourceMap!.t2 = null
    if (field === 'pin') second.participantMapFingerprint = 'b'.repeat(32)
    if (field === 'snapshot') second.snapshotFingerprint = 'changed'
    if (field === 'publication') second.publicationId = aggregateUuid(8000)
    for (const sources of [[first, second], [second, first]]) {
      const result = await loadBaseballAggregates(scope, { ...options, client: { rpc: rpcPages([page(sources)]) } })
      expect(result.aggregate.games).toHaveLength(0)
      expect(result.aggregate.quality).toBe('partial')
    }
  })
  it('deduplicates exact repeated sources and detects the same publication assigned to different games', async () => {
    const first = baseballAggregateSource()
    const run = (items: unknown[]) => loadBaseballAggregates(scope, { ...options, client: { rpc: rpcPages([page(items)]) } })
    expect((await run([first, structuredClone(first)])).aggregate.games).toHaveLength(1)
    const second = baseballAggregateSource(undefined, 2); second.publicationId = first.publicationId
    expect((await run([first, second])).aggregate.games).toHaveLength(0)
  })
  it('requires exact envelopes and rejects repeated, unpaired and wrong-boundary cursors', async () => {
    const item = baseballAggregateSource()
    const badPages = [{ items: [], nextCursor: null, extra: true }, { items: [], nextCursor: {} },
      { items: [item], nextCursor: { finalizedAt: item.finalizedAt } },
      { items: [item], nextCursor: { finalizedAt: item.finalizedAt, publicationId: aggregateUuid(8000) } }]
    for (const value of badPages) await expect(loadBaseballAggregates(scope, { ...options, client: { rpc: rpcPages([value]) } })).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(loadBaseballAggregates(scope, { ...options, client: { rpc: rpcPages([page([item], true), page([item], true)]) } })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(() => parseBaseballAggregateSource({ ...item, extra: 1 })).toThrow()
  })
  it('accepts descending microsecond keysets without collapsing to milliseconds', async () => {
    const a = baseballAggregateSource(); a.finalizedAt = '2026-10-20T12:00:00.000009+00:00'
    const b = baseballAggregateSource(undefined, 2); b.finalizedAt = '2026-10-20T12:00:00.000008+00:00'
    const c = baseballAggregateSource(undefined, 3)
    const result = await loadBaseballAggregates(scope, { ...options, pageSize: 1, client: { rpc: rpcPages([page([a], true), page([b], true), page([c])]) } })
    expect(result.metrics.pageCount).toBe(3)
  })
  it('validates both tournament and authorized owning team without personal/cross-team attachment', async () => {
    const setup = baseballSetup(); setup.sourceTeamId = AGGREGATE_TEAM
    const item = baseballAggregateSource(finishedAggregateState(startedGame(setup)))
    item.game.tournamentId = aggregateUuid(77)
    const tournament = { type: 'tournament' as const, id: aggregateUuid(77), teamId: AGGREGATE_TEAM }
    const run = () => loadBaseballAggregates(tournament, { ...options, client: { rpc: rpcPages([page([item])]) } })
    expect((await run()).aggregate.games).toHaveLength(1)
    item.game.teamId = aggregateUuid(78)
    expect((await run()).aggregate.games).toHaveLength(0)
    expect(() => parseBaseballAggregateSource({ ...baseballAggregateSource(), game: { ...baseballAggregateSource().game, tournamentId: aggregateUuid(77) } })).toThrow()
  })
})

describe('BSB-7A shared account/request lifetimes', () => {
  it('explicit refresh cannot join an older generation held alive by another subscriber', async () => {
    const old = deferred(), fresh = deferred()
    let requests = 0
    const rpc = vi.fn((name: string) => name.includes('capabilities') ? Promise.resolve(ok(BASEBALL_AGGREGATE_CAPABILITIES)) : (++requests === 1 ? old.promise : fresh.promise))
    const client = { rpc }, oldGeneration = allocateBaseballRefreshGeneration()
    const one = loadBaseballAggregates(scope, { ...options, client, refreshGeneration: oldGeneration })
    const peer = loadBaseballAggregates(scope, { ...options, client, refreshGeneration: oldGeneration })
    const refreshed = loadBaseballAggregates(scope, { ...options, client, refreshGeneration: allocateBaseballRefreshGeneration() })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(requests).toBe(2)
    old.resolve(ok(page([baseballAggregateSource()])))
    fresh.resolve(ok(page([])))
    expect((await one).aggregate.games).toHaveLength(1)
    expect((await peer).aggregate.games).toHaveLength(1)
    expect((await refreshed).aggregate.games).toHaveLength(0)
  })
  it('shares only in-flight work and preserves a subscriber when its peer cancels', async () => {
    const pending = deferred()
    const rpc = vi.fn((name: string) => name.includes('capabilities') ? Promise.resolve(ok(BASEBALL_AGGREGATE_CAPABILITIES)) : pending.promise)
    const client = { rpc }
    const controller = new AbortController()
    const first = loadBaseballAggregates(scope, { ...options, client, signal: controller.signal })
    const second = loadBaseballAggregates(scope, { ...options, client })
    controller.abort()
    await expect(first).rejects.toMatchObject({ code: 'aborted' })
    pending.resolve(ok(page([baseballAggregateSource()])))
    expect((await second).aggregate.games).toHaveLength(1)
    expect(rpc).toHaveBeenCalledTimes(2)
    await loadBaseballAggregates(scope, { ...options, client })
    expect(rpc).toHaveBeenCalledTimes(4)
  })
  it('uses unique subscription records for the same callback and isolates callback failures', async () => {
    const pending = deferred()
    const rpc = vi.fn((name: string) => name.includes('capabilities') ? Promise.resolve(ok(BASEBALL_AGGREGATE_CAPABILITIES)) : pending.promise)
    const client = { rpc }; const controller = new AbortController()
    const progress = vi.fn(() => { throw new Error('consumer callback') })
    const first = loadBaseballAggregates(scope, { ...options, client, signal: controller.signal, onProgress: progress })
    const second = loadBaseballAggregates(scope, { ...options, client, onProgress: progress })
    controller.abort(); await expect(first).rejects.toMatchObject({ code: 'aborted' })
    progress.mockClear()
    pending.resolve(ok(page([])))
    await expect(second).resolves.toMatchObject({ metrics: { pageCount: 1 } })
    expect(progress).toHaveBeenCalled()
  })
  it('handles cancellation from initial progress and replacement cleanup', async () => {
    const pending = deferred()
    const rpc = vi.fn(() => pending.promise)
    const client = { rpc }; const controller = new AbortController()
    const first = loadBaseballAggregates(scope, { ...options, client, signal: controller.signal, onProgress: () => controller.abort() })
    await expect(first).rejects.toMatchObject({ code: 'aborted' })
    const replacement = loadBaseballAggregates(scope, { ...options, client })
    pending.resolve(ok(BASEBALL_AGGREGATE_CAPABILITIES))
    // Replacement's page receives an invalid capability object; the old finally must not remove it.
    await expect(replacement).rejects.toMatchObject({ code: 'invalid_response' })
    expect(rpc).toHaveBeenCalledTimes(3)
  })
  it('rejects A -> B -> A after capability/page awaits and does not join old epochs', async () => {
    for (const stage of ['capability', 'page']) {
      const pending = deferred()
      const rpc = vi.fn((name: string) => stage === 'capability' || !name.includes('capabilities') ? pending.promise : Promise.resolve(ok(BASEBALL_AGGREGATE_CAPABILITIES)))
      const progress = vi.fn()
      const client = { rpc }
      const old = loadBaseballAggregates(scope, { ...options, client, onProgress: progress })
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      setCurrentAuthUserId('B'); setCurrentAuthUserId(AGGREGATE_USER)
      const fresh = loadBaseballAggregates(scope, { ...options, client })
      pending.resolve(ok(stage === 'capability' ? BASEBALL_AGGREGATE_CAPABILITIES : page([])))
      await expect(old).rejects.toMatchObject({ code: 'stale_account' })
      if (stage === 'capability') await expect(fresh).rejects.toMatchObject({ code: 'invalid_response' })
      else await expect(fresh).resolves.toMatchObject({ metrics: { pageCount: 1 } })
      expect(progress.mock.calls.filter(([p]) => p.stage === 'complete')).toHaveLength(0)
    }
  })
  it('rechecks the epoch after cooperative replay yield and keeps refresh generations separate', async () => {
    const rpc = rpcPages([page([baseballAggregateSource(), baseballAggregateSource(undefined, 2)])])
    await expect(loadBaseballAggregates(scope, { ...options, client: { rpc }, projectionBatchSize: 1, yieldControl: async () => {
      setCurrentAuthUserId('B'); setCurrentAuthUserId(AGGREGATE_USER)
    } })).rejects.toMatchObject({ code: 'stale_account' })
    const pending = deferred(); const client = { rpc: vi.fn(() => pending.promise) }
    const a = loadBaseballAggregates(scope, { ...options, client, refreshGeneration: 1 })
    const b = loadBaseballAggregates(scope, { ...options, client, refreshGeneration: 2 })
    expect(client.rpc).toHaveBeenCalledTimes(2)
    pending.resolve(ok({ contractVersion: 0 }))
    await expect(a).rejects.toMatchObject({ code: 'backend_update_required' })
    await expect(b).rejects.toMatchObject({ code: 'backend_update_required' })
  })
})

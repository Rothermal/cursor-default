import { describe, expect, it, vi } from 'vitest'
import {
  BasketballAggregateAuthorityCollisionError,
} from './aggregateComposition'
import {
  AGGREGATE_PLAYERS,
  ANCHORED_AGGREGATE_PLAYERS,
  makeAnchoredCanonicalAggregateSource,
  makeCanonicalAggregateSource,
  makeLegacyAggregateSource,
} from './aggregateTestFixtures'
import {
  BasketballAggregateTransportError,
  loadBasketballAggregates,
  type BasketballAggregateRpcClient,
} from './aggregateTransport'
import type { BasketballCanonicalAggregateSource } from './aggregateProjection'
import type { BasketballLegacyAggregateSource } from './aggregateComposition'

describe('Basketball aggregate transport', () => {
  it('drains canonical and legacy keysets independently and composes mixed history', async () => {
    const canonicalOne = canonicalItem(makeCanonicalAggregateSource({
      gameId: 'canonical-game-1', date: '2026-08-20',
    }))
    const canonicalTwo = canonicalItem(makeCanonicalAggregateSource({
      gameId: 'canonical-game-2', date: '2026-08-19',
    }))
    const legacy = legacyItem(makeLegacyAggregateSource({ gameId: 'legacy-game-1' }))
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = []
    const client = rpcClient((name, parameters) => {
      calls.push({ name, parameters })
      if (name === 'get_basketball_scope_aggregate_publications') {
        return calls.filter(call => call.name === name).length === 1
          ? success({
              items: [canonicalOne],
              nextCursor: {
                finalizedAt: canonicalOne.finalizedAt,
                publicationId: canonicalOne.publicationId,
              },
            })
          : success({ items: [canonicalOne, canonicalTwo], nextCursor: null })
      }
      return success({ items: [legacy], nextCursor: null })
    })
    const progress = vi.fn()

    const loaded = await loadBasketballAggregates(
      { type: 'team', id: 'team-1' },
      { client, onProgress: progress, yieldControl: async () => undefined }
    )

    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({
      name: 'get_basketball_scope_aggregate_publications',
      parameters: {
        p_scope_type: 'team',
        p_scope_id: 'team-1',
        p_before_finalized_at: null,
        p_before_publication_id: null,
        p_limit: 20,
      },
    })
    expect(calls[1].parameters).toMatchObject({
      p_before_finalized_at: canonicalOne.finalizedAt,
      p_before_publication_id: canonicalOne.publicationId,
    })
    expect(calls[2]).toMatchObject({
      name: 'get_basketball_scope_aggregate_legacy_games',
      parameters: {
        p_before_game_date: null,
        p_before_game_id: null,
      },
    })
    expect(loaded.aggregate).toMatchObject({
      provenance: 'mixed',
      quality: 'complete',
      includedGameCount: 3,
    })
    expect(loaded.metrics).toMatchObject({
      canonicalPageCount: 2,
      legacyPageCount: 1,
      canonicalSourceCount: 2,
      legacySourceCount: 1,
      eventCount: 34,
      payloadBytes: 3_000,
      malformedSourceCount: 0,
    })
    expect(progress.mock.calls[progress.mock.calls.length - 1]?.[0]).toMatchObject({
      stage: 'complete', projectedCount: 3, projectionTotal: 3,
    })
  })

  it('uses fixed player RPCs with matching optional filters', async () => {
    const rpc = vi.fn(() => success({ items: [], nextCursor: null }))
    const client = rpcClient(rpc)

    const loaded = await loadBasketballAggregates({
      type: 'player',
      playerId: AGGREGATE_PLAYERS.starter,
      teamId: 'team-1',
      seasonId: 'season-1',
    }, { client })

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'get_basketball_player_aggregate_publications',
      expect.objectContaining({
        p_player_id: AGGREGATE_PLAYERS.starter,
        p_team_id: 'team-1',
        p_season_id: 'season-1',
      })
    )
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'get_basketball_player_aggregate_legacy_games',
      expect.objectContaining({
        p_player_id: AGGREGATE_PLAYERS.starter,
        p_team_id: 'team-1',
        p_season_id: 'season-1',
      })
    )
    expect(loaded.aggregate.scope).toEqual({
      type: 'player', id: AGGREGATE_PLAYERS.starter,
    })
  })

  it('projects anchored metrics from the unchanged canonical page envelope', async () => {
    const source = makeAnchoredCanonicalAggregateSource()
    const client = rpcClient(name => name.includes('publications')
      ? success({ items: [canonicalItem(source)], nextCursor: null })
      : success({ items: [], nextCursor: null }))

    const loaded = await loadBasketballAggregates(
      { type: 'team', id: 'team-1' },
      { client }
    )

    expect(loaded.aggregate).toMatchObject({
      participationBasis: 'interval_derived',
      availableMetricIds: expect.arrayContaining(['bk_dnp', 'bk_pm']),
    })
    expect(loaded.aggregate.players.find(
      player => player.playerId === ANCHORED_AGGREGATE_PLAYERS.starter
    )).toMatchObject({ stats: { bk_min_sec: 1, bk_pm: 2 } })
  })

  it('rejects malformed pages but isolates malformed source items', async () => {
    const invalidPageClient = rpcClient(name => name.includes('publications')
      ? success({ nope: [] })
      : success({ items: [], nextCursor: null }))
    await expect(loadBasketballAggregates(
      { type: 'team', id: 'invalid-page' },
      { client: invalidPageClient }
    )).rejects.toMatchObject({ code: 'invalid_payload' })

    const canonical = canonicalItem(makeCanonicalAggregateSource())
    const malformedCanonical = canonicalItem(makeCanonicalAggregateSource({
      gameId: 'malformed-canonical',
    }))
    ;(malformedCanonical as { publicationNumber: unknown }).publicationNumber = 'bad'
    const legacy = legacyItem(makeLegacyAggregateSource())
    const malformedLegacy = legacyItem(makeLegacyAggregateSource({
      gameId: 'malformed-legacy',
    }))
    ;(malformedLegacy as { trackedStats: unknown }).trackedStats = { ft: -1 }
    const client = rpcClient(name => name.includes('publications')
      ? success({ items: [canonical, malformedCanonical], nextCursor: null })
      : success({ items: [legacy, malformedLegacy], nextCursor: null }))

    const loaded = await loadBasketballAggregates(
      { type: 'team', id: 'team-1' },
      { client }
    )

    expect(loaded.aggregate).toMatchObject({ quality: 'partial', includedGameCount: 2 })
    expect(loaded.aggregate.exclusions.filter(row => row.kind === 'malformed_source'))
      .toHaveLength(2)
    expect(loaded.metrics.malformedSourceCount).toBe(2)
  })

  it('fails closed when transport returns one game from both authority families', async () => {
    const gameId = 'authority-collision'
    const client = rpcClient(name => name.includes('publications')
      ? success({ items: [canonicalItem(makeCanonicalAggregateSource({ gameId }))], nextCursor: null })
      : success({ items: [legacyItem(makeLegacyAggregateSource({ gameId }))], nextCursor: null }))

    await expect(loadBasketballAggregates(
      { type: 'team', id: 'team-1' },
      { client }
    )).rejects.toBeInstanceOf(BasketballAggregateAuthorityCollisionError)
  })

  it('shares in-flight work while allowing one consumer to cancel independently', async () => {
    let resolveCanonical!: (response: TestRpcResponse) => void
    const pendingCanonical = new Promise<TestRpcResponse>(resolve => {
      resolveCanonical = resolve
    })
    const rpc = vi.fn((name: string) => name.includes('publications')
      ? pendingCanonical
      : success({ items: [], nextCursor: null }))
    const client = rpcClient(rpc)
    const controller = new AbortController()
    const first = loadBasketballAggregates(
      { type: 'team', id: 'shared-team' },
      { client, signal: controller.signal }
    )
    const second = loadBasketballAggregates(
      { type: 'team', id: 'shared-team' },
      { client }
    )

    const firstRejection = expect(first).rejects.toMatchObject({ code: 'aborted' })
    controller.abort()
    resolveCanonical(success({ items: [], nextCursor: null }))

    await firstRejection
    await expect(second).resolves.toMatchObject({ aggregate: { includedGameCount: 0 } })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('classifies missing contracts and access failures without legacy fallback', async () => {
    const missing = rpcClient(() => Promise.resolve({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
    }))
    const denied = rpcClient(() => Promise.resolve({
      data: null,
      error: { code: '42501', message: 'APP_ACCESS_SUSPENDED' },
    }))

    await expect(loadBasketballAggregates(
      { type: 'team', id: 'missing' }, { client: missing }
    )).rejects.toMatchObject({ code: 'backend_update_required' })
    await expect(loadBasketballAggregates(
      { type: 'team', id: 'denied' }, { client: denied }
    )).rejects.toMatchObject({ code: 'access_denied' })
  })

  it('rejects repeated cursors and invalid page sizes before publishing totals', async () => {
    const item = canonicalItem(makeCanonicalAggregateSource())
    const repeatedCursor = {
      finalizedAt: item.finalizedAt,
      publicationId: item.publicationId,
    }
    const repeated = rpcClient(name => name.includes('publications')
      ? success({ items: [item], nextCursor: repeatedCursor })
      : success({ items: [], nextCursor: null }))
    await expect(loadBasketballAggregates(
      { type: 'team', id: 'repeated' }, { client: repeated }
    )).rejects.toMatchObject({ code: 'invalid_payload' })

    const rpc = vi.fn()
    await expect(loadBasketballAggregates(
      { type: 'team', id: 'team-1' },
      { client: rpcClient(rpc), pageSize: 51 }
    )).rejects.toBeInstanceOf(BasketballAggregateTransportError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('projects larger mixed pages in cooperative bounded batches', async () => {
    const canonical = Array.from({ length: 6 }, (_, index) =>
      canonicalItem(makeCanonicalAggregateSource({ gameId: `canonical-batch-${index}` })))
    const legacy = Array.from({ length: 5 }, (_, index) =>
      legacyItem(makeLegacyAggregateSource({ gameId: `legacy-batch-${index}` })))
    const client = rpcClient(name => name.includes('publications')
      ? success({ items: canonical, nextCursor: null })
      : success({ items: legacy, nextCursor: null }))
    const yieldControl = vi.fn(async () => undefined)

    const loaded = await loadBasketballAggregates(
      { type: 'team', id: 'team-1' },
      { client, projectionBatchSize: 5, yieldControl }
    )

    expect(loaded.aggregate.includedGameCount).toBe(11)
    expect(yieldControl).toHaveBeenCalledTimes(2)
  })
})

function canonicalItem(source: BasketballCanonicalAggregateSource) {
  return {
    publicationId: source.publicationId,
    publicationNumber: source.publicationNumber,
    snapshotFingerprint: source.snapshotFingerprint,
    finalizedAt: source.finalizedAt,
    eventCount: source.canonicalSnapshot.eventStream.events.length,
    payloadBytes: 1_000,
    game: structuredClone(source.game),
    canonicalSnapshot: structuredClone(source.canonicalSnapshot),
    participantSourceMap: structuredClone(source.participantSourceMap),
    canManage: source.canManage,
  }
}

function legacyItem(source: BasketballLegacyAggregateSource) {
  return {
    sourceId: source.sourceId,
    sourceFingerprint: source.sourceFingerprint,
    resolvedAt: source.resolvedAt,
    payloadBytes: 1_000,
    game: structuredClone(source.game),
    players: structuredClone(source.players),
    trackedStats: structuredClone(source.trackedStats),
    opponentStats: structuredClone(source.opponentStats),
    score: structuredClone(source.score),
    periods: structuredClone(source.periods),
    canManage: source.canManage,
  }
}

interface TestRpcResponse {
  data: unknown
  error: { code?: string; message: string; details?: string; hint?: string } | null
}

function success(data: unknown): TestRpcResponse {
  return { data, error: null }
}

function rpcClient(
  implementation: (
    functionName: string,
    parameters: Record<string, unknown>
  ) => PromiseLike<TestRpcResponse> | TestRpcResponse
): BasketballAggregateRpcClient {
  return {
    rpc: (functionName, parameters) => Promise.resolve(
      implementation(functionName, parameters)
    ),
  }
}

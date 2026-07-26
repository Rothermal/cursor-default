import { describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import {
  SoccerAggregateTransportError,
  loadSoccerCanonicalAggregates,
  type SoccerAggregateRpcClient,
} from './aggregateTransport'
import type { SoccerCanonicalAggregateSource } from './aggregateProjection'
import {
  createSoccerCanonicalSnapshot,
} from './finalization'
import { prepareSoccerKickoff } from './kickoff'
import {
  endSoccerMatch,
  endSoccerPeriod,
  inspectSoccerHistory,
  recordSoccerShot,
} from './live'
import type {
  SoccerRecorderProjection,
  SoccerRecorderSummary,
} from './recorders'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

const kickoffAt = Date.parse('2026-07-20T12:00:00.000Z')
const recorderId = 'recorder-1'

describe('soccer canonical aggregate transport', () => {
  it('drains keyset pages, deduplicates ids, projects, and reports metrics/progress', async () => {
    const first = transportItem(source('publication-1', 'game-1'), 7, 1_200)
    const second = transportItem(source('publication-2', 'game-2'), 7, 1_300)
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = []
    const client = rpcClient((name, parameters) => {
      calls.push({ name, parameters })
      return calls.length === 1
        ? success({
            items: [first],
            nextCursor: {
              finalizedAt: first.finalizedAt,
              publicationId: first.publicationId,
            },
          })
        : success({ items: [first, second], nextCursor: null })
    })
    const progress = vi.fn()

    const loaded = await loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-1' },
      {
        client,
        onProgress: progress,
        yieldControl: async () => undefined,
      }
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      name: 'get_soccer_scope_aggregate_publications',
      parameters: {
        p_scope_type: 'team',
        p_scope_id: 'team-1',
        p_before_finalized_at: null,
        p_before_publication_id: null,
        p_limit: 20,
      },
    })
    expect(calls[1].parameters).toMatchObject({
      p_before_finalized_at: first.finalizedAt,
      p_before_publication_id: first.publicationId,
    })
    expect(loaded.aggregate.includedMatchCount).toBe(2)
    expect(loaded.metrics).toMatchObject({
      pageCount: 2,
      publicationCount: 2,
      eventCount: 14,
      payloadBytes: 2_500,
      malformedPublicationCount: 0,
    })
    expect(progress.mock.calls.map(([value]) => value.stage)).toEqual([
      'loading',
      'loading',
      'projecting',
      'complete',
    ])
  })

  it('uses the indexed player RPC with optional filters', async () => {
    const rpc = vi.fn(() => success({ items: [], nextCursor: null }))
    const client = rpcClient(rpc)

    const loaded = await loadSoccerCanonicalAggregates(
      {
        type: 'player',
        playerId: 'player-1',
        teamId: 'team-1',
        seasonId: 'season-1',
      },
      { client }
    )

    expect(rpc).toHaveBeenCalledWith(
      'get_soccer_player_aggregate_publications',
      {
        p_player_id: 'player-1',
        p_team_id: 'team-1',
        p_season_id: 'season-1',
        p_before_finalized_at: null,
        p_before_publication_id: null,
        p_limit: 20,
      }
    )
    expect(loaded.aggregate.scope).toEqual({ type: 'player', id: 'player-1' })
  })

  it('shares identical in-flight work without one consumer cancelling another', async () => {
    let resolveRequest!: (value: TestRpcResponse) => void
    const pending = new Promise<TestRpcResponse>(resolve => {
      resolveRequest = resolve
    })
    const rpc = vi.fn(() => pending)
    const client = rpcClient(rpc)
    const firstController = new AbortController()
    const first = loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-1' },
      { client, signal: firstController.signal }
    )
    const second = loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-1' },
      { client }
    )

    const firstRejection = expect(first).rejects.toMatchObject({ code: 'aborted' })
    firstController.abort()
    resolveRequest({
      data: {
        items: [transportItem(source('publication-1', 'game-1'))],
        nextCursor: null,
      },
      error: null,
    })

    await firstRejection
    await expect(second).resolves.toMatchObject({
      aggregate: { includedMatchCount: 1 },
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('cancels the underlying request after its final consumer leaves', async () => {
    const rpc = vi.fn(() => {
      const request = new Promise<never>(() => undefined) as ReturnType<
        SoccerAggregateRpcClient['rpc']
      >
      request.abortSignal = signal => new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
      return request
    })
    const client = rpcClient(rpc)
    const controller = new AbortController()
    const load = loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-cancel' },
      { client, signal: controller.signal }
    )

    const rejection = expect(load).rejects.toMatchObject({ code: 'aborted' })
    controller.abort()

    await rejection
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('maps missing RPCs and access failures to typed errors without fallback', async () => {
    const capabilityClient = rpcClient(() => Promise.resolve({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function in the schema cache',
      },
    }))
    const accessClient = rpcClient(() => Promise.resolve({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }))

    await expect(loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-capability' },
      { client: capabilityClient }
    )).rejects.toMatchObject({ code: 'backend_update_required' })
    await expect(loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-access' },
      { client: accessClient }
    )).rejects.toMatchObject({ code: 'access_denied' })
  })

  it('rejects malformed page envelopes but isolates malformed publications', async () => {
    const invalidPageClient = rpcClient(() => success({ nope: [] }))
    await expect(loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-invalid-page' },
      { client: invalidPageClient }
    )).rejects.toMatchObject({ code: 'invalid_payload' })

    const malformed = transportItem(source('publication-bad', 'game-bad'))
    ;(malformed as { canonicalSnapshot: unknown }).canonicalSnapshot = {}
    const partialClient = rpcClient(() => success({
      items: [malformed],
      nextCursor: null,
    }))
    const loaded = await loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-partial' },
      { client: partialClient }
    )

    expect(loaded.aggregate.quality).toBe('partial')
    expect(loaded.aggregate.exclusions).toMatchObject([
      { kind: 'malformed_publication', publicationId: 'publication-bad' },
    ])
    expect(loaded.metrics.malformedPublicationCount).toBe(1)
  })

  it('rejects invalid page sizes before transport begins', async () => {
    const rpc = vi.fn()
    const client = rpcClient(rpc)
    await expect(loadSoccerCanonicalAggregates(
      { type: 'team', id: 'team-1' },
      { client, pageSize: 51 }
    )).rejects.toBeInstanceOf(SoccerAggregateTransportError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('profiles the reviewed 50-publication, 10,000-event fixture cooperatively', async () => {
    const fixture = projectionWithShots(194)
    expect(fixture.eventStream.events).toHaveLength(200)
    const items = Array.from({ length: 50 }, (_, index) => {
      const gameId = `performance-game-${index + 1}`
      return transportItem(
        source(
          `performance-publication-${index + 1}`,
          gameId,
          fixture
        ),
        200,
        200_000
      )
    })
    const client = rpcClient(() => success({ items, nextCursor: null }))
    const yieldControl = vi.fn(async () => undefined)

    const loaded = await loadSoccerCanonicalAggregates(
      { type: 'season', id: 'performance-season' },
      {
        client,
        pageSize: 50,
        projectionBatchSize: 5,
        yieldControl,
      }
    )

    expect(loaded.metrics).toMatchObject({
      publicationCount: 50,
      eventCount: 10_000,
      payloadBytes: 10_000_000,
    })
    expect(loaded.aggregate.includedMatchCount).toBe(50)
    expect(yieldControl).toHaveBeenCalledTimes(9)
  }, 20_000)
})

function setup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: resolveSoccerMatchRules({
      gameOverrides: {
        maxOnFieldPlayers: 1,
        regulationSegments: [{
          id: 'regulation-1',
          label: 'Test Period',
          kind: 'regulation',
          order: 1,
          durationMs: 60_000,
        }],
        extraTimeSegments: [],
      },
    }),
    participants: [{
      id: 'striker',
      kind: 'player',
      playerId: 'local-striker',
      displayName: 'Sam Striker',
      number: '9',
      initialStatus: 'starter',
      initialRole: { group: 'goalkeeper', label: null },
    }],
  }
}

function initialState(): GameState {
  const matchSetup = setup()
  return {
    ...createInitialState(),
    sport: sports.find(sport => sport.id === 'soccer')!,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: 'tournament-1',
      date: '2026-07-20',
    },
    players: [{
      id: 'local-striker',
      name: 'Sam Striker',
      number: '9',
      stats: {},
    }],
    sportGameState: createSoccerSportGameState(matchSetup),
  }
}

function projectionWithShots(shotCount: number): SoccerRecorderProjection {
  const kickoff = prepareSoccerKickoff(initialState(), setup(), {
    recorderUserId: recorderId,
    occurredAt: new Date(kickoffAt).toISOString(),
    eventIds: [uuid(1), uuid(2), uuid(3)],
  })
  if (!kickoff.ok) throw new Error(kickoff.message)
  let state = kickoff.state
  for (let index = 0; index < shotCount; index += 1) {
    const shot = recordSoccerShot(state, {
      teamSide: 'tracked',
      outcome: 'off_target',
      situation: 'open_play',
      location: null,
      shooter: { kind: 'participant', participantId: 'striker' },
    }, {
      recorderUserId: recorderId,
      nowMs: kickoffAt + Math.min(index + 1, 59_000),
      eventIds: [uuid(4 + index)],
    })
    if (!shot.ok) throw new Error(shot.message)
    state = shot.state
  }
  const periodEnded = endSoccerPeriod(state, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 60_000,
    eventIds: [uuid(4 + shotCount), uuid(5 + shotCount)],
  })
  if (!periodEnded.ok) throw new Error(periodEnded.message)
  const ended = endSoccerMatch(periodEnded.state, 'completed', {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 60_000,
    eventIds: [uuid(6 + shotCount)],
  })
  if (!ended.ok) throw new Error(ended.message)
  return recorderProjection(ended.state)
}

let compactFixture: SoccerRecorderProjection | null = null

function source(
  publicationId: string,
  gameId: string,
  projection?: SoccerRecorderProjection
): SoccerCanonicalAggregateSource {
  compactFixture ??= projectionWithShots(1)
  return {
    publicationId,
    publicationNumber: 1,
    snapshotFingerprint: `fingerprint-${publicationId}`,
    finalizedAt: '2026-07-20T12:02:00.000Z',
    game: {
      id: gameId,
      date: '2026-07-20',
      status: 'final',
      cloudScope: 'team',
      teamId: 'team-1',
      seasonId: 'season-1',
      tournamentId: 'tournament-1',
      trackedTeamName: 'Aces',
      opponentName: 'Bears',
    },
    canonicalSnapshot: createSoccerCanonicalSnapshot(
      gameId,
      recorderId,
      projection ?? compactFixture
    ),
    participantSourceMap: {
      striker: 'cloud-striker',
      'local-striker': 'cloud-striker',
    },
    canManage: true,
  }
}

function recorderProjection(state: GameState): SoccerRecorderProjection {
  const recorder: SoccerRecorderSummary = {
    recorderId,
    displayName: 'Recorder',
    eventCount: state.eventStream!.events.length,
    checkpointEventCount: state.eventStream!.events.length,
    checkpointSyncedAt: '2026-07-20T12:01:00.000Z',
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'selected',
    canSelectPrimary: false,
  }
  return {
    recorder,
    state,
    eventStream: state.eventStream!,
    inspection: inspectSoccerHistory(state),
  }
}

function transportItem(
  aggregateSource: SoccerCanonicalAggregateSource,
  eventCount = aggregateSource.canonicalSnapshot.eventStream.events.length,
  payloadBytes = 1_000
) {
  return {
    publicationId: aggregateSource.publicationId,
    publicationNumber: aggregateSource.publicationNumber,
    snapshotFingerprint: aggregateSource.snapshotFingerprint,
    finalizedAt: aggregateSource.finalizedAt,
    eventCount,
    payloadBytes,
    game: structuredClone(aggregateSource.game),
    canonicalSnapshot: structuredClone(aggregateSource.canonicalSnapshot),
    participantSourceMap: structuredClone(aggregateSource.participantSourceMap),
    canManage: aggregateSource.canManage,
  }
}

function rpcClient(
  implementation: (
    name: string,
    parameters: Record<string, unknown>
  ) => ReturnType<SoccerAggregateRpcClient['rpc']>
): SoccerAggregateRpcClient {
  return {
    rpc: (name, parameters) => implementation(name, parameters),
  }
}

function success(data: unknown): Promise<TestRpcResponse> {
  return Promise.resolve({ data, error: null })
}

interface TestRpcResponse {
  data: unknown
  error: {
    code?: string
    message: string
    details?: string
    hint?: string
  } | null
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

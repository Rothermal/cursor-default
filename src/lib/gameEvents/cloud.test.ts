import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameEvent, JsonObject } from './types'

const mock = vi.hoisted(() => ({
  rows: [] as unknown[],
  queryError: null as { message: string } | null,
  rpcResult: 'applied' as unknown,
  rpcError: null as { message: string } | null,
  rpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      mock.rpc(...args)
      return Promise.resolve({ data: mock.rpcResult, error: mock.rpcError })
    },
    from: (table: string) => {
      if (table !== 'game_events') throw new Error(`Unexpected table ${table}`)
      let eqCount = 0
      const query = {
        select: () => query,
        eq: () => {
          eqCount += 1
          return eqCount === 1
            ? query
            : Promise.resolve({ data: mock.rows, error: mock.queryError })
        },
      }
      return query
    },
  },
}))

import {
  deserializeGameEventFromCloud,
  loadGameEventStreamForRecorder,
  serializeGameEventForCloud,
  upsertGameEventForRecorder,
} from './cloud'
import { GameEventRegistry, type GameEventDefinition } from './registry'

interface FixturePayload extends JsonObject {
  value: number
}

type FixtureEvent = GameEvent<FixturePayload, 'fixture', 'soccer'>

const definition: GameEventDefinition<FixtureEvent> = {
  sportId: 'soccer',
  eventType: 'fixture',
  currentSchemaVersion: 1,
  validate: event =>
    typeof event.payload.value === 'number'
      ? { ok: true, event: event as FixtureEvent }
      : { ok: false, message: 'value required' },
}
const registry = new GameEventRegistry<FixtureEvent>([definition])

function event(actors: FixtureEvent['actors'] = []): FixtureEvent {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    sportId: 'soccer',
    eventType: 'fixture',
    schemaVersion: 1,
    recorderUserId: 'user-1',
    sequence: 7,
    revision: 2,
    period: { id: 'regulation-1', order: 1 },
    elapsedMs: 4_000,
    occurredAt: '2026-07-17T12:00:00.000Z',
    teamSide: 'tracked',
    location: null,
    actors,
    payload: { value: 1 },
    createdAt: '2026-07-17T12:00:00.000Z',
    updatedAt: '2026-07-17T12:01:00.000Z',
    deletedAt: null,
  }
}

function row(actors: unknown = []): Record<string, unknown> {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    game_id: 'game-1',
    recorded_by: 'user-1',
    sport_id: 'soccer',
    event_type: 'fixture',
    schema_version: 1,
    stream_sequence: 7,
    revision: 2,
    period_id: 'regulation-1',
    period_order: 1,
    elapsed_ms: 4_000,
    occurred_at: '2026-07-17T12:00:00.000Z',
    team_side: 'tracked',
    location: null,
    actors,
    payload: { value: 1 },
    event_created_at: '2026-07-17T12:00:00.000Z',
    event_updated_at: '2026-07-17T12:01:00.000Z',
    deleted_at: null,
  }
}

describe('game event cloud transport', () => {
  beforeEach(() => {
    mock.rows = []
    mock.queryError = null
    mock.rpcResult = 'applied'
    mock.rpcError = null
    mock.rpc.mockClear()
  })

  it('maps local player actors while preserving staff actors', () => {
    const serialized = serializeGameEventForCloud(
      'game-1',
      'user-1',
      event([
        { kind: 'player', role: 'scorer', playerId: 'local-1' },
        { kind: 'staff', role: 'coach', label: 'Coach' },
      ]),
      { 'local-1': '40000000-0000-4000-8000-000000000001' }
    )

    expect(serialized).toMatchObject({
      ok: true,
      params: {
        p_actors: [
          { kind: 'player', role: 'scorer', playerId: '40000000-0000-4000-8000-000000000001' },
          { kind: 'staff', role: 'coach', label: 'Coach' },
        ],
      },
    })
  })

  it('blocks only the unmapped event upload', () => {
    const serialized = serializeGameEventForCloud(
      'game-1',
      'user-1',
      event([{ kind: 'player', role: 'scorer', playerId: 'local-1' }]),
      {}
    )

    expect(serialized).toMatchObject({
      ok: false,
      diagnostic: { code: 'unmapped_player' },
    })
  })

  it('returns revision statuses from the isolated write RPC', async () => {
    mock.rpcResult = 'idempotent'
    await expect(upsertGameEventForRecorder('game-1', 'user-1', event(), {})).resolves.toEqual({
      ok: true,
      status: 'idempotent',
    })

    mock.rpcResult = 'stale'
    await expect(upsertGameEventForRecorder('game-1', 'user-1', event(), {})).resolves.toMatchObject({
      ok: false,
      status: 'stale',
    })
  })

  it('preserves an unmapped cloud row in quarantine', () => {
    const raw = row([
      {
        kind: 'player',
        role: 'scorer',
        playerId: '40000000-0000-4000-8000-000000000001',
      },
    ])

    const mapped = deserializeGameEventFromCloud(raw, {})

    expect(mapped).toMatchObject({
      ok: false,
      diagnostic: { code: 'unmapped_player' },
      rawRow: raw,
    })
  })

  it('loads, maps, validates, and orders one recorder stream', async () => {
    mock.rows = [
      row([
        {
          kind: 'player',
          role: 'scorer',
          playerId: '40000000-0000-4000-8000-000000000001',
        },
      ]),
    ]

    const loaded = await loadGameEventStreamForRecorder(
      'game-1',
      'user-1',
      { '40000000-0000-4000-8000-000000000001': 'local-1' },
      registry
    )

    expect(loaded.ok).toBe(true)
    expect(loaded.inspection.complete).toBe(true)
    expect(loaded.inspection.activeEvents[0].actors[0]).toMatchObject({
      kind: 'player',
      playerId: 'local-1',
    })
    expect(loaded.quarantinedRows).toEqual([])
  })

  it('quarantines rows outside the requested recorder stream defensively', async () => {
    mock.rows = [{ ...row(), recorded_by: 'user-2' }]

    const loaded = await loadGameEventStreamForRecorder(
      'game-1',
      'user-1',
      {},
      registry
    )

    expect(loaded.ok).toBe(true)
    expect(loaded.inspection.complete).toBe(false)
    expect(loaded.inspection.diagnostics[0].code).toBe('invalid_cloud_row')
    expect(loaded.quarantinedRows).toHaveLength(1)
  })
})

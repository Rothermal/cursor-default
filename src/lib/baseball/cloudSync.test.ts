import { afterEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import {
  eventCloudPolicyForState,
  isEventGameLocalOnly,
  normalizeEventCloudPolicyState,
} from '../eventCloudPolicy'
import { eventCloudTransportAdapterForSport } from '../eventCloudTransportAdapters'
import { cloudSyncRouteForState, isEventCloudSyncEligible } from '../gameSyncFingerprint'
import { baseballCloudParticipants, baseballEventCloudTransportAdapter, syncBaseballEventGameToCloud } from './cloudSync'
import { startBaseballGame } from './commands'
import {
  baseballCloudEnableAvailability,
  enableBaseballEventCloud,
  type EnableBaseballEventCloudDependencies,
} from './enableCloudSync'
import {
  clearBaseballReleaseCapabilityCache,
  ensureBaseballReleaseCapabilities,
  loadBaseballReleaseCapabilities,
  type BaseballReleaseCapabilities,
} from './releaseCapabilities'
import { createBaseballEventGameState } from './setupBuilder'
import { baseballSetupCloudGate } from './setupCloud'
import { baseballSetup } from './testFixtures'

const baseball = sports.find(sport => sport.id === 'baseball')!
const READY: BaseballReleaseCapabilities = {
  contractVersion: 1,
  migration: 77,
  eventTransportVersion: 4,
  recoveryVersion: 1,
  recorderResolutionVersion: 1,
  canonicalFinalizationVersion: 1,
  setupSnapshotVersion: 1,
}

function baseballGame(options: {
  policy?: 'automatic' | 'local_only' | 'none'
  recorder?: string | null
  team?: boolean
  started?: boolean
} = {}): GameState {
  const setup = baseballSetup()
  if (options.team) {
    setup.sourceTeamId = 'team-1'
    setup.sourceSeasonId = 'season-1'
  }
  const created = createBaseballEventGameState({
    sport: baseball,
    setup,
    teamName: 'Home',
    date: '2026-10-18',
    cloudPolicy: options.policy === 'none' ? undefined : options.policy,
  })
  if (!created.ok) throw new Error(created.message)
  let state = created.state
  if (options.started !== false) {
    const started = startBaseballGame(state, {
      recorderUserId: options.recorder === undefined ? 'user-1' : options.recorder,
      occurredAt: '2026-10-18T12:00:00.000Z',
    })
    if (!started.ok) throw new Error(started.message)
    state = started.state
  }
  if (options.policy === 'none') {
    const cloudSync = { ...state.cloudSync }
    delete cloudSync.eventCloudPolicy
    return { ...state, cloudSync }
  }
  return state
}

function clientWith(data: unknown, error: { code?: string; message?: string } | null = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) }
}

afterEach(() => clearBaseballReleaseCapabilityCache())

describe('BSB-6B cloud policy and route', () => {
  it('syncs only games whose policy is automatic', () => {
    expect(cloudSyncRouteForState(baseballGame({ policy: 'automatic' }))).toBe('baseball_events')
    expect(cloudSyncRouteForState(baseballGame({ policy: 'automatic', started: false }))).toBe('baseball_events')
    expect(cloudSyncRouteForState(baseballGame({ policy: 'local_only' }))).toBe('unsupported')
  })

  it('creates device games by default', () => {
    const state = baseballGame()
    expect(state.cloudSync.eventCloudPolicy).toBe('local_only')
    expect(cloudSyncRouteForState(state)).toBe('unsupported')
  })

  it('keeps a game made before BSB-6B (no policy) on this device', () => {
    const state = baseballGame({ policy: 'none' })
    expect(eventCloudPolicyForState(state)).toBe('local_only')
    expect(cloudSyncRouteForState(state)).toBe('unsupported')
    expect(normalizeEventCloudPolicyState(state)).toBe(state)
  })

  it('fails closed on a malformed policy', () => {
    const base = baseballGame({ policy: 'automatic' })
    const state = { ...base, cloudSync: { ...base.cloudSync, eventCloudPolicy: 'sometimes' } } as unknown as GameState
    expect(isEventGameLocalOnly(state)).toBe(true)
    expect(cloudSyncRouteForState(state)).toBe('unsupported')
    const normalized = normalizeEventCloudPolicyState(state)
    expect(normalized.cloudSync.status).toBe('error')
    expect(normalized.cloudSync.lastError).toContain('Baseball cloud policy is invalid')
  })

  it('strips binding metadata from a local-only game and keeps automatic games as they are', () => {
    const base = baseballGame({ policy: 'local_only' })
    const bound = { ...base, cloudSync: { ...base.cloudSync, gameId: 'cloud-1', teamId: 'team-1', playerIdMap: { a: 'b' } } }
    const normalized = normalizeEventCloudPolicyState(bound)
    expect(normalized.cloudSync).toMatchObject({ eventCloudPolicy: 'local_only', gameId: null, teamId: null, playerIdMap: {} })
    const automatic = baseballGame({ policy: 'automatic' })
    expect(normalizeEventCloudPolicyState(automatic)).toBe(automatic)
  })

  it('leaves legacy Baseball grid games on aggregate rules', () => {
    const legacy = {
      ...baseballGame({ policy: 'automatic' }),
      gameDataAuthority: undefined,
      eventStream: null,
      sportGameState: null,
    } as unknown as GameState
    expect(eventCloudPolicyForState(legacy)).toBeNull()
    expect(isEventCloudSyncEligible(legacy)).toBe(false)
    expect(cloudSyncRouteForState(legacy)).not.toBe('baseball_events')
  })
})

describe('BSB-6B transport adapter', () => {
  it('links roster players to the source team only for a team game', () => {
    const personal = baseballCloudParticipants(baseballSetup())
    expect(personal.every(row => row.source_player_id === null)).toBe(true)
    expect(personal[0]).toMatchObject({
      kind: 'player',
      client_participant_id: 't1',
      client_player_id: 'player-t1',
      snapshot: { teamSide: 'tracked', position: null, bats: 'R', throws: 'R' },
    })

    const setup = { ...baseballSetup(), sourceTeamId: 'team-1', sourceSeasonId: 'season-1' }
    const team = baseballCloudParticipants(setup)
    expect(team.map(row => row.source_player_id)).toEqual(setup.participants.map(entry => entry.playerId))

    const anonymous = baseballCloudParticipants({
      ...setup,
      participants: setup.participants.map(entry => ({ ...entry, playerId: null })),
    })
    expect(anonymous.every(row => row.kind === 'anonymous' && row.source_player_id === null)).toBe(true)
  })

  it('keeps opponent slots and pitchers in the setup snapshot, not as participants', () => {
    const setup = baseballSetup()
    const rows = baseballCloudParticipants(setup)
    expect(rows).toHaveLength(setup.participants.length)
    expect(rows.every(row => row.snapshot.teamSide === 'tracked')).toBe(true)
    const prepared = baseballEventCloudTransportAdapter.prepare(baseballGame({ policy: 'automatic' }))
    expect(prepared.setupSnapshot).toMatchObject({ opponentSlots: setup.opponentSlots, opponentPitcher: setup.opponentPitcher })
  })

  it('binds through the fixed Baseball RPC with the frozen setup', () => {
    const state = baseballGame({ policy: 'automatic', team: true })
    const prepared = baseballEventCloudTransportAdapter.prepare(state)
    expect(baseballEventCloudTransportAdapter.bindingRpc).toBe('bind_baseball_event_game_v5')
    expect(baseballEventCloudTransportAdapter.remoteConflictRevisionPolicy).toBe('advance')
    expect(eventCloudTransportAdapterForSport('baseball')).toBe(baseballEventCloudTransportAdapter)
    expect(prepared).toMatchObject({ sourceTeamId: 'team-1', sourceSeasonId: 'season-1' })
    expect(prepared.setupSnapshot).toEqual(state.sportGameState?.sportId === 'baseball' ? state.sportGameState.setup : null)
  })

  it('refuses to sync a device game or another recorder stream', async () => {
    await expect(syncBaseballEventGameToCloud({ state: baseballGame({ policy: 'local_only' }), userId: 'user-1', localGameId: 'local-1' }))
      .rejects.toThrow('saved on this device only')
    await expect(syncBaseballEventGameToCloud({ state: baseballGame({ policy: 'automatic' }), userId: 'user-2', localGameId: 'local-1' }))
      .rejects.toThrow('cannot blend another recorder stream')
  })
})

describe('BSB-6B Enable cloud sync', () => {
  function dependencies(overrides: Partial<EnableBaseballEventCloudDependencies> = {}): EnableBaseballEventCloudDependencies {
    return {
      loadAppAccess: vi.fn(async () => ({ access: { status: 'active' as const, appRole: 'user' as const, updatedAt: null }, error: null })),
      loadCapabilities: vi.fn(async () => ({ status: 'ready' as const, capabilities: READY })),
      loadTeamRole: vi.fn(async () => 'scorer' as const),
      sync: vi.fn(async input => ({
        seasonId: null,
        teamId: null,
        gameId: 'cloud-game-1',
        gameStatus: 'in_progress' as const,
        playerIdMap: { 'player-t1': 'cloud-player-1' },
        syncedAt: '2026-10-18T12:00:00.000Z',
        syncedState: input.state,
      })),
      ...overrides,
    }
  }

  it('is offered for a device game this account recorded', () => {
    expect(baseballCloudEnableAvailability(baseballGame({ policy: 'none' }), 'user-1')).toEqual({ offer: true })
    expect(baseballCloudEnableAvailability(baseballGame({ policy: 'local_only' }), 'user-1')).toEqual({ offer: true })
    expect(baseballCloudEnableAvailability(baseballGame({ policy: 'automatic' }), 'user-1')).toEqual({ offer: false, reason: null })
  })

  it('explains why a signed-out or signed-out-recorded game stays on this device', () => {
    expect(baseballCloudEnableAvailability(baseballGame({ policy: 'local_only' }), null))
      .toEqual({ offer: false, reason: 'Sign in to sync this game to the cloud.' })
    const signedOut = baseballCloudEnableAvailability(baseballGame({ policy: 'local_only', recorder: null }), 'user-1')
    expect(signedOut.offer).toBe(false)
    expect(signedOut.offer ? null : signedOut.reason).toContain('recorded signed out')
  })

  it('uploads with the automatic policy and records the cloud binding', async () => {
    const deps = dependencies()
    const result = await enableBaseballEventCloud({ state: baseballGame({ policy: 'none' }), userId: 'user-1', localGameId: 'local-1' }, deps)
    expect(vi.mocked(deps.sync).mock.calls[0][0].state.cloudSync.eventCloudPolicy).toBe('automatic')
    expect(result.cloudGameId).toBe('cloud-game-1')
    expect(result.state.cloudSync).toMatchObject({ eventCloudPolicy: 'automatic', gameId: 'cloud-game-1', status: 'synced' })
    expect(result.state.cloudSync.lastSyncedGameFingerprint).toBeTruthy()
    expect(cloudSyncRouteForState(result.state)).toBe('baseball_events')
  })

  it('stops before uploading when access, team role or the handshake fails', async () => {
    const state = baseballGame({ policy: 'local_only', team: true })
    const input = { state, userId: 'user-1', localGameId: 'local-1' }

    const inactive = dependencies({ loadAppAccess: vi.fn(async () => ({ access: null, error: 'Account pending.' })) })
    await expect(enableBaseballEventCloud(input, inactive)).rejects.toThrow('Account pending.')
    expect(inactive.sync).not.toHaveBeenCalled()

    const viewer = dependencies({ loadTeamRole: vi.fn(async () => 'viewer' as const) })
    await expect(enableBaseballEventCloud(input, viewer)).rejects.toThrow('team role cannot enable')
    expect(viewer.sync).not.toHaveBeenCalled()

    const backend = dependencies({
      loadCapabilities: vi.fn(async () => ({ status: 'backend_update_required' as const, error: 'Baseball cloud games require the latest backend update.' })),
    })
    await expect(enableBaseballEventCloud(input, backend)).rejects.toThrow('latest backend update')
    expect(backend.sync).not.toHaveBeenCalled()
  })
})

describe('BSB-6B release handshake', () => {
  it('accepts only the exact migration 077 contract', async () => {
    await expect(loadBaseballReleaseCapabilities(clientWith(READY))).resolves.toEqual({ status: 'ready', capabilities: READY })
    await expect(loadBaseballReleaseCapabilities(clientWith({ ...READY, extra: 1 }))).resolves.toMatchObject({ status: 'invalid_response' })
    await expect(loadBaseballReleaseCapabilities(clientWith({ ...READY, migration: 76 }))).resolves.toMatchObject({ status: 'invalid_response' })
  })

  it('reads contract 0 or a missing RPC as migrations not applied and a newer contract as a stale client', async () => {
    await expect(loadBaseballReleaseCapabilities(clientWith({ contractVersion: 0 }))).resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(loadBaseballReleaseCapabilities(clientWith(null, { code: 'PGRST202', message: 'Could not find the function' })))
      .resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(loadBaseballReleaseCapabilities(clientWith({ contractVersion: 2 }))).resolves.toMatchObject({ status: 'client_update_required' })
  })

  it('caches a ready result per account and re-checks when forced or the account changes', async () => {
    const client = clientWith(READY)
    await ensureBaseballReleaseCapabilities('user-1', { client })
    await ensureBaseballReleaseCapabilities('user-1', { client })
    expect(client.rpc).toHaveBeenCalledTimes(1)
    await ensureBaseballReleaseCapabilities('user-1', { client, force: true })
    await ensureBaseballReleaseCapabilities('user-2', { client })
    expect(client.rpc).toHaveBeenCalledTimes(3)
    expect(client.rpc).toHaveBeenCalledWith('get_baseball_release_capabilities')
  })
})

describe('BSB-6B setup storage choice', () => {
  const ready = { status: 'done' as const, result: { status: 'ready' as const, capabilities: READY } }
  const failed = { status: 'done' as const, result: { status: 'offline' as const, error: 'Support for Baseball cloud games could not be checked while offline.' } }

  it('saves on this device when signed out or chosen', () => {
    expect(baseballSetupCloudGate({ cloudAvailable: false, storage: 'cloud', capability: { status: 'idle' } }))
      .toEqual({ canStart: true, cloudPolicy: 'local_only' })
    expect(baseballSetupCloudGate({ cloudAvailable: true, storage: 'device', capability: failed }))
      .toEqual({ canStart: true, cloudPolicy: 'local_only' })
  })

  it('starts a cloud game only after a ready handshake, and never falls back silently', () => {
    expect(baseballSetupCloudGate({ cloudAvailable: true, storage: 'cloud', capability: { status: 'checking' } }))
      .toEqual({ canStart: false, checking: true, message: null })
    expect(baseballSetupCloudGate({ cloudAvailable: true, storage: 'cloud', capability: ready }))
      .toEqual({ canStart: true, cloudPolicy: 'automatic' })
    expect(baseballSetupCloudGate({ cloudAvailable: true, storage: 'cloud', capability: failed }))
      .toEqual({ canStart: false, checking: false, message: failed.result.error })
  })
})

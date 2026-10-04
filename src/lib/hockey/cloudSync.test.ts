import { afterEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import {
  eventCloudPolicyForState,
  isEventGameLocalOnly,
  normalizeEventCloudPolicyState,
} from '../eventCloudPolicy'
import { cloudSyncRouteForState } from '../gameSyncFingerprint'
import { hockeyCloudParticipants, hockeyEventCloudTransportAdapter, syncHockeyEventGameToCloud } from './cloudSync'
import {
  enableHockeyEventCloud,
  hockeyCloudEnableAvailability,
  type EnableHockeyEventCloudDependencies,
} from './enableCloudSync'
import {
  clearHockeyReleaseCapabilityCache,
  ensureHockeyReleaseCapabilities,
  loadHockeyReleaseCapabilities,
  type HockeyReleaseCapabilities,
} from './releaseCapabilities'
import { createHockeyEventGameState } from './setupBuilder'
import { hockeySetupCloudGate } from './setupCloud'
import { at, hockeySetup } from './testFixtures'

const hockey = sports.find(sport => sport.id === 'hockey')!
const READY: HockeyReleaseCapabilities = {
  contractVersion: 1,
  migration: 73,
  eventTransportVersion: 4,
  recoveryVersion: 1,
  recorderResolutionVersion: 1,
  canonicalFinalizationVersion: 1,
  setupSnapshotVersion: 1,
}

function hockeyGame(options: { policy?: 'automatic' | 'local_only' | 'none'; recorder?: string | null; team?: boolean } = {}): GameState {
  const setup = hockeySetup()
  if (options.team) {
    setup.sourceTeamId = 'team-1'
    setup.sourceSeasonId = 'season-1'
  }
  const created = createHockeyEventGameState({
    sport: hockey,
    setup,
    teamName: 'Home',
    opponentName: 'Rivals',
    date: '2026-10-04',
    context: { recorderUserId: options.recorder === undefined ? 'user-1' : options.recorder, occurredAt: at(0) },
    cloudPolicy: options.policy === 'none' ? undefined : options.policy,
  })
  if (!created.ok) throw new Error(created.message)
  if (options.policy === 'none') {
    const cloudSync = { ...created.state.cloudSync }
    delete cloudSync.eventCloudPolicy
    return { ...created.state, cloudSync }
  }
  return created.state
}

function clientWith(data: unknown, error: { code?: string; message?: string } | null = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) }
}

afterEach(() => clearHockeyReleaseCapabilityCache())

describe('HKY-5B cloud policy and route', () => {
  it('syncs only games whose policy is automatic', () => {
    expect(cloudSyncRouteForState(hockeyGame({ policy: 'automatic' }))).toBe('hockey_events')
    expect(cloudSyncRouteForState(hockeyGame({ policy: 'local_only' }))).toBe('unsupported')
  })

  it('keeps a game made before HKY-5B (no policy) on this device', () => {
    const state = hockeyGame({ policy: 'none' })
    expect(eventCloudPolicyForState(state)).toBe('local_only')
    expect(cloudSyncRouteForState(state)).toBe('unsupported')
    expect(normalizeEventCloudPolicyState(state)).toBe(state)
  })

  it('fails closed on a malformed policy', () => {
    const base = hockeyGame({ policy: 'automatic' })
    const state = { ...base, cloudSync: { ...base.cloudSync, eventCloudPolicy: 'sometimes' } } as unknown as GameState
    expect(isEventGameLocalOnly(state)).toBe(true)
    expect(cloudSyncRouteForState(state)).toBe('unsupported')
    const normalized = normalizeEventCloudPolicyState(state)
    expect(normalized.cloudSync.status).toBe('error')
    expect(normalized.cloudSync.lastError).toContain('Hockey cloud policy is invalid')
  })

  it('strips binding metadata from a local-only game and keeps automatic games as they are', () => {
    const base = hockeyGame({ policy: 'local_only' })
    const bound = { ...base, cloudSync: { ...base.cloudSync, gameId: 'cloud-1', teamId: 'team-1', playerIdMap: { a: 'b' } } }
    const normalized = normalizeEventCloudPolicyState(bound)
    expect(normalized.cloudSync).toMatchObject({ eventCloudPolicy: 'local_only', gameId: null, teamId: null, playerIdMap: {} })
    const automatic = hockeyGame({ policy: 'automatic' })
    expect(normalizeEventCloudPolicyState(automatic)).toBe(automatic)
  })

  it('leaves legacy Hockey stat-grid games on aggregate rules', () => {
    const legacy = { ...hockeyGame({ policy: 'automatic' }), gameDataAuthority: undefined, eventStream: null, sportGameState: null }
    expect(eventCloudPolicyForState(legacy as GameState)).toBeNull()
    expect(cloudSyncRouteForState(legacy as GameState)).not.toBe('hockey_events')
  })
})

describe('HKY-5B transport adapter', () => {
  it('links roster players to the source team only for a team game', () => {
    const personal = hockeyCloudParticipants(hockeySetup())
    expect(personal.every(row => row.source_player_id === null)).toBe(true)
    expect(personal[0]).toMatchObject({ kind: 'player', client_player_id: 'player-1', snapshot: { teamSide: 'tracked' } })

    const setup = { ...hockeySetup(), sourceTeamId: 'team-1', sourceSeasonId: 'season-1' }
    const team = hockeyCloudParticipants(setup)
    expect(team.map(row => row.source_player_id)).toEqual(setup.participants.map(entry => entry.playerId))

    const anonymous = hockeyCloudParticipants({
      ...setup,
      participants: setup.participants.map(entry => ({ ...entry, playerId: null })),
    })
    expect(anonymous.every(row => row.kind === 'anonymous' && row.source_player_id === null)).toBe(true)
  })

  it('binds through the fixed Hockey RPC with the frozen setup', () => {
    const state = hockeyGame({ policy: 'automatic', team: true })
    const prepared = hockeyEventCloudTransportAdapter.prepare(state)
    expect(hockeyEventCloudTransportAdapter.bindingRpc).toBe('bind_hockey_event_game_v5')
    expect(prepared).toMatchObject({ sourceTeamId: 'team-1', sourceSeasonId: 'season-1' })
    expect(prepared.setupSnapshot).toEqual(state.sportGameState?.sportId === 'hockey' ? state.sportGameState.setup : null)
  })

  it('refuses to sync a device game or another recorder stream', async () => {
    await expect(syncHockeyEventGameToCloud({ state: hockeyGame({ policy: 'local_only' }), userId: 'user-1', localGameId: 'local-1' }))
      .rejects.toThrow('saved on this device only')
    await expect(syncHockeyEventGameToCloud({ state: hockeyGame({ policy: 'automatic' }), userId: 'user-2', localGameId: 'local-1' }))
      .rejects.toThrow('cannot blend another recorder stream')
  })
})

describe('HKY-5B Enable cloud sync', () => {
  function dependencies(overrides: Partial<EnableHockeyEventCloudDependencies> = {}): EnableHockeyEventCloudDependencies {
    return {
      loadAppAccess: vi.fn(async () => ({ access: { status: 'active' as const, appRole: 'user' as const, updatedAt: null }, error: null })),
      loadCapabilities: vi.fn(async () => ({ status: 'ready' as const, capabilities: READY })),
      loadTeamRole: vi.fn(async () => 'scorer' as const),
      sync: vi.fn(async input => ({
        seasonId: null,
        teamId: null,
        gameId: 'cloud-game-1',
        gameStatus: 'in_progress' as const,
        playerIdMap: { 'player-1': 'cloud-player-1' },
        syncedAt: '2026-10-04T12:00:00.000Z',
        syncedState: input.state,
      })),
      ...overrides,
    }
  }

  it('is offered for a device game this account recorded', () => {
    expect(hockeyCloudEnableAvailability(hockeyGame({ policy: 'none' }), 'user-1')).toEqual({ offer: true })
    expect(hockeyCloudEnableAvailability(hockeyGame({ policy: 'local_only' }), 'user-1')).toEqual({ offer: true })
    expect(hockeyCloudEnableAvailability(hockeyGame({ policy: 'automatic' }), 'user-1')).toEqual({ offer: false, reason: null })
  })

  it('explains why a signed-out or signed-out-recorded game stays on this device', () => {
    expect(hockeyCloudEnableAvailability(hockeyGame({ policy: 'local_only' }), null))
      .toEqual({ offer: false, reason: 'Sign in to sync this game to the cloud.' })
    const signedOut = hockeyCloudEnableAvailability(hockeyGame({ policy: 'local_only', recorder: null }), 'user-1')
    expect(signedOut.offer).toBe(false)
    expect(signedOut.offer ? null : signedOut.reason).toContain('recorded signed out')
  })

  it('uploads with the automatic policy and records the cloud binding', async () => {
    const deps = dependencies()
    const result = await enableHockeyEventCloud({ state: hockeyGame({ policy: 'none' }), userId: 'user-1', localGameId: 'local-1' }, deps)
    expect(vi.mocked(deps.sync).mock.calls[0][0].state.cloudSync.eventCloudPolicy).toBe('automatic')
    expect(result.cloudGameId).toBe('cloud-game-1')
    expect(result.state.cloudSync).toMatchObject({ eventCloudPolicy: 'automatic', gameId: 'cloud-game-1', status: 'synced' })
    expect(result.state.cloudSync.lastSyncedGameFingerprint).toBeTruthy()
    expect(cloudSyncRouteForState(result.state)).toBe('hockey_events')
  })

  it('stops before uploading when access, team role or the handshake fails', async () => {
    const state = hockeyGame({ policy: 'local_only', team: true })
    const input = { state, userId: 'user-1', localGameId: 'local-1' }

    const inactive = dependencies({ loadAppAccess: vi.fn(async () => ({ access: null, error: 'Account pending.' })) })
    await expect(enableHockeyEventCloud(input, inactive)).rejects.toThrow('Account pending.')
    expect(inactive.sync).not.toHaveBeenCalled()

    const viewer = dependencies({ loadTeamRole: vi.fn(async () => 'viewer' as const) })
    await expect(enableHockeyEventCloud(input, viewer)).rejects.toThrow('team role cannot enable')
    expect(viewer.sync).not.toHaveBeenCalled()

    const backend = dependencies({
      loadCapabilities: vi.fn(async () => ({ status: 'backend_update_required' as const, error: 'Hockey cloud games require the latest backend update.' })),
    })
    await expect(enableHockeyEventCloud(input, backend)).rejects.toThrow('latest backend update')
    expect(backend.sync).not.toHaveBeenCalled()
  })
})

describe('HKY-5B release handshake', () => {
  it('accepts only the exact migration 073 contract', async () => {
    await expect(loadHockeyReleaseCapabilities(clientWith(READY))).resolves.toEqual({ status: 'ready', capabilities: READY })
    await expect(loadHockeyReleaseCapabilities(clientWith({ ...READY, extra: 1 }))).resolves.toMatchObject({ status: 'invalid_response' })
    await expect(loadHockeyReleaseCapabilities(clientWith({ ...READY, migration: 72 }))).resolves.toMatchObject({ status: 'invalid_response' })
  })

  it('reads contract 0 as migrations not applied and a newer contract as a stale client', async () => {
    await expect(loadHockeyReleaseCapabilities(clientWith({ contractVersion: 0 }))).resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(loadHockeyReleaseCapabilities(clientWith(null, { code: 'PGRST202', message: 'Could not find the function' })))
      .resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(loadHockeyReleaseCapabilities(clientWith({ contractVersion: 2 }))).resolves.toMatchObject({ status: 'client_update_required' })
  })

  it('caches a ready result per account and re-checks when forced or the account changes', async () => {
    const client = clientWith(READY)
    await ensureHockeyReleaseCapabilities('user-1', { client })
    await ensureHockeyReleaseCapabilities('user-1', { client })
    expect(client.rpc).toHaveBeenCalledTimes(1)
    await ensureHockeyReleaseCapabilities('user-1', { client, force: true })
    await ensureHockeyReleaseCapabilities('user-2', { client })
    expect(client.rpc).toHaveBeenCalledTimes(3)
    expect(client.rpc).toHaveBeenCalledWith('get_hockey_release_capabilities')
  })
})

describe('HKY-5B setup storage choice', () => {
  const ready = { status: 'done' as const, result: { status: 'ready' as const, capabilities: READY } }
  const failed = { status: 'done' as const, result: { status: 'offline' as const, error: 'Support for Hockey cloud games could not be checked while offline.' } }

  it('saves on this device when signed out or chosen', () => {
    expect(hockeySetupCloudGate({ cloudAvailable: false, storage: 'cloud', capability: { status: 'idle' } }))
      .toEqual({ canStart: true, cloudPolicy: 'local_only' })
    expect(hockeySetupCloudGate({ cloudAvailable: true, storage: 'device', capability: failed }))
      .toEqual({ canStart: true, cloudPolicy: 'local_only' })
  })

  it('starts a cloud game only after a ready handshake, and never falls back silently', () => {
    expect(hockeySetupCloudGate({ cloudAvailable: true, storage: 'cloud', capability: { status: 'checking' } }))
      .toEqual({ canStart: false, checking: true, message: null })
    expect(hockeySetupCloudGate({ cloudAvailable: true, storage: 'cloud', capability: ready }))
      .toEqual({ canStart: true, cloudPolicy: 'automatic' })
    expect(hockeySetupCloudGate({ cloudAvailable: true, storage: 'cloud', capability: failed }))
      .toEqual({ canStart: false, checking: false, message: failed.result.error })
  })
})

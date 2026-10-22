import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import { createBaseballEventGameState } from '../baseball/setupBuilder'
import { baseballSetup } from '../baseball/testFixtures'
import { recordBaseballPitch, startBaseballGame } from '../baseball/commands'
import { syncBaseballEventGameToCloud } from '../baseball/cloudSync'
import { isGameEventEnvelope } from './envelope'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { editBaseballPlay, previewBaseballEdit, previewBaseballRemoval, previewBaseballRestore, removeBaseballPlay, restoreBaseballCorrection } from '../baseball/corrections'

const cloud = vi.hoisted(() => ({
  userId: 'recorder-a', pause: '', calls: [] as string[],
  gate: null as null | { promise: Promise<void>; resolve: () => void },
  rpc: vi.fn(), query: vi.fn(),
}))
vi.mock('../supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => cloud.rpc(...args),
  from: (table: string) => {
    let action = 'read'
    const builder = {
      select: () => builder, eq: () => builder, neq: () => builder, in: () => builder, is: () => builder, single: () => builder,
      update: () => { action = 'update'; return builder },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        cloud.query(table, action).then(resolve, reject),
    }
    return builder
  },
} }))

function fixture() {
  const setup = { ...baseballSetup(), sourceTeamId: 'team-1', sourceSeasonId: 'season-1' }
  const created = createBaseballEventGameState({
    sport: sports.find(sport => sport.id === 'baseball')!, setup,
    teamName: 'Home', date: '2026-10-18', cloudPolicy: 'automatic',
  })
  if (!created.ok) throw new Error(created.message)
  const started = startBaseballGame(created.state, { recorderUserId: 'recorder-a', occurredAt: '2026-10-18T12:00:00.000Z' })
  if (!started.ok) throw new Error(started.message)
  const pitched = recordBaseballPitch(started.state, { result: 'ball' }, { recorderUserId: 'recorder-a', occurredAt: '2026-10-18T12:00:01.000Z' })
  if (!pitched.ok) throw new Error(pitched.message)
  return { ...pitched.state, gameInfo: { ...pitched.state.gameInfo!, teamNickname: 'Home', opponentNickname: 'Away' } }
}

beforeEach(() => {
  cloud.userId = 'recorder-a'; cloud.pause = ''; cloud.calls = []
  cloud.rpc.mockReset(); cloud.query.mockReset()
  let release!: () => void
  cloud.gate = { promise: new Promise<void>(resolve => { release = resolve }), resolve: () => release() }
  const result = async (stage: string, data: unknown) => {
    cloud.calls.push(stage)
    if (cloud.pause === stage) await cloud.gate!.promise
    return { data, error: null }
  }
  cloud.rpc.mockImplementation((name: string) => {
    if (name === 'get_baseball_release_capabilities') return result('capability', {
      contractVersion: 2, migration: 78, eventTransportVersion: 4, recoveryVersion: 1,
      recorderResolutionVersion: 1, canonicalFinalizationVersion: 1, setupSnapshotVersion: 1,
    })
    if (name === 'bind_baseball_event_game_v5') return result('binding', {
      game_id: 'cloud-1', game_status: 'in_progress', participant_id_map: Object.fromEntries(
        baseballSetup().participants.flatMap(participant => [[participant.id, `cloud-${participant.id}`], [participant.playerId!, `cloud-${participant.id}`]])
      ),
    })
    if (name === 'upsert_game_event_revisioned') return result('event', 'applied')
    if (name === 'resolve_game_event_conflict') return result('resolution', null)
    if (name === 'confirm_game_event_stream_checkpoint') return result('checkpoint', '2026-10-18T12:00:02.000Z')
    throw new Error(`Unexpected RPC ${name}`)
  })
  cloud.query.mockImplementation((table: string) => {
    if (table === 'games') return result('nickname', null)
    if (table === 'game_events') return result('remote', [])
    if (table === 'game_event_conflicts') return result('conflict-status', [{ id: 'conflict-1', status: 'open' }])
    throw new Error(`Unexpected table ${table}`)
  })
})

describe('event transport account lifetime', () => {
  it('uploads and checkpoints repeatedly despite a deleted tournament', async () => {
    setCurrentAuthUserId('recorder-a')
    try {
      const state = fixture()
      const firstEvent = state.eventStream!.events[0]
      if (!isGameEventEnvelope(firstEvent)) throw Error('Missing fixture event')
      state.gameInfo!.tournamentId = 'deleted-tournament'
      cloud.query.mockImplementation(async (table: string, action: string) => {
        if (table === 'games' && action === 'read') return { error: null, data: { id: 'cloud-1', team_id: 'team-1', sport_id: 'baseball', created_by: 'recorder-a', status: 'in_progress', tournament_id: null } }
        return { error: null, data: table === 'game_events' ? [] : null }
      })
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await syncBaseballEventGameToCloud({ state, userId: 'recorder-a', localGameId: 'local-1' })
        expect(result.syncedState.cloudSync.tournamentSyncWarning).toContain('unavailable')
        expect(result.syncedState.cloudSync.eventSyncBase).toHaveProperty(firstEvent.id)
      }
      expect(cloud.rpc.mock.calls.filter(([name]) => name === 'confirm_game_event_stream_checkpoint')).toHaveLength(3)
      expect(cloud.rpc.mock.calls.filter(([name]) => name === 'upsert_game_event_revisioned')).toHaveLength(3 * state.eventStream!.events.length)
    } finally { resetCurrentAuthUserIdForTests() }
  })
  it.each(['capability', 'binding', 'nickname', 'remote', 'event', 'conflict-status', 'resolution', 'checkpoint'])(
    'stops after a pending %s settles for a different account', async stage => {
      const state = fixture()
      const firstEvent = state.eventStream!.events[0]
      if (!isGameEventEnvelope(firstEvent)) throw new Error('Missing fixture event')
      state.cloudSync.pendingEventConflictResolutions = [{
        conflictId: 'conflict-1', eventId: firstEvent.id, resolution: 'local',
      }]
      cloud.pause = stage
      const pending = syncBaseballEventGameToCloud({ state, userId: 'recorder-a', localGameId: 'local-1',
        assertCurrent: () => { if (cloud.userId !== 'recorder-a') throw new Error('Account changed') },
      })
      const outcome = pending.then(value => ({ value, error: null }), error => ({ value: null, error }))
      await vi.waitFor(() => expect(cloud.calls).toContain(stage))
      const callCount = cloud.calls.length
      cloud.userId = 'recorder-b'
      cloud.gate!.resolve()
      expect((await outcome).error).toEqual(new Error('Account changed'))
      expect(cloud.calls).toHaveLength(callCount)
    }
  )
  it('checks after an asynchronous binding validator before reading or writing more data', async () => {
    const validateBinding = vi.fn(async () => { await cloud.gate!.promise })
    const pending = syncBaseballEventGameToCloud({ state: fixture(), userId: 'recorder-a', localGameId: 'local-1', validateBinding,
      assertCurrent: () => { if (cloud.userId !== 'recorder-a') throw new Error('Account changed') },
    })
    const outcome = pending.then(value => ({ value, error: null }), error => ({ value: null, error }))
    await vi.waitFor(() => expect(validateBinding).toHaveBeenCalledOnce())
    const callCount = cloud.calls.length
    cloud.userId = 'recorder-b'; cloud.gate!.resolve()
    expect((await outcome).error).toEqual(new Error('Account changed'))
    expect(cloud.calls).toHaveLength(callCount)
  })
  it('retains the existing transport when no lifetime callback is supplied', async () => {
    const state = fixture()
    const result = await syncBaseballEventGameToCloud({ state, userId: 'recorder-a', localGameId: 'local-1' })
    expect(result.gameId).toBe('cloud-1')
    expect(cloud.calls.filter(stage => stage === 'event')).toHaveLength(state.eventStream!.events.length)
    expect(cloud.calls[cloud.calls.length - 1]).toBe('checkpoint')
  })
  it('refuses actual sync on the old backend before binding', async () => {
    cloud.rpc.mockResolvedValue({ data: { contractVersion: 1, migration: 77 }, error: null })
    await expect(syncBaseballEventGameToCloud({ state: fixture(), userId: 'recorder-a', localGameId: 'local-1' }))
      .rejects.toThrow('latest backend update')
    expect(cloud.rpc).toHaveBeenCalledOnce()
    expect(cloud.rpc).toHaveBeenCalledWith('get_baseball_release_capabilities')
    expect(cloud.query).not.toHaveBeenCalled()
  })
  it.each(['edited', 'removed', 'restored'])('uploads an offline %s event at its actual revision without fabricating history', async kind => {
    let state = fixture()
    const event = state.eventStream!.events.find(raw => isGameEventEnvelope(raw) && raw.eventType === 'baseball.pitch')
    if (!isGameEventEnvelope(event)) throw new Error('Missing pitch fixture')
    const names = { tracked: 'Home', opponent: 'Away' }
    const options = { now: '2026-10-18T12:00:02.000Z', confirmed: true }
    if (kind === 'edited') {
      const edit = { eventId: event.id, payload: { ...event.payload, result: 'called_strike' }, location: event.location, actors: event.actors }
      const preview = previewBaseballEdit(state, edit, names)
      if (!preview.ok) throw new Error(preview.message)
      const result = editBaseballPlay(state, preview.preview, edit, names, options)
      if (!result.ok) throw new Error(result.message)
      state = { ...result.state, gameInfo: state.gameInfo }
    } else {
      const preview = previewBaseballRemoval(state, event.id, names)
      if (!preview.ok) throw new Error(preview.message)
      const result = removeBaseballPlay(state, preview.preview, names, options)
      if (!result.ok) throw new Error(result.message)
      state = { ...result.state, gameInfo: state.gameInfo }
      if (kind === 'restored') {
        const restorePreview = previewBaseballRestore(state, { kind: 'restore_unit', unitId: event.id }, names)
        if (!restorePreview.ok) throw new Error(restorePreview.message)
        const restored = restoreBaseballCorrection(state, restorePreview.preview, names, { ...options, now: '2026-10-18T12:00:03.000Z' })
        if (!restored.ok) throw new Error(restored.message)
        state = { ...restored.state, gameInfo: state.gameInfo }
      }
    }
    const before = structuredClone(state.eventStream)
    const result = await syncBaseballEventGameToCloud({ state, userId: 'recorder-a', localGameId: 'local-1' })
    const writes = cloud.rpc.mock.calls.filter(([name]) => name === 'upsert_game_event_revisioned')
    expect(writes).toHaveLength(2)
    expect(writes.find(([, params]) => params.p_id === event.id)?.[1]).toMatchObject({
      p_revision: kind === 'restored' ? 3 : 2,
      p_deleted_at: kind === 'removed' ? options.now : null,
    })
    expect(result.syncedState.eventStream).toEqual(before)
  })
})

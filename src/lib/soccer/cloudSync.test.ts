import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { createInitialState } from '../gameReducer'
import { prepareSoccerKickoff } from './kickoff'
import {
  addSoccerMatchParticipant,
  recordSoccerShot,
  resolveSoccerParticipant,
} from './live'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import { gameEventSyncBase } from './cloudConflicts'
import type { SoccerMatchSetup } from './types'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  upsert: vi.fn(),
  load: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
    from: (...args: unknown[]) => cloudMock.from(...args),
  },
}))

vi.mock('../gameEvents/cloud', () => ({
  upsertGameEventForRecorder: (...args: unknown[]) => cloudMock.upsert(...args),
  loadGameEventStreamForRecorder: (...args: unknown[]) => cloudMock.load(...args),
}))
import {
  assertHealthySoccerEventGame,
  soccerCloudParticipants,
  soccerEventRevisionCheckpoint,
  soccerEventStreamFingerprint,
  SoccerCloudRecoveryError,
  syncSoccerEventGameToCloud,
} from './cloudSync'

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'Goals',
}

function setup(sourceTeamId: string | null = null): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId,
    sourceSeasonId: sourceTeamId ? 'season-1' : null,
    rulesSnapshot: resolveSoccerMatchRules(),
    participants: [
      {
        id: 'participant-keeper',
        kind: 'player',
        playerId: 'player-keeper',
        displayName: 'Keeper',
        number: '1',
        initialStatus: 'starter',
        initialRole: { group: 'goalkeeper', label: null },
      },
      {
        id: 'participant-unknown',
        kind: 'anonymous',
        playerId: null,
        displayName: 'Guest',
        number: null,
        initialStatus: 'bench',
        initialRole: { group: 'forward', label: null },
      },
    ],
  }
}

function startedState(matchSetup = setup()): GameState {
  const initial: GameState = {
    ...createInitialState(),
    sport: soccer,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-22',
    },
    players: [{ id: 'player-keeper', name: 'Keeper', number: '1', stats: {} }],
    sportGameState: createSoccerSportGameState(matchSetup),
  }
  const result = prepareSoccerKickoff(initial, matchSetup, {
    recorderUserId: 'user-1',
    occurredAt: '2026-07-22T12:00:00.000Z',
    eventIds: [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function lateResolvedShotState(): GameState {
  const initial = startedState()
  const added = addSoccerMatchParticipant(initial, {
    id: 'participant-late',
    kind: 'anonymous',
    playerId: null,
    displayName: 'Trialist',
    number: '17',
    initialStatus: 'bench',
    initialRole: { group: 'forward', label: null },
  }, 'on_field', {
    recorderUserId: 'user-1',
    nowMs: Date.parse('2026-07-22T12:00:05.000Z'),
    eventIds: ['10000000-0000-4000-8000-000000000004'],
  })
  if (!added.ok) throw new Error(added.message)
  const withRosterPlayer: GameState = {
    ...added.state,
    players: [
      ...added.state.players,
      { id: 'player-late', name: 'Late Player', number: '17', stats: {} },
    ],
  }
  const resolved = resolveSoccerParticipant(
    withRosterPlayer,
    'participant-late',
    'player-late',
    'Late Player',
    '17',
    {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-22T12:00:06.000Z'),
      eventIds: ['10000000-0000-4000-8000-000000000005'],
    }
  )
  if (!resolved.ok) throw new Error(resolved.message)
  const shot = recordSoccerShot(resolved.state, {
    teamSide: 'tracked',
    outcome: 'saved',
    situation: 'open_play',
    location: null,
    shooter: { kind: 'participant', participantId: 'participant-late' },
  }, {
    recorderUserId: 'user-1',
    nowMs: Date.parse('2026-07-22T12:00:07.000Z'),
    eventIds: ['10000000-0000-4000-8000-000000000006'],
  })
  if (!shot.ok) throw new Error(shot.message)
  return shot.state
}

describe('soccer event cloud sync helpers', () => {
  beforeEach(() => {
    cloudMock.rpc.mockReset()
    cloudMock.upsert.mockReset()
    cloudMock.load.mockReset()
    cloudMock.from.mockReset()
    cloudMock.select.mockReset()
    cloudMock.in.mockReset()
    cloudMock.from.mockReturnValue({ select: cloudMock.select })
    cloudMock.select.mockReturnValue({ in: cloudMock.in })
    cloudMock.in.mockResolvedValue({ data: [], error: null })
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_soccer_event_game_v4'
        ? {
            data: {
              game_id: 'cloud-game-1',
              game_status: 'in_progress',
              participant_id_map: { 'player-keeper': 'cloud-participant-1' },
            },
            error: null,
          }
        : { data: '2026-07-22T12:01:00.000Z', error: null }
    ))
    cloudMock.upsert.mockResolvedValue({ ok: true, status: 'applied' })
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: { version: 1, events: [] },
      inspection: { complete: true, activeEvents: [], deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })
  })

  it('creates personal snapshots without claiming permanent cloud players', () => {
    expect(soccerCloudParticipants(createSoccerSportGameState(setup()))).toEqual([
      expect.objectContaining({
        client_participant_id: 'participant-keeper',
        client_player_id: 'player-keeper',
        source_player_id: null,
        display_name: 'Keeper',
      }),
      expect.objectContaining({
        client_participant_id: 'participant-unknown',
        client_player_id: null,
        source_player_id: null,
      }),
    ])
  })

  it('retains source player links only for a selected cloud team', () => {
    const participants = soccerCloudParticipants(createSoccerSportGameState(setup('team-1')))
    expect(participants[0]?.source_player_id).toBe('player-keeper')
  })

  it('snapshots late participants from current projection after identity resolution', () => {
    const state = lateResolvedShotState()
    const sportState = assertHealthySoccerEventGame(state)
    const participants = soccerCloudParticipants(sportState)
    expect(participants).toContainEqual(expect.objectContaining({
      client_participant_id: 'participant-late',
      client_player_id: 'player-late',
      kind: 'player',
      display_name: 'Late Player',
      snapshot: expect.objectContaining({ addedDuringMatch: true }),
    }))
    expect(participants.every(participant =>
      !('currentStatus' in participant.snapshot) &&
      !('currentRole' in participant.snapshot)
    )).toBe(true)
  })

  it('builds a deterministic revision checkpoint for a healthy existing game', () => {
    const state = startedState()
    expect(() => assertHealthySoccerEventGame(state)).not.toThrow()
    expect(soccerEventRevisionCheckpoint(state)).toEqual([
      { id: '10000000-0000-4000-8000-000000000001', revision: 1 },
      { id: '10000000-0000-4000-8000-000000000002', revision: 1 },
      { id: '10000000-0000-4000-8000-000000000003', revision: 1 },
    ])
    expect(soccerEventStreamFingerprint(state)).toBe(soccerEventStreamFingerprint(state))
  })

  it('refuses adoption when the local event stream has a projection diagnostic', () => {
    const state = startedState()
    state.eventStream!.events.push({ bad: 'event' })
    expect(() => assertHealthySoccerEventGame(state)).toThrow()
  })

  it('binds, uploads every revision, and confirms the checkpoint last', async () => {
    const result = await syncSoccerEventGameToCloud({
      state: startedState(),
      userId: 'user-1',
      localGameId: '20000000-0000-4000-8000-000000000001',
    })

    expect(result).toMatchObject({
      gameId: 'cloud-game-1',
      gameStatus: 'in_progress',
      syncedAt: '2026-07-22T12:01:00.000Z',
    })
    expect(cloudMock.upsert).toHaveBeenCalledTimes(3)
    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual([
      'bind_soccer_event_game_v4',
      'confirm_game_event_stream_checkpoint',
    ])
    expect(cloudMock.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_event_count: 3,
      p_max_sequence: 2,
    })
  })

  it('skips closed conflict rows and submits only the latest choice for an open row', async () => {
    const state = startedState()
    const firstEvent = state.eventStream!.events[0] as GameEvent
    const secondEvent = state.eventStream!.events[1] as GameEvent
    state.cloudSync.pendingEventConflictResolutions = [
      {
        conflictId: '30000000-0000-4000-8000-000000000001',
        eventId: firstEvent.id,
        resolution: 'local',
      },
      {
        conflictId: '30000000-0000-4000-8000-000000000002',
        eventId: secondEvent.id,
        resolution: 'local',
      },
      {
        conflictId: '30000000-0000-4000-8000-000000000002',
        eventId: secondEvent.id,
        resolution: 'remote',
      },
    ]
    cloudMock.in.mockResolvedValue({
      data: [
        { id: '30000000-0000-4000-8000-000000000001', status: 'resolved' },
        { id: '30000000-0000-4000-8000-000000000002', status: 'open' },
      ],
      error: null,
    })

    const result = await syncSoccerEventGameToCloud({
      state,
      userId: 'user-1',
      localGameId: '20000000-0000-4000-8000-000000000001',
    })

    expect(cloudMock.in).toHaveBeenCalledWith('id', [
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
    ])
    const resolutionCalls = cloudMock.rpc.mock.calls.filter(
      call => call[0] === 'resolve_game_event_conflict'
    )
    expect(resolutionCalls).toHaveLength(1)
    expect(resolutionCalls[0]?.[1]).toMatchObject({
      p_conflict_id: '30000000-0000-4000-8000-000000000002',
      p_resolution: 'remote',
      p_resolved_event: expect.objectContaining({ id: secondEvent.id }),
    })
    expect(result.syncedState.cloudSync.pendingEventConflictResolutions).toEqual([])
  })

  it('returns the authoritative final status after a late audit upload', async () => {
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_soccer_event_game_v4'
        ? {
            data: {
              game_id: 'cloud-game-1',
              game_status: 'final',
              participant_id_map: { 'player-keeper': 'cloud-participant-1' },
            },
            error: null,
          }
        : { data: '2026-07-22T12:01:00.000Z', error: null }
    ))

    const result = await syncSoccerEventGameToCloud({
      state: startedState(),
      userId: 'user-1',
      localGameId: '20000000-0000-4000-8000-000000000001',
    })

    expect(result.gameStatus).toBe('final')
  })

  it('does not confirm a checkpoint after a partial event upload failure', async () => {
    cloudMock.upsert
      .mockResolvedValueOnce({ ok: true, status: 'applied' })
      .mockResolvedValueOnce({ ok: false, status: 'conflict', error: 'conflict' })

    await expect(syncSoccerEventGameToCloud({
      state: startedState(),
      userId: 'user-1',
      localGameId: '20000000-0000-4000-8000-000000000001',
    })).rejects.toThrow('could not sync')

    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual(['bind_soccer_event_game_v4'])
  })

  it('uploads a late resolved player actor with the refreshed participant map', async () => {
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_soccer_event_game_v4'
        ? {
            data: {
              game_id: 'cloud-game-1',
              game_status: 'in_progress',
              participant_id_map: {
                'player-keeper': 'cloud-participant-1',
                'player-late': 'cloud-participant-2',
              },
            },
            error: null,
          }
        : { data: '2026-07-22T12:01:00.000Z', error: null }
    ))

    await syncSoccerEventGameToCloud({
      state: lateResolvedShotState(),
      userId: 'user-1',
      localGameId: '20000000-0000-4000-8000-000000000001',
    })

    expect(cloudMock.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_participants: expect.arrayContaining([
        expect.objectContaining({
          client_participant_id: 'participant-late',
          client_player_id: 'player-late',
        }),
      ]),
    })
    expect(cloudMock.upsert).toHaveBeenLastCalledWith(
      'cloud-game-1',
      'user-1',
      expect.objectContaining({ eventType: 'soccer.shot' }),
      expect.objectContaining({ 'player-late': 'cloud-participant-2' })
    )
  })

  it('pulls and adopts an unrelated remote event before uploading the checkpoint', async () => {
    const withRemoteShot = lateResolvedShotState()
    const remoteEvents = withRemoteShot.eventStream!.events
    const remoteChain = remoteEvents.slice(3)
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: { version: 1, events: remoteChain },
      inspection: { complete: true, activeEvents: remoteChain, deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_soccer_event_game_v4'
        ? {
            data: {
              game_id: 'cloud-game-1',
              game_status: 'in_progress',
              participant_id_map: {
                'player-keeper': 'cloud-participant-1',
                'player-late': 'cloud-participant-2',
              },
              participants: [
                {
                  id: 'cloud-participant-1',
                  client_participant_id: 'participant-keeper',
                  client_player_id: 'player-keeper',
                  display_name: 'Keeper',
                  jersey_number: '1',
                },
                {
                  id: 'cloud-participant-2',
                  client_participant_id: 'participant-late',
                  client_player_id: 'player-late',
                  display_name: 'Late Player',
                  jersey_number: '17',
                },
              ],
            },
            error: null,
          }
        : { data: '2026-07-22T12:01:00.000Z', error: null }
    ))

    const result = await syncSoccerEventGameToCloud({
      state: startedState(),
      userId: 'user-1',
      localGameId: '20000000-0000-4000-8000-000000000001',
    })

    expect(result.syncedState.eventStream?.events).toHaveLength(6)
    expect(result.syncedState.cloudSync.eventSyncBase).toHaveProperty(
      '10000000-0000-4000-8000-000000000006'
    )
    expect(cloudMock.upsert).toHaveBeenCalledTimes(6)
  })

  it('uses the SOC-5A whole-game checkpoint as the first per-event merge base', async () => {
    const state = startedState()
    state.cloudSync.lastSyncedGameFingerprint = buildGameSyncFingerprint(state)
    state.cloudSync.eventSyncBase = {}
    const original = state.eventStream!.events[0] as GameEvent | undefined
    if (!original || typeof original !== 'object') throw new Error('missing event')
    const remote = { ...original, revision: 2, updatedAt: '2026-07-22T12:00:10.000Z' }
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: { version: 1, events: [remote] },
      inspection: { complete: true, activeEvents: [remote], deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })

    const result = await syncSoccerEventGameToCloud({
      state,
      userId: 'user-1',
      localGameId: '20000000-0000-4000-8000-000000000001',
    })

    expect(result.syncedState.eventStream?.events[0]).toMatchObject({
      id: original.id,
      revision: 2,
      updatedAt: '2026-07-22T12:00:10.000Z',
    })
    expect(result.syncedState.cloudSync.eventConflicts).toEqual([])
  })

  it('preserves competing revisions and stops before event upload', async () => {
    const state = startedState()
    const original = state.eventStream!.events[0]
    if (!original || typeof original !== 'object') throw new Error('missing event')
    state.cloudSync.eventSyncBase = gameEventSyncBase(state.eventStream)
    const local = { ...original, revision: 2, updatedAt: '2026-07-22T12:00:10.000Z' }
    const remote = { ...original, revision: 2, updatedAt: '2026-07-22T12:00:11.000Z' }
    state.eventStream!.events[0] = local
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: { version: 1, events: [remote] },
      inspection: { complete: true, activeEvents: [remote], deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_soccer_event_game_v4'
        ? {
            data: {
              game_id: 'cloud-game-1',
              game_status: 'in_progress',
              participant_id_map: { 'player-keeper': 'cloud-participant-1' },
            },
            error: null,
          }
        : name === 'record_game_event_conflict'
          ? { data: '30000000-0000-4000-8000-000000000001', error: null }
          : { data: '2026-07-22T12:01:00.000Z', error: null }
    ))

    let caught: unknown
    try {
      await syncSoccerEventGameToCloud({
        state,
        userId: 'user-1',
        localGameId: '20000000-0000-4000-8000-000000000001',
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SoccerCloudRecoveryError)
    expect((caught as SoccerCloudRecoveryError).recoveredState.cloudSync.eventConflicts).toHaveLength(1)
    expect(cloudMock.upsert).not.toHaveBeenCalled()
  })
})

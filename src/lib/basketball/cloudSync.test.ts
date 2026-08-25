import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameEventSyncConflict, GameState, Player } from '../../types'
import { eventCloudTransportAdapterForSport } from '../eventCloudTransportAdapters'
import { resolveEventConflictInState } from '../gameEvents/eventConflictResolution'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  abandonBasketballMatch,
  addBasketballLateParticipant,
  prepareBasketballGameStart,
} from './commands'
import {
  assertHealthyBasketballEventGame,
  basketballCloudParticipants,
  BasketballCloudRecoveryError,
  basketballEventCloudTransportAdapter,
  createBasketballIndependentRecorderState,
  loadBasketballCloudGameById,
  syncBasketballEventGameToCloud,
} from './cloudSync'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  upsert: vi.fn(),
  load: vi.fn(),
  from: vi.fn(),
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

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function startedState(sourceTeam = false): GameState {
  const base = createInitialState()
  const initial: GameState = {
    ...base,
    gameDataAuthority: 'sport_events',
    sport: basketball,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-15',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig: {
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: null,
      timeoutsPerOvertime: null,
    },
    cloudSync: sourceTeam
      ? { ...base.cloudSync, teamId: 'team-1', seasonId: 'season-1' }
      : base.cloudSync,
  }
  const result = prepareBasketballGameStart(initial, {
    recorderUserId: 'user-1',
    occurredAt: '2026-08-15T12:00:00.000Z',
    eventId: '70000000-0000-4000-8000-000000000001',
    participantIds: [
      '70000000-0000-4000-8000-000000000101',
      '70000000-0000-4000-8000-000000000102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function queryResult(data: unknown, error: { message: string } | null = null) {
  const result = { data, error }
  const chain: Record<string, unknown> & PromiseLike<typeof result> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return chain
}

function mockBasketballCloudRows(
  source: GameState,
  conflicts: unknown[] = []
): void {
  if (source.sportGameState?.sportId !== 'basketball') {
    throw new Error('missing Basketball setup')
  }
  const setup = source.sportGameState.setup
  const participants = setup.participants.map((participant, index) => ({
    id: `cloud-participant-${index + 1}`,
    client_participant_id: participant.id,
    client_player_id: participant.playerId,
    display_name: participant.displayName,
    jersey_number: participant.number,
  }))
  cloudMock.from.mockImplementation((table: string) => {
    if (table === 'games') {
      return queryResult({
        id: 'cloud-game-1',
        team_id: setup.sourceTeamId,
        season_id: setup.sourceSeasonId,
        created_by: 'user-1',
        tracked_team_name: 'Aces',
        opponent_name: 'Bears',
        tournament_name: null,
        game_date: '2026-08-15',
        status: 'in_progress',
      })
    }
    if (table === 'game_event_setup_snapshots') {
      return queryResult({ setup_snapshot: setup })
    }
    if (table === 'game_participants') return queryResult(participants)
    if (table === 'game_event_conflicts') return queryResult(conflicts)
    throw new Error(`unexpected table ${table}`)
  })
}

describe('Basketball event cloud transport adapter', () => {
  beforeEach(() => {
    cloudMock.rpc.mockReset()
    cloudMock.upsert.mockReset()
    cloudMock.load.mockReset()
    cloudMock.from.mockReset()
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_basketball_event_game_v4'
        ? {
            data: {
              game_id: 'cloud-game-1',
              game_status: 'in_progress',
              participant_id_map: {
                'player-1': 'cloud-participant-1',
                'player-2': 'cloud-participant-2',
              },
            },
            error: null,
          }
        : { data: '2026-08-15T12:01:00.000Z', error: null }
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

  it('serializes stable participants without inventing team or neutral participants', () => {
    const sportState = assertHealthyBasketballEventGame(startedState())
    const participants = basketballCloudParticipants(sportState)

    expect(participants).toHaveLength(2)
    expect(participants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        client_participant_id: '70000000-0000-4000-8000-000000000101',
        client_player_id: 'player-1',
        source_player_id: null,
        display_name: 'Alex One',
        snapshot: expect.objectContaining({ teamSide: 'tracked', addedDuringMatch: false }),
      }),
    ]))
    expect(participants.every(participant => participant.kind === 'player')).toBe(true)
    expect(basketballEventCloudTransportAdapter.remoteConflictRevisionPolicy).toBe('advance')
  })

  it('rejects local-only games before making a cloud request', async () => {
    const state = startedState()
    state.cloudSync.eventCloudPolicy = 'local_only'

    await expect(syncBasketballEventGameToCloud({
      state,
      userId: 'user-1',
      localGameId: 'local-1',
    })).rejects.toThrow('local-only tracking')
    expect(cloudMock.rpc).not.toHaveBeenCalled()
    expect(cloudMock.upsert).not.toHaveBeenCalled()
    expect(cloudMock.load).not.toHaveBeenCalled()
  })

  it('links only tracked participants to the selected source team', () => {
    const state = startedState()
    if (state.sportGameState?.sportId !== 'basketball') throw new Error('missing Basketball state')
    const sportState = structuredClone(state.sportGameState)
    sportState.setup.sourceTeamId = 'team-1'
    sportState.setup.sourceSeasonId = 'season-1'
    const opponentId = sportState.setup.participants[1]!.id
    sportState.setup.participants[1]!.teamSide = 'opponent'
    sportState.projection.participants[opponentId]!.teamSide = 'opponent'

    const participants = basketballCloudParticipants(sportState)
    expect(participants[0]?.source_player_id).toBe('player-1')
    expect(participants[1]?.source_player_id).toBeNull()
  })

  it('serializes late participants from the current projection', () => {
    const added = addBasketballLateParticipant(startedState(), {
      recorderUserId: 'user-1',
      teamSide: 'opponent',
      displayName: 'Late Opponent',
      number: '23',
      occurredAt: '2026-08-15T12:02:00.000Z',
      eventId: '70000000-0000-4000-8000-000000000201',
      participantId: '70000000-0000-4000-8000-000000000202',
      playerId: '70000000-0000-4000-8000-000000000203',
      captureCommandId: '70000000-0000-4000-8000-000000000204',
    })
    if (!added.ok) throw new Error(added.message)
    const participants = basketballCloudParticipants(
      assertHealthyBasketballEventGame(added.state)
    )

    expect(participants).toContainEqual(expect.objectContaining({
      client_participant_id: '70000000-0000-4000-8000-000000000202',
      client_player_id: '70000000-0000-4000-8000-000000000203',
      source_player_id: null,
      snapshot: expect.objectContaining({ teamSide: 'opponent', addedDuringMatch: true }),
    }))
  })

  it('round-trips a healthy stream using only event transport contracts', async () => {
    const result = await syncBasketballEventGameToCloud({
      state: startedState(),
      userId: 'user-1',
      localGameId: '80000000-0000-4000-8000-000000000001',
    })

    expect(result).toMatchObject({
      gameId: 'cloud-game-1',
      gameStatus: 'in_progress',
      syncedAt: '2026-08-15T12:01:00.000Z',
    })
    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual([
      'bind_basketball_event_game_v4',
      'confirm_game_event_stream_checkpoint',
    ])
    expect(cloudMock.upsert).toHaveBeenCalledTimes(1)
    expect(cloudMock.upsert).toHaveBeenCalledWith(
      'cloud-game-1',
      'user-1',
      expect.objectContaining({ sportId: 'basketball' }),
      expect.objectContaining({ 'player-1': 'cloud-participant-1' })
    )
  })

  it('validates a new binding before pulling or uploading recorder events', async () => {
    const validateBinding = vi.fn(() => {
      throw new Error('duplicate local binding')
    })
    await expect(syncBasketballEventGameToCloud({
      state: startedState(),
      userId: 'user-1',
      localGameId: '80000000-0000-4000-8000-000000000001',
      validateBinding,
    })).rejects.toThrow('duplicate local binding')

    expect(validateBinding).toHaveBeenCalledWith('cloud-game-1')
    expect(cloudMock.load).not.toHaveBeenCalled()
    expect(cloudMock.upsert).not.toHaveBeenCalled()
    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual([
      'bind_basketball_event_game_v4',
    ])
  })

  it('binds an authorized team game with immutable team and season sources', async () => {
    await syncBasketballEventGameToCloud({
      state: startedState(true),
      userId: 'user-1',
      localGameId: '80000000-0000-4000-8000-000000000001',
    })

    expect(cloudMock.rpc).toHaveBeenNthCalledWith(
      1,
      'bind_basketball_event_game_v4',
      expect.objectContaining({
        p_source_team_id: 'team-1',
        p_source_season_id: 'season-1',
        p_participants: expect.arrayContaining([
          expect.objectContaining({
            client_player_id: 'player-1',
            source_player_id: 'player-1',
          }),
        ]),
      })
    )
  })

  it('uploads a locally ended stream while the cloud game remains nonfinal', async () => {
    const ended = abandonBasketballMatch(startedState(), {
      recorderUserId: 'user-1',
      occurredAt: '2026-08-15T12:03:00.000Z',
      eventId: '70000000-0000-4000-8000-000000000301',
    })
    if (!ended.ok) throw new Error(ended.message)

    const result = await syncBasketballEventGameToCloud({
      state: ended.state,
      userId: 'user-1',
      localGameId: '80000000-0000-4000-8000-000000000001',
    })

    expect(ended.state.sportGameState?.sportId).toBe('basketball')
    expect(ended.state.sportGameState?.sportId === 'basketball'
      ? ended.state.sportGameState.projection.status
      : null).toBe('ended')
    expect(result.gameStatus).toBe('in_progress')
    expect(cloudMock.upsert).toHaveBeenCalledTimes(2)
  })

  it('rejects a wrong-sport remote stream before upload or checkpoint', async () => {
    const wrongSportEvent = {
      ...(startedState().eventStream!.events[0] as Record<string, unknown>),
      sportId: 'soccer',
    }
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: { version: 1, events: [wrongSportEvent] },
      inspection: { complete: true, activeEvents: [wrongSportEvent], deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })

    await expect(syncBasketballEventGameToCloud({
      state: startedState(),
      userId: 'user-1',
      localGameId: '80000000-0000-4000-8000-000000000001',
    })).rejects.toBeInstanceOf(BasketballCloudRecoveryError)
    expect(cloudMock.upsert).not.toHaveBeenCalled()
    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual([
      'bind_basketball_event_game_v4',
    ])
  })

  it('adopts the current recorder stream from an exact immutable cloud setup', async () => {
    const remote = startedState()
    mockBasketballCloudRows(remote)
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: remote.eventStream,
      inspection: { complete: true, activeEvents: remote.eventStream!.events, deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })

    const adopted = await loadBasketballCloudGameById('user-1', 'cloud-game-1')

    expect(adopted).not.toBeNull()
    expect(adopted).toMatchObject({
      gameDataAuthority: 'sport_events',
      cloudSync: {
        gameId: 'cloud-game-1',
        status: 'synced',
        eventConflicts: [],
        pendingEventConflictResolutions: [],
      },
      sportGameState: {
        sportId: 'basketball',
        projection: { status: 'in_progress' },
      },
    })
    expect(adopted?.eventStream).toEqual(remote.eventStream)
    expect(adopted?.cloudSync.lastSyncedGameFingerprint).toEqual(expect.any(String))
    expect(cloudMock.load).toHaveBeenCalledWith(
      'cloud-game-1',
      'user-1',
      expect.objectContaining({ 'cloud-participant-1': 'player-1' }),
      expect.anything()
    )
  })

  it('reports an empty recorder stream and can create an independent local start', async () => {
    const source = startedState()
    mockBasketballCloudRows(source)
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: { version: 1, events: [] },
      inspection: { complete: true, activeEvents: [], deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })

    await expect(loadBasketballCloudGameById('user-2', 'cloud-game-1')).resolves.toBeNull()
    const independent = await createBasketballIndependentRecorderState('user-2', 'cloud-game-1')

    expect(independent.cloudSync.gameId).toBe('cloud-game-1')
    expect(independent.eventStream?.events).toHaveLength(1)
    expect(independent.eventStream?.events[0]).toMatchObject({
      sportId: 'basketball',
      eventType: 'basketball.period_started',
      recorderUserId: 'user-2',
      sequence: 1,
    })
  })

  it('quarantines malformed conflict rows without replacing a coherent local game', async () => {
    const remote = startedState()
    const remoteEvent = remote.eventStream!.events[0] as GameEvent
    mockBasketballCloudRows(remote, [{
      id: 'conflict-1',
      event_id: remoteEvent.id,
      local_event: { invalid: true },
      remote_event: remoteEvent,
      detected_at: '2026-08-15T12:05:00.000Z',
    }])
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: remote.eventStream,
      inspection: { complete: true, activeEvents: remote.eventStream!.events, deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })

    await expect(loadBasketballCloudGameById('user-1', 'cloud-game-1')).rejects.toThrow(
      'Cloud Basketball conflict history is invalid.'
    )
  })

  it('rejects participant rows that disagree with the immutable setup', async () => {
    const remote = startedState()
    mockBasketballCloudRows(remote)
    const originalFrom = cloudMock.from.getMockImplementation()!
    cloudMock.from.mockImplementation((table: string) => {
      if (table === 'game_participants') {
        return queryResult([{
          id: 'cloud-participant-1',
          client_participant_id: remote.sportGameState!.setup.participants[0]!.id,
          client_player_id: 'player-1',
          display_name: 'Changed Name',
          jersey_number: '4',
        }])
      }
      return originalFrom(table)
    })

    await expect(loadBasketballCloudGameById('user-1', 'cloud-game-1')).rejects.toThrow(
      'Cloud Basketball participant identity does not match the immutable setup.'
    )
  })

  it('resolves a Basketball cloud choice through the adapter advance policy', () => {
    const source = startedState()
    const original = source.eventStream!.events[0] as GameEvent
    const localEvent: GameEvent = {
      ...structuredClone(original),
      revision: 2,
      updatedAt: '2026-08-15T12:02:00.000Z',
    }
    const remoteEvent: GameEvent = {
      ...structuredClone(original),
      revision: 3,
      updatedAt: '2026-08-15T12:03:00.000Z',
    }
    const conflict: GameEventSyncConflict = {
      conflictId: 'conflict-1',
      eventId: original.id,
      localEvent,
      remoteEvent,
      detectedAt: '2026-08-15T12:04:00.000Z',
    }
    const state: GameState = {
      ...source,
      eventStream: {
        ...source.eventStream!,
        events: source.eventStream!.events.map(event =>
          (event as GameEvent).id === original.id ? localEvent : event
        ),
      },
      cloudSync: {
        ...source.cloudSync,
        eventConflicts: [conflict],
      },
    }
    const adapter = eventCloudTransportAdapterForSport('basketball')
    if (!adapter) throw new Error('missing Basketball adapter')

    const result = resolveEventConflictInState(
      state,
      original.id,
      'remote',
      adapter,
      '2026-08-15T12:05:00.000Z'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.eventStream?.events[0]).toMatchObject({
      revision: 4,
      updatedAt: '2026-08-15T12:05:00.000Z',
    })
    expect(result.state.cloudSync.eventConflicts).toEqual([])
    expect(result.state.cloudSync.pendingEventConflictResolutions).toEqual([
      expect.objectContaining({ conflictId: 'conflict-1', resolution: 'remote' }),
    ])
  })
})

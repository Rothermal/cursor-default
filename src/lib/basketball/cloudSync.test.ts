import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { addBasketballLateParticipant, prepareBasketballGameStart } from './commands'
import {
  assertHealthyBasketballEventGame,
  basketballCloudParticipants,
  BasketballCloudRecoveryError,
  basketballEventCloudTransportAdapter,
  syncBasketballEventGameToCloud,
} from './cloudSync'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  upsert: vi.fn(),
  load: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
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

function startedState(): GameState {
  const initial: GameState = {
    ...createInitialState(),
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

describe('Basketball event cloud transport adapter', () => {
  beforeEach(() => {
    cloudMock.rpc.mockReset()
    cloudMock.upsert.mockReset()
    cloudMock.load.mockReset()
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

  it('round-trips a healthy stream through the shared engine without app routing', async () => {
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
})

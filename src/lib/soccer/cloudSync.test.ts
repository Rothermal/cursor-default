import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { prepareSoccerKickoff } from './kickoff'
import {
  addSoccerMatchParticipant,
  recordSoccerShot,
  resolveSoccerParticipant,
} from './live'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
  },
}))

vi.mock('../gameEvents/cloud', () => ({
  upsertGameEventForRecorder: (...args: unknown[]) => cloudMock.upsert(...args),
}))
import {
  assertHealthySoccerEventGame,
  soccerCloudParticipants,
  soccerEventRevisionCheckpoint,
  soccerEventStreamFingerprint,
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
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_soccer_event_game'
        ? {
            data: {
              game_id: 'cloud-game-1',
              participant_id_map: { 'player-keeper': 'cloud-participant-1' },
            },
            error: null,
          }
        : { data: '2026-07-22T12:01:00.000Z', error: null }
    ))
    cloudMock.upsert.mockResolvedValue({ ok: true, status: 'applied' })
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
    expect(soccerCloudParticipants(sportState)).toContainEqual(expect.objectContaining({
      client_participant_id: 'participant-late',
      client_player_id: 'player-late',
      kind: 'player',
      display_name: 'Late Player',
      snapshot: expect.objectContaining({ addedDuringMatch: true }),
    }))
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
      syncedAt: '2026-07-22T12:01:00.000Z',
    })
    expect(cloudMock.upsert).toHaveBeenCalledTimes(3)
    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual([
      'bind_soccer_event_game',
      'confirm_game_event_stream_checkpoint',
    ])
    expect(cloudMock.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_event_count: 3,
      p_max_sequence: 2,
    })
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

    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual(['bind_soccer_event_game'])
  })

  it('uploads a late resolved player actor with the refreshed participant map', async () => {
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'bind_soccer_event_game'
        ? {
            data: {
              game_id: 'cloud-game-1',
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
})

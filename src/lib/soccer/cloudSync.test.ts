import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { prepareSoccerKickoff } from './kickoff'
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
    expect(soccerCloudParticipants(createSoccerSportGameState(setup()).setup)).toEqual([
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
    const participants = soccerCloudParticipants(createSoccerSportGameState(setup('team-1')).setup)
    expect(participants[0]?.source_player_id).toBe('player-keeper')
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
})

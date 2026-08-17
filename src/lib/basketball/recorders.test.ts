import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { prepareBasketballGameStart } from './commands'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  load: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
    from: (...args: unknown[]) => cloudMock.from(...args),
  },
}))

vi.mock('../gameEvents/cloud', () => ({
  loadGameEventStreamForRecorder: (...args: unknown[]) => cloudMock.load(...args),
}))

import {
  basketballRecorderNeedsAttention,
  loadBasketballGameRecorders,
  loadBasketballPrimaryRecorderHistory,
  loadBasketballRecorderProjection,
  primaryBasketballRecorder,
  selectBasketballPrimaryRecorder,
  type BasketballRecorderSummary,
} from './recorders'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function startedState(recorderUserId = 'recorder-a'): GameState {
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
      date: '2026-08-17',
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
    cloudSync: {
      ...base.cloudSync,
      teamId: 'team-1',
      seasonId: 'season-1',
    },
  }
  const result = prepareBasketballGameStart(initial, {
    recorderUserId,
    occurredAt: '2026-08-17T12:00:00.000Z',
    eventId: '93000000-0000-4000-8000-000000000001',
    participantIds: [
      '93000000-0000-4000-8000-000000000101',
      '93000000-0000-4000-8000-000000000102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function recorderRow(overrides: Record<string, unknown> = {}) {
  return {
    recorder_user_id: 'recorder-a',
    display_name: 'Coach A',
    event_count: 12,
    checkpoint_event_count: 12,
    checkpoint_synced_at: '2026-08-17T12:01:00.000Z',
    checkpoint_current: true,
    unresolved_conflict_count: 0,
    is_primary: true,
    primary_source: 'default',
    can_select_primary: true,
    ...overrides,
  }
}

function recorderSummary(
  overrides: Partial<BasketballRecorderSummary> = {}
): BasketballRecorderSummary {
  return {
    recorderId: 'recorder-a',
    displayName: 'Coach A',
    eventCount: 12,
    checkpointEventCount: 12,
    checkpointSyncedAt: '2026-08-17T12:01:00.000Z',
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'default',
    canSelectPrimary: true,
    ...overrides,
  }
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

function mockBasketballCloudRows(source: GameState): void {
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
        id: 'game-1',
        team_id: 'team-1',
        season_id: 'season-1',
        created_by: 'creator-1',
        tracked_team_name: 'Aces',
        opponent_name: 'Bears',
        tournament_name: null,
        game_date: '2026-08-17',
        status: 'in_progress',
      })
    }
    if (table === 'game_event_setup_snapshots') {
      return queryResult({ setup_snapshot: setup })
    }
    if (table === 'game_participants') return queryResult(participants)
    throw new Error(`unexpected table ${table}`)
  })
}

describe('Basketball recorder authority client', () => {
  beforeEach(() => {
    cloudMock.rpc.mockReset()
    cloudMock.from.mockReset()
    cloudMock.load.mockReset()
  })

  it('strictly parses manager and limited-reader recorder rows', async () => {
    cloudMock.rpc.mockResolvedValue({
      data: [
        recorderRow(),
        recorderRow({
          recorder_user_id: 'recorder-b',
          display_name: 'Coach B',
          event_count: null,
          checkpoint_event_count: null,
          checkpoint_synced_at: null,
          unresolved_conflict_count: null,
          is_primary: false,
          primary_source: null,
          can_select_primary: false,
        }),
      ],
      error: null,
    })

    await expect(loadBasketballGameRecorders('game-1')).resolves.toEqual([
      recorderSummary(),
      recorderSummary({
        recorderId: 'recorder-b',
        displayName: 'Coach B',
        eventCount: null,
        checkpointEventCount: null,
        checkpointSyncedAt: null,
        unresolvedConflictCount: null,
        isPrimary: false,
        primarySource: null,
        canSelectPrimary: false,
      }),
    ])
  })

  it('rejects malformed booleans, duplicate recorders, and multiple primaries', async () => {
    cloudMock.rpc.mockResolvedValue({
      data: [recorderRow({ checkpoint_current: 'true' })],
      error: null,
    })
    await expect(loadBasketballGameRecorders('game-1')).rejects.toThrow(
      'Invalid checkpoint status'
    )

    cloudMock.rpc.mockResolvedValue({ data: [recorderRow(), recorderRow()], error: null })
    await expect(loadBasketballGameRecorders('game-1')).rejects.toThrow('duplicate recorders')

    cloudMock.rpc.mockResolvedValue({
      data: [
        recorderRow(),
        recorderRow({ recorder_user_id: 'recorder-b', display_name: 'Coach B' }),
      ],
      error: null,
    })
    await expect(loadBasketballGameRecorders('game-1')).rejects.toThrow(
      'multiple primary recorders'
    )
  })

  it('derives explicit primary and attention state without blending rows', () => {
    const primary = recorderSummary()
    const alternate = recorderSummary({
      recorderId: 'recorder-b',
      isPrimary: false,
      primarySource: null,
      checkpointCurrent: false,
      unresolvedConflictCount: null,
    })

    expect(primaryBasketballRecorder([alternate, primary])).toBe(primary)
    expect(primaryBasketballRecorder([alternate])).toBeNull()
    expect(basketballRecorderNeedsAttention(primary)).toBe(false)
    expect(basketballRecorderNeedsAttention(alternate)).toBe(true)
  })

  it('parses immutable history and requires exact primary-selection responses', async () => {
    cloudMock.rpc.mockResolvedValueOnce({
      data: [{
        id: 'history-1',
        previous_recorded_by: null,
        previous_display_name: null,
        recorded_by: 'recorder-a',
        display_name: 'Coach A',
        changed_by: 'owner-1',
        changed_by_display_name: 'Owner',
        changed_at: '2026-08-17T12:05:00.000Z',
      }],
      error: null,
    })
    await expect(loadBasketballPrimaryRecorderHistory('game-1')).resolves.toEqual([
      expect.objectContaining({ id: 'history-1', recorderId: 'recorder-a' }),
    ])

    cloudMock.rpc.mockResolvedValueOnce({ data: 'recorder-a', error: null })
    await expect(selectBasketballPrimaryRecorder('game-1', 'recorder-a')).resolves.toBeUndefined()

    cloudMock.rpc.mockResolvedValueOnce({ data: 'recorder-b', error: null })
    await expect(selectBasketballPrimaryRecorder('game-1', 'recorder-a')).rejects.toThrow(
      'invalid response'
    )
  })

  it('loads another recorder into isolated read-only Basketball state', async () => {
    const remote = startedState('recorder-b')
    mockBasketballCloudRows(remote)
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: remote.eventStream,
      inspection: {
        complete: true,
        activeEvents: remote.eventStream!.events,
        deletedEvents: [],
        diagnostics: [],
      },
      quarantinedRows: [],
      error: null,
    })

    const result = await loadBasketballRecorderProjection(
      'game-1',
      recorderSummary({ recorderId: 'recorder-b', displayName: 'Coach B' })
    )

    expect(cloudMock.load).toHaveBeenCalledWith(
      'game-1',
      'recorder-b',
      {
        'cloud-participant-1': 'player-1',
        'cloud-participant-2': 'player-2',
      },
      expect.anything()
    )
    expect(result.state.cloudSync.gameId).toBe('game-1')
    expect(result.state.sportGameState?.sportId).toBe('basketball')
    expect(result.state.eventStream).toEqual(remote.eventStream)
    expect(result.state).not.toBe(remote)
  })

  it('rejects a loaded stream that does not belong to the selected recorder', async () => {
    const remote = startedState('recorder-a')
    mockBasketballCloudRows(remote)
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: remote.eventStream,
      inspection: {
        complete: true,
        activeEvents: remote.eventStream!.events,
        deletedEvents: [],
        diagnostics: [],
      },
      quarantinedRows: [],
      error: null,
    })

    await expect(loadBasketballRecorderProjection(
      'game-1',
      recorderSummary({ recorderId: 'recorder-b' })
    )).rejects.toThrow('mixed ownership')
  })
})

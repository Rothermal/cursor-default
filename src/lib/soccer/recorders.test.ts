import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { prepareSoccerKickoff } from './kickoff'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

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
  createSoccerIndependentRecorderState,
  loadSoccerGameRecorders,
  loadSoccerRecorderProjection,
  primarySoccerRecorder,
  type SoccerRecorderSummary,
} from './recorders'

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'Goals',
}

const setup: SoccerMatchSetup = {
  version: 1,
  trackedTeamDesignation: 'home',
  firstPeriodAttackingDirection: 'left_to_right',
  sourceTeamId: 'team-1',
  sourceSeasonId: 'season-1',
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
  ],
}

function baseState(): GameState {
  return {
    ...createInitialState(),
    sport: soccer,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-23',
    },
    players: [{ id: 'player-keeper', name: 'Keeper', number: '1', stats: {} }],
    activePlayerId: 'player-keeper',
    eventStream: { version: 1, events: [] },
    sportGameState: createSoccerSportGameState(setup),
    cloudSync: {
      ...createInitialState().cloudSync,
      teamId: 'team-1',
      seasonId: 'season-1',
      gameId: 'game-1',
      gameStatus: 'in_progress',
      playerIdMap: { 'player-keeper': 'cloud-participant-1' },
    },
  }
}

function startedState(
  recorderId: string,
  eventIds: [string, string, string]
): GameState {
  const result = prepareSoccerKickoff(baseState(), setup, {
    recorderUserId: recorderId,
    occurredAt: '2026-07-23T12:00:00.000Z',
    eventIds,
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function recorder(
  recorderId: string,
  overrides: Partial<SoccerRecorderSummary> = {}
): SoccerRecorderSummary {
  return {
    recorderId,
    displayName: recorderId,
    eventCount: 3,
    checkpointEventCount: 3,
    checkpointSyncedAt: '2026-07-23T12:00:00.000Z',
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: false,
    primarySource: null,
    canSelectPrimary: true,
    ...overrides,
  }
}

function queryResult(result: { data: unknown; error: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve(result),
    then: (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return query
}

describe('soccer recorder resolution', () => {
  beforeEach(() => {
    cloudMock.rpc.mockReset()
    cloudMock.from.mockReset()
    cloudMock.load.mockReset()
    cloudMock.from.mockImplementation(() => queryResult({
      data: [{
        id: 'cloud-participant-1',
        client_player_id: 'player-keeper',
        display_name: 'Keeper',
        jersey_number: '1',
      }],
      error: null,
    }))
  })

  it('uses only the explicitly resolved primary recorder', () => {
    const rows = [
      recorder('recorder-a'),
      recorder('recorder-b', { isPrimary: true, primarySource: 'selected' }),
    ]

    expect(primarySoccerRecorder(rows)?.recorderId).toBe('recorder-b')
    expect(primarySoccerRecorder(rows.filter(row => !row.isPrimary))).toBeNull()
  })

  it('parses compact recorder presence returned by the narrow RPC', async () => {
    cloudMock.rpc.mockResolvedValue({
      data: [{
        recorder_user_id: 'recorder-a',
        display_name: 'Coach A',
        event_count: 12,
        checkpoint_event_count: 12,
        checkpoint_synced_at: '2026-07-23T12:00:00.000Z',
        checkpoint_current: true,
        unresolved_conflict_count: 0,
        is_primary: true,
        primary_source: 'default',
        can_select_primary: true,
      }],
      error: null,
    })

    await expect(loadSoccerGameRecorders('game-1')).resolves.toEqual([
      expect.objectContaining({
        recorderId: 'recorder-a',
        displayName: 'Coach A',
        eventCount: 12,
        checkpointCurrent: true,
        isPrimary: true,
        primarySource: 'default',
      }),
    ])
  })

  it('loads another recorder into an isolated projection without replacing the active stream', async () => {
    const active = startedState('recorder-a', [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ])
    const other = startedState('recorder-b', [
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003',
    ])
    cloudMock.load.mockResolvedValue({
      ok: true,
      eventStream: other.eventStream,
      inspection: { complete: true, activeEvents: other.eventStream!.events, deletedEvents: [], diagnostics: [] },
      quarantinedRows: [],
      error: null,
    })

    const result = await loadSoccerRecorderProjection(active, recorder('recorder-b'))

    expect(cloudMock.load).toHaveBeenCalledWith(
      'game-1',
      'recorder-b',
      { 'cloud-participant-1': 'player-keeper' },
      expect.anything()
    )
    expect(result.recorder.recorderId).toBe('recorder-b')
    expect(active.eventStream?.events.map(event => (event as { id: string }).id)).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ])
    expect(result.eventStream.events.map(event => (event as { id: string }).id)).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003',
    ])
    expect(result.state).not.toBe(active)
  })

  it('creates a fresh independent kickoff stream bound to the existing cloud game', async () => {
    cloudMock.from.mockImplementation((table: string) => {
      if (table === 'games') {
        return queryResult({
          data: {
            id: 'game-1',
            team_id: 'team-1',
            season_id: 'season-1',
            created_by: 'creator-1',
            tracked_team_name: 'Aces',
            opponent_name: 'Bears',
            tournament_name: null,
            game_date: '2026-07-23',
            status: 'in_progress',
          },
          error: null,
        })
      }
      if (table === 'game_event_setup_snapshots') {
        return queryResult({ data: { setup_snapshot: setup }, error: null })
      }
      return queryResult({
        data: [{
          id: 'cloud-participant-1',
          client_player_id: 'player-keeper',
          display_name: 'Keeper',
          jersey_number: '1',
        }],
        error: null,
      })
    })

    const state = await createSoccerIndependentRecorderState('recorder-b', 'game-1')

    expect(state.cloudSync.gameId).toBe('game-1')
    expect(state.eventStream?.events).toHaveLength(3)
    expect(state.eventStream?.events.every(event =>
      typeof event === 'object' &&
      event !== null &&
      'recorderUserId' in event &&
      event.recorderUserId === 'recorder-b'
    )).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { endSoccerMatch, inspectSoccerHistory } from './live'
import { prepareSoccerKickoff } from './kickoff'
import type {
  SoccerRecorderProjection,
  SoccerRecorderSummary,
} from './recorders'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
  },
}))

import {
  createSoccerCanonicalSnapshot,
  loadSoccerCanonicalPublication,
  loadSoccerFinalizationReadiness,
  soccerProjectionFromCanonicalSnapshot,
} from './finalization'

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
  const initial = createInitialState()
  return {
    ...initial,
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
      ...initial.cloudSync,
      teamId: 'team-1',
      seasonId: 'season-1',
      gameId: 'game-1',
      gameStatus: 'in_progress',
      playerIdMap: { 'player-keeper': 'cloud-participant-1' },
    },
  }
}

function endedProjection(): SoccerRecorderProjection {
  const kickoff = prepareSoccerKickoff(baseState(), setup, {
    recorderUserId: 'recorder-a',
    occurredAt: '2026-07-23T12:00:00.000Z',
    eventIds: [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ],
  })
  if (!kickoff.ok) throw new Error(kickoff.message)
  const ended = endSoccerMatch(kickoff.state, 'abandoned', {
    recorderUserId: 'recorder-a',
    nowMs: Date.parse('2026-07-23T12:01:00.000Z'),
    eventIds: [
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
    ],
  })
  if (!ended.ok) throw new Error(ended.message)
  const recorder: SoccerRecorderSummary = {
    recorderId: 'recorder-a',
    displayName: 'Recorder A',
    eventCount: ended.state.eventStream!.events.length,
    checkpointEventCount: ended.state.eventStream!.events.length,
    checkpointSyncedAt: '2026-07-23T12:01:00.000Z',
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'selected',
    canSelectPrimary: true,
  }
  return {
    recorder,
    state: ended.state,
    eventStream: ended.state.eventStream!,
    inspection: inspectSoccerHistory(ended.state),
  }
}

describe('soccer finalization repository', () => {
  beforeEach(() => {
    cloudMock.rpc.mockReset()
  })

  it('round-trips a canonical publication through deterministic projection rebuild', () => {
    const projection = endedProjection()
    const snapshot = createSoccerCanonicalSnapshot(
      'game-1',
      'recorder-a',
      projection
    )
    const rebuilt = soccerProjectionFromCanonicalSnapshot(
      baseState(),
      projection.recorder,
      snapshot
    )

    expect(rebuilt.inspection.complete).toBe(true)
    expect(rebuilt.state.cloudSync.gameStatus).toBe('final')
    expect(rebuilt.state.sportGameState?.projection).toEqual(
      projection.state.sportGameState?.projection
    )
    expect(rebuilt.eventStream.events).toEqual(projection.eventStream.events)
  })

  it('rejects a canonical snapshot whose stored projection does not match its events', () => {
    const projection = endedProjection()
    const snapshot = createSoccerCanonicalSnapshot(
      'game-1',
      'recorder-a',
      projection
    )
    snapshot.sportGameState.projection.sideTotals.tracked.score += 1

    expect(() => soccerProjectionFromCanonicalSnapshot(
      baseState(),
      projection.recorder,
      snapshot
    )).toThrow('does not reproduce')
  })

  it('parses authoritative finalization readiness', async () => {
    cloudMock.rpc.mockResolvedValue({
      data: [{
        game_status: 'in_progress',
        can_finalize: true,
        can_reopen: false,
        primary_recorded_by: 'recorder-a',
        primary_display_name: 'Recorder A',
        primary_checkpoint_current: true,
        primary_conflict_count: 0,
        primary_locked: false,
        active_publication_id: null,
        finalized_at: null,
        non_primary_attention_count: 2,
      }],
      error: null,
    })

    await expect(loadSoccerFinalizationReadiness('game-1')).resolves.toEqual({
      gameStatus: 'in_progress',
      canFinalize: true,
      canReopen: false,
      primaryRecorderId: 'recorder-a',
      primaryDisplayName: 'Recorder A',
      primaryCheckpointCurrent: true,
      primaryConflictCount: 0,
      primaryLocked: false,
      activePublicationId: null,
      finalizedAt: null,
      nonPrimaryAttentionCount: 2,
    })
  })

  it('loads the active canonical publication and preserves its snapshot', async () => {
    const snapshot = createSoccerCanonicalSnapshot(
      'game-1',
      'recorder-a',
      endedProjection()
    )
    cloudMock.rpc.mockResolvedValue({
      data: [{
        publication_id: 'publication-1',
        publication_number: 1,
        primary_recorded_by: 'recorder-a',
        primary_display_name: 'Recorder A',
        canonical_snapshot: snapshot,
        snapshot_fingerprint: 'fingerprint',
        finalized_by: 'manager-1',
        finalized_by_display_name: 'Manager',
        finalized_at: '2026-07-23T12:02:00.000Z',
      }],
      error: null,
    })

    await expect(loadSoccerCanonicalPublication('game-1')).resolves.toMatchObject({
      publicationId: 'publication-1',
      publicationNumber: 1,
      primaryRecorderId: 'recorder-a',
      snapshot,
    })
  })
})

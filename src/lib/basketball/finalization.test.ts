import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { eventRevisionCheckpoint, eventStreamFingerprint } from '../gameEvents/cloudTransport'
import { inspectGameEventStream } from '../gameEvents/stream'
import { gameEventRegistry } from '../gameEvents/runtime'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  completeBasketballMatch,
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
} from './commands'
import { adjustBasketballScore } from './directCommands'
import {
  BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
  createBasketballCanonicalSnapshot,
  EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
  finalizeBasketballGame,
  loadBasketballCanonicalPublication,
  loadBasketballCanonicalPublicationHistory,
  loadBasketballFinalizationReadiness,
  parseBasketballCanonicalSnapshot,
  prepareBasketballFinalization,
  reopenBasketballCloudGame,
  type BasketballFinalizationPreview,
} from './finalization'
import type { BasketballRecorderProjection, BasketballRecorderSummary } from './recorders'

const cloudMock = vi.hoisted(() => ({ rpc: vi.fn() }))
const recorderMock = vi.hoisted(() => ({
  loadRecorders: vi.fn(),
  loadProjection: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { rpc: cloudMock.rpc } }))
vi.mock('./recorders', () => ({
  loadBasketballGameRecorders: recorderMock.loadRecorders,
  loadBasketballRecorderProjection: recorderMock.loadProjection,
}))

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorderId = 'recorder-1'

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-16',
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
}

function startedState(): GameState {
  const result = prepareBasketballGameStart(setupState(), {
    recorderUserId: recorderId,
    occurredAt: '2026-08-16T18:00:00.000Z',
    eventId: '92000000-0000-4000-8000-000000000001',
    participantIds: [
      '92000000-0000-4000-8000-000000000101',
      '92000000-0000-4000-8000-000000000102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function completedState(): GameState {
  let state = startedState()
  const adjusted = adjustBasketballScore(state, {
    recorderUserId: recorderId,
    teamSide: 'tracked',
    delta: 2,
    reason: 'scoreboard_control',
    occurredAt: '2026-08-16T18:01:00.000Z',
    eventId: '92000000-0000-4000-8000-000000000002',
  })
  if (!adjusted.ok) throw new Error(adjusted.message)
  state = adjusted.state

  for (let period = 1; period <= 4; period += 1) {
    const ended = endBasketballPeriod(state, {
      recorderUserId: recorderId,
      occurredAt: `2026-08-16T18:${String(period * 2).padStart(2, '0')}:00.000Z`,
      eventId: `92000000-0000-4000-8000-${String(100 + period).padStart(12, '0')}`,
    })
    if (!ended.ok) throw new Error(ended.message)
    state = ended.state
    if (period < 4) {
      const started = startNextBasketballPeriod(state, {
        recorderUserId: recorderId,
        occurredAt: `2026-08-16T18:${String(period * 2 + 1).padStart(2, '0')}:00.000Z`,
        eventId: `92000000-0000-4000-8000-${String(200 + period).padStart(12, '0')}`,
      })
      if (!started.ok) throw new Error(started.message)
      state = started.state
    }
  }

  const completed = completeBasketballMatch(state, {
    recorderUserId: recorderId,
    occurredAt: '2026-08-16T18:10:00.000Z',
    eventId: '92000000-0000-4000-8000-000000000300',
  })
  if (!completed.ok) throw new Error(completed.message)
  return completed.state
}

const recorder: BasketballRecorderSummary = {
  recorderId,
  displayName: 'Recorder One',
  eventCount: 10,
  checkpointEventCount: 10,
  checkpointSyncedAt: '2026-08-16T18:11:00.000Z',
  checkpointCurrent: true,
  unresolvedConflictCount: 0,
  isPrimary: true,
  primarySource: 'selected',
  canSelectPrimary: true,
}

function recorderProjection(state = completedState()): BasketballRecorderProjection {
  return {
    recorder,
    state,
    eventStream: state.eventStream!,
    inspection: inspectGameEventStream(state.eventStream!, gameEventRegistry),
  }
}

function readinessRow() {
  return {
    game_status: 'in_progress',
    can_finalize: true,
    can_reopen: false,
    primary_recorded_by: recorderId,
    primary_display_name: 'Recorder One',
    primary_ended: true,
    primary_checkpoint_current: true,
    primary_conflict_count: 0,
    primary_locked: false,
    active_publication_id: null,
    finalized_at: null,
    non_primary_attention_count: 1,
  }
}

beforeEach(() => {
  cloudMock.rpc.mockReset()
  recorderMock.loadRecorders.mockReset()
  recorderMock.loadProjection.mockReset()
})

describe('Basketball canonical snapshot contract', () => {
  it('creates a source-only versioned snapshot and round-trips it strictly', () => {
    const state = startedState()
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, state)

    expect(snapshot).toMatchObject({
      version: EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
      canonicalSchemaVersion: BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
      sportId: 'basketball',
      gameId: 'game-1',
      primaryRecorderId: recorderId,
      sportGameState: { sportId: 'basketball', version: 1 },
    })
    expect(snapshot.sportGameState).not.toHaveProperty('projection')
    expect(snapshot.sportGameState).not.toHaveProperty('capturePreferences')
    expect(parseBasketballCanonicalSnapshot(structuredClone(snapshot))).toEqual(snapshot)
  })

  it('does not retain mutable references to live event or setup state', () => {
    const state = startedState()
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, state)

    state.eventStream!.events.length = 0
    state.sportGameState!.setup.participants[0].displayName = 'Changed'

    expect(snapshot.eventStream.events).not.toHaveLength(0)
    expect(snapshot.sportGameState.setup.participants[0].displayName).not.toBe('Changed')
  })

  it('rejects unsupported versions, projection caches, and extra envelope fields', () => {
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, startedState())

    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      canonicalSchemaVersion: 2,
    })).toThrow('invalid')
    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      projection: {},
    })).toThrow('invalid')
    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      eventStream: {
        ...snapshot.eventStream,
        projection: {},
      },
    })).toThrow('invalid')
    expect(() => parseBasketballCanonicalSnapshot({
      ...snapshot,
      sportGameState: {
        ...snapshot.sportGameState,
        projection: {},
      },
    })).toThrow('invalid')
  })

  it('rejects malformed, wrong-sport, and mixed-recorder event streams', () => {
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, startedState())
    const malformed = structuredClone(snapshot)
    malformed.eventStream.events[0] = { nope: true }
    expect(() => parseBasketballCanonicalSnapshot(malformed)).toThrow('invalid events')

    const wrongSport = structuredClone(snapshot)
    const wrongSportEvent = wrongSport.eventStream.events[0] as Record<string, unknown>
    wrongSportEvent.sportId = 'soccer'
    expect(() => parseBasketballCanonicalSnapshot(wrongSport)).toThrow('invalid events')

    const mixedRecorder = structuredClone(snapshot)
    const mixedEvent = mixedRecorder.eventStream.events[0] as Record<string, unknown>
    mixedEvent.recorderUserId = 'recorder-2'
    expect(() => parseBasketballCanonicalSnapshot(mixedRecorder)).toThrow(
      'do not belong to the primary recorder'
    )
  })

  it('rejects a source that is not a healthy event-backed Basketball game', () => {
    const aggregate = { ...startedState(), gameDataAuthority: null }
    expect(() => createBasketballCanonicalSnapshot('game-1', recorderId, aggregate))
      .toThrow('unavailable')

    const wrongRecorder = startedState()
    expect(() => createBasketballCanonicalSnapshot('game-1', 'recorder-2', wrongRecorder))
      .toThrow('do not belong to the primary recorder')
  })
})

describe('Basketball finalization repository', () => {
  it('strictly parses authoritative readiness', async () => {
    cloudMock.rpc.mockResolvedValue({ data: [readinessRow()], error: null })

    await expect(loadBasketballFinalizationReadiness('game-1')).resolves.toEqual({
      gameStatus: 'in_progress',
      canFinalize: true,
      canReopen: false,
      primaryRecorderId: recorderId,
      primaryDisplayName: 'Recorder One',
      primaryEnded: true,
      primaryCheckpointCurrent: true,
      primaryConflictCount: 0,
      primaryLocked: false,
      activePublicationId: null,
      finalizedAt: null,
      nonPrimaryAttentionCount: 1,
    })

    cloudMock.rpc.mockResolvedValue({
      data: [{ ...readinessRow(), can_finalize: 'true' }],
      error: null,
    })
    await expect(loadBasketballFinalizationReadiness('game-1')).rejects.toThrow(
      'finalization capability'
    )
  })

  it('rebuilds a healthy terminal primary into an explicit review preview', async () => {
    const projection = recorderProjection()
    cloudMock.rpc.mockResolvedValue({ data: [readinessRow()], error: null })
    recorderMock.loadRecorders.mockResolvedValue([recorder])
    recorderMock.loadProjection.mockResolvedValue(projection)

    await expect(prepareBasketballFinalization('game-1')).resolves.toMatchObject({
      gameId: 'game-1',
      recorder,
      score: { tracked: 2, opponent: 0 },
      endReason: 'completed',
      snapshot: {
        canonicalSchemaVersion: BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
        primaryRecorderId: recorderId,
      },
    })
  })

  it('confirms the exact isolated primary checkpoint before returning a review', async () => {
    const projection = recorderProjection()
    let readinessCalls = 0
    cloudMock.rpc.mockImplementation((name: string) => {
      if (name === 'get_basketball_finalization_readiness') {
        readinessCalls += 1
        return Promise.resolve({
          data: [{
            ...readinessRow(),
            primary_checkpoint_current: readinessCalls > 1,
          }],
          error: null,
        })
      }
      if (name === 'confirm_basketball_primary_checkpoint_for_finalization') {
        return Promise.resolve({ data: '2026-08-16T18:11:00.000Z', error: null })
      }
      throw new Error(`Unexpected RPC: ${name}`)
    })
    recorderMock.loadRecorders.mockResolvedValue([{
      ...recorder,
      checkpointCurrent: false,
    }])
    recorderMock.loadProjection.mockResolvedValue(projection)

    await expect(prepareBasketballFinalization('game-1')).resolves.toMatchObject({
      readiness: { primaryCheckpointCurrent: true },
    })
    expect(cloudMock.rpc).toHaveBeenCalledWith(
      'confirm_basketball_primary_checkpoint_for_finalization',
      {
        p_game_id: 'game-1',
        p_primary_recorded_by: recorderId,
        p_stream_version: projection.eventStream.version,
        p_event_revisions: eventRevisionCheckpoint(projection.state),
        p_event_count: eventRevisionCheckpoint(projection.state).length,
        p_max_sequence: expect.any(Number),
        p_stream_fingerprint: eventStreamFingerprint(projection.state),
      }
    )
  })

  it('submits the exact reviewed checkpoint and parses finalization identity', async () => {
    const projection = recorderProjection()
    const preview: BasketballFinalizationPreview = {
      gameId: 'game-1',
      readiness: {
        gameStatus: 'in_progress',
        canFinalize: true,
        canReopen: false,
        primaryRecorderId: recorderId,
        primaryDisplayName: recorder.displayName,
        primaryEnded: true,
        primaryCheckpointCurrent: true,
        primaryConflictCount: 0,
        primaryLocked: false,
        activePublicationId: null,
        finalizedAt: null,
        nonPrimaryAttentionCount: 0,
      },
      recorder,
      projection,
      snapshot: createBasketballCanonicalSnapshot('game-1', recorderId, projection.state),
      score: { tracked: 2, opponent: 0 },
      endReason: 'completed',
      anchored: false,
      blockers: [],
    }
    cloudMock.rpc.mockResolvedValue({
      data: {
        publication_id: 'publication-1',
        publication_number: 1,
        primary_recorded_by: recorderId,
        finalized_at: '2026-08-16T18:12:00.000Z',
      },
      error: null,
    })

    await expect(finalizeBasketballGame(preview)).resolves.toMatchObject({
      publicationId: 'publication-1',
      publicationNumber: 1,
      primaryRecorderId: recorderId,
      score: { tracked: 2, opponent: 0 },
    })
    expect(cloudMock.rpc).toHaveBeenCalledWith('finalize_basketball_event_game', {
      p_game_id: 'game-1',
      p_primary_recorded_by: recorderId,
      p_event_revisions: eventRevisionCheckpoint(projection.state),
      p_stream_fingerprint: eventStreamFingerprint(projection.state),
      p_canonical_snapshot: preview.snapshot,
    })
  })

  it('loads and validates active Basketball publication identity', async () => {
    const snapshot = createBasketballCanonicalSnapshot('game-1', recorderId, completedState())
    cloudMock.rpc.mockResolvedValue({
      data: [{
        publication_id: 'publication-1',
        publication_number: 1,
        primary_recorded_by: recorderId,
        primary_display_name: 'Recorder One',
        canonical_snapshot: snapshot,
        snapshot_fingerprint: 'snapshot-fingerprint',
        finalized_by: 'manager-1',
        finalized_by_display_name: 'Manager One',
        finalized_at: '2026-08-16T18:12:00.000Z',
      }],
      error: null,
    })

    await expect(loadBasketballCanonicalPublication('game-1')).resolves.toMatchObject({
      publicationId: 'publication-1',
      publicationNumber: 1,
      primaryRecorderId: recorderId,
      snapshot,
    })
  })

  it('strictly parses append-only Basketball publication history', async () => {
    cloudMock.rpc.mockResolvedValue({
      data: [
        {
          publication_id: 'publication-2',
          publication_number: 2,
          primary_recorded_by: recorderId,
          primary_display_name: 'Recorder One',
          finalized_by: 'manager-1',
          finalized_by_display_name: 'Manager One',
          finalized_at: '2026-08-16T18:20:00.000Z',
          invalidated_by: null,
          invalidated_by_display_name: null,
          invalidated_at: null,
          invalidation_reason: null,
          is_active: true,
        },
        {
          publication_id: 'publication-1',
          publication_number: 1,
          primary_recorded_by: recorderId,
          primary_display_name: 'Recorder One',
          finalized_by: 'manager-1',
          finalized_by_display_name: 'Manager One',
          finalized_at: '2026-08-16T18:12:00.000Z',
          invalidated_by: 'manager-1',
          invalidated_by_display_name: 'Manager One',
          invalidated_at: '2026-08-16T18:15:00.000Z',
          invalidation_reason: 'Correct scorer',
          is_active: false,
        },
      ],
      error: null,
    })

    await expect(loadBasketballCanonicalPublicationHistory('game-1')).resolves.toMatchObject([
      { publicationNumber: 2, isActive: true, invalidatedAt: null },
      {
        publicationNumber: 1,
        isActive: false,
        invalidationReason: 'Correct scorer',
      },
    ])
    expect(cloudMock.rpc).toHaveBeenCalledWith(
      'get_basketball_canonical_publication_history_v1',
      { p_game_id: 'game-1' }
    )
  })

  it('rejects inconsistent Basketball publication history authority', async () => {
    cloudMock.rpc.mockResolvedValue({
      data: [{
        publication_id: 'publication-1',
        publication_number: 1,
        primary_recorded_by: recorderId,
        primary_display_name: 'Recorder One',
        finalized_by: 'manager-1',
        finalized_by_display_name: 'Manager One',
        finalized_at: '2026-08-16T18:12:00.000Z',
        invalidated_by: null,
        invalidated_by_display_name: null,
        invalidated_at: '2026-08-16T18:15:00.000Z',
        invalidation_reason: 'Correct scorer',
        is_active: true,
      }],
      error: null,
    })

    await expect(loadBasketballCanonicalPublicationHistory('game-1')).rejects.toThrow(
      'invalidation metadata is inconsistent'
    )
  })

  it('requires a reason and strictly parses Basketball reopen identity', async () => {
    await expect(reopenBasketballCloudGame('game-1', '  ')).rejects.toThrow(
      'reopen reason is required'
    )
    expect(cloudMock.rpc).not.toHaveBeenCalled()

    cloudMock.rpc.mockResolvedValue({
      data: {
        game_id: 'game-1',
        publication_id: 'publication-1',
        reopened_at: '2026-08-16T18:15:00.000Z',
      },
      error: null,
    })

    await expect(reopenBasketballCloudGame('game-1', '  Correct scorer  ')).resolves.toEqual({
      gameId: 'game-1',
      publicationId: 'publication-1',
      primaryRecorderId: null,
      reason: 'Correct scorer',
      mode: null,
      reopenedAt: '2026-08-16T18:15:00.000Z',
    })
    expect(cloudMock.rpc).toHaveBeenCalledWith('reopen_basketball_event_game', {
      p_game_id: 'game-1',
      p_reason: 'Correct scorer',
    })
  })

  it('rejects malformed or mismatched Basketball reopen responses', async () => {
    cloudMock.rpc.mockResolvedValue({
      data: {
        game_id: 'other-game',
        publication_id: 'publication-1',
        reopened_at: '2026-08-16T18:15:00.000Z',
      },
      error: null,
    })
    await expect(reopenBasketballCloudGame('game-1', 'Correct scorer')).rejects.toThrow(
      'different game'
    )

    cloudMock.rpc.mockResolvedValue({
      data: {
        game_id: 'game-1',
        publication_id: 'publication-1',
        reopened_at: 'not-a-date',
      },
      error: null,
    })
    await expect(reopenBasketballCloudGame('game-1', 'Correct scorer')).rejects.toThrow(
      'reopen time'
    )
  })
})

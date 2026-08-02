import { describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialCloudSyncState } from '../gameReducer'
import {
  requireSoccerEventGameState,
  type SoccerEventGameState,
} from './gameState'
import { DEFAULT_SOCCER_MATCH_RULES } from './rules'
import { createSoccerSportGameState } from './state'
import {
  loadSoccerSummaryRecordingSource,
  loadSoccerSummarySource,
  SoccerSummarySourceError,
  type SoccerSummarySourceDependencies,
} from './summarySource'
import type { SoccerCanonicalPublication } from './finalization'
import type {
  SoccerRecorderProjection,
  SoccerRecorderSummary,
} from './recorders'
import type { SoccerMatchSetup } from './types'

function state(status: string | null = 'in_progress'): SoccerEventGameState {
  const soccer = sports.find(item => item.id === 'soccer')!
  const setup: SoccerMatchSetup = {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: structuredClone(DEFAULT_SOCCER_MATCH_RULES),
    participants: [],
  }
  return {
    sport: soccer,
    gameInfo: {
      teamName: 'Tracked',
      opponentName: 'Opponent',
      tournamentName: '',
      date: '2026-07-23',
    },
    players: [],
    activePlayerId: null,
    opponentScore: 0,
    homeTeamScore: 0,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: {
      ...createInitialCloudSyncState('synced'),
      gameId: 'game-1',
      gameStatus: status,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    eventStream: { version: 1, events: [] },
    sportGameState: createSoccerSportGameState(setup),
  }
}

function recorder(): SoccerRecorderSummary {
  return {
    recorderId: 'recorder-1',
    displayName: 'Primary Recorder',
    eventCount: 0,
    checkpointEventCount: 0,
    checkpointSyncedAt: null,
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'default',
    canSelectPrimary: false,
  }
}

function projection(base: SoccerEventGameState = state()): SoccerRecorderProjection {
  return {
    recorder: recorder(),
    state: base,
    eventStream: base.eventStream!,
    inspection: {
      complete: true,
      activeEvents: [],
      deletedEvents: [],
      diagnostics: [],
    },
  }
}

function publication(): SoccerCanonicalPublication {
  const base = state('final')
  const soccerState = base.sportGameState!
  return {
    publicationId: 'publication-1',
    publicationNumber: 1,
    primaryRecorderId: 'recorder-1',
    primaryDisplayName: 'Primary Recorder',
    snapshot: {
      version: 2,
      sportId: 'soccer',
      gameId: 'game-1',
      primaryRecorderId: 'recorder-1',
      eventStream: { version: 1, events: [] },
      sportGameState: {
        sportId: 'soccer',
        version: soccerState.version,
        setup: soccerState.setup,
      },
    },
    snapshotFingerprint: 'fingerprint',
    finalizedBy: 'manager-1',
    finalizedByDisplayName: 'Manager',
    finalizedAt: '2026-07-23T12:00:00.000Z',
  }
}

function dependencies(cloudState = state()): SoccerSummarySourceDependencies {
  return {
    loadCloudState: vi.fn().mockResolvedValue(cloudState),
    loadPrimary: vi.fn().mockResolvedValue({
      recorders: [recorder()],
      primary: projection(cloudState),
    }),
    loadCanonical: vi.fn().mockResolvedValue(null),
    loadRecorders: vi.fn().mockResolvedValue([recorder()]),
    projectCanonical: vi.fn((base: GameState) => projection(requireSoccerEventGameState(base))),
  }
}

describe('loadSoccerSummarySource', () => {
  it('uses local state without a cloud read', async () => {
    const deps = dependencies()
    const result = await loadSoccerSummarySource(state(), null, deps)
    expect(result.kind).toBe('local')
    expect(result.editable).toBe(true)
    expect(deps.loadCloudState).not.toHaveBeenCalled()
  })

  it('loads the effective cloud primary without activating local state', async () => {
    const local = state()
    const deps = dependencies()
    const result = await loadSoccerSummarySource(local, 'game-1', deps)
    expect(result.kind).toBe('cloud_primary')
    expect(result.editable).toBe(false)
    expect(result.state).not.toBe(local)
    expect(deps.loadPrimary).toHaveBeenCalledWith('game-1')
  })

  it('preserves primary projection diagnostics for suppression by the summary', async () => {
    const cloudState = state()
    const deps = dependencies(cloudState)
    const unhealthy = projection(cloudState)
    unhealthy.inspection = {
      complete: false,
      activeEvents: [],
      deletedEvents: [],
      diagnostics: [{
        code: 'semantic_validation_failed',
        message: 'A later event is invalid.',
        eventId: 'event-1',
      }],
    }
    vi.mocked(deps.loadPrimary).mockResolvedValue({
      recorders: [recorder()],
      primary: unhealthy,
    })

    const result = await loadSoccerSummarySource(state(), 'game-1', deps)
    expect(result.inspection).toEqual(unhealthy.inspection)
  })

  it('resolves a bound cloud-final local route through canonical authority', async () => {
    const finalState = state('final')
    const canonical = publication()
    const deps = dependencies(finalState)
    vi.mocked(deps.loadCanonical).mockResolvedValue(canonical)

    const result = await loadSoccerSummarySource(finalState, null, deps)
    expect(result.kind).toBe('canonical')
    expect(result.editable).toBe(false)
    expect(deps.loadCloudState).toHaveBeenCalledWith('game-1')
  })

  it('fails closed when a final game has no canonical publication', async () => {
    const deps = dependencies(state('final'))
    await expect(loadSoccerSummarySource(state(), 'game-1', deps))
      .rejects.toMatchObject({
        authority: 'canonical',
        message: expect.stringContaining('no healthy canonical publication'),
      })
    expect(deps.loadPrimary).not.toHaveBeenCalled()
  })

  it('identifies invalid local summary state', async () => {
    const invalid = state()
    invalid.sport = null
    await expect(loadSoccerSummarySource(invalid, null, dependencies()))
      .rejects.toBeInstanceOf(SoccerSummarySourceError)
  })

  it('loads another recorder as isolated read-only authority', async () => {
    const deps = dependencies()
    const other = {
      ...recorder(),
      recorderId: 'recorder-2',
      displayName: 'Other Recorder',
      isPrimary: false,
    }
    vi.mocked(deps.loadPrimary).mockResolvedValue({
      recorders: [recorder(), other],
      primary: projection(),
    })
    const primary = await loadSoccerSummarySource(state(), 'game-1', deps)
    const otherProjection = projection()
    otherProjection.recorder = other
    const loadRecorder = vi.fn().mockResolvedValue(otherProjection)

    const result = await loadSoccerSummaryRecordingSource(
      primary,
      other,
      loadRecorder
    )

    expect(result.kind).toBe('cloud_recording')
    expect(result.recorder).toEqual(other)
    expect(result.recorders).toEqual([recorder(), other])
    expect(result.editable).toBe(false)
    expect(loadRecorder).toHaveBeenCalledWith(primary.state, other)
  })

  it('rejects alternate recorder review for canonical finals', async () => {
    const finalState = state('final')
    const deps = dependencies(finalState)
    vi.mocked(deps.loadCanonical).mockResolvedValue(publication())
    const canonical = await loadSoccerSummarySource(
      finalState,
      'game-1',
      deps
    )

    await expect(
      loadSoccerSummaryRecordingSource(canonical, recorder(), vi.fn())
    ).rejects.toMatchObject({ authority: 'cloud_recording' })
  })
})

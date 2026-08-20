import { describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { prepareBasketballGameStart } from './commands'
import type { BasketballCanonicalPublication } from './finalization'
import type {
  BasketballRecorderProjection,
  BasketballRecorderSummary,
} from './recorders'
import {
  BasketballSummarySourceError,
  loadBasketballSummaryRecordingSource,
  loadBasketballSummarySource,
  type BasketballSummarySourceDependencies,
} from './summarySource'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string): Player {
  return { id, name, number: '', stats: {} }
}

function state(status: string | null = 'in_progress'): GameState {
  const base = createInitialState()
  const result = prepareBasketballGameStart({
    ...base,
    gameDataAuthority: 'sport_events',
    sport: basketball,
    gameInfo: {
      teamName: 'Aces', opponentName: 'Bears', tournamentName: '', date: '2026-08-20',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One'),
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
  }, {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-20T12:00:00.000Z',
    eventId: 'aa000000-0000-4000-8000-000000000001',
    participantIds: ['aa000000-0000-4000-8000-000000000101'],
  })
  if (!result.ok) throw new Error(result.message)
  return {
    ...result.state,
    cloudSync: { ...result.state.cloudSync, gameId: 'game-1', gameStatus: status },
  }
}

function recorder(overrides: Partial<BasketballRecorderSummary> = {}): BasketballRecorderSummary {
  return {
    recorderId: 'recorder-1',
    displayName: 'Primary Recorder',
    eventCount: 2,
    checkpointEventCount: 2,
    checkpointSyncedAt: '2026-08-20T12:01:00.000Z',
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'default',
    canSelectPrimary: true,
    ...overrides,
  }
}

function projection(base = state(), selected = recorder()): BasketballRecorderProjection {
  const rebuilt = rebuildGameEventProjection(base, gameEventRegistry, gameEventProjectors)
  return {
    recorder: selected,
    state: rebuilt.state,
    eventStream: base.eventStream!,
    inspection: rebuilt.inspection,
  }
}

function dependencies(cloudState = state()): BasketballSummarySourceDependencies {
  return {
    loadCloudState: vi.fn().mockResolvedValue({ ...cloudState, eventStream: null }),
    loadRecorders: vi.fn().mockResolvedValue([recorder()]),
    loadRecorder: vi.fn().mockResolvedValue(projection(cloudState)),
    loadCanonical: vi.fn().mockResolvedValue(null),
    projectCanonical: vi.fn().mockReturnValue(projection(cloudState)),
  }
}

describe('Basketball summary source authority', () => {
  it('rebuilds a local event source without reading cloud state', async () => {
    const deps = dependencies()
    const result = await loadBasketballSummarySource(state(), null, deps)
    expect(result.kind).toBe('local')
    expect(result.inspection.complete).toBe(true)
    expect(deps.loadCloudState).not.toHaveBeenCalled()
  })

  it('loads only the cloud primary for a nonfinal game', async () => {
    const deps = dependencies()
    const result = await loadBasketballSummarySource(state(), 'game-1', deps)
    expect(result.kind).toBe('cloud_primary')
    expect(result.editable).toBe(false)
    expect(deps.loadRecorder).toHaveBeenCalledWith('game-1', recorder())
  })

  it('fails closed when a final game has no canonical publication', async () => {
    const deps = dependencies(state('final'))
    await expect(loadBasketballSummarySource(state(), 'game-1', deps))
      .rejects.toMatchObject({
        authority: 'canonical',
        message: expect.stringContaining('no healthy canonical publication'),
      })
    expect(deps.loadRecorder).not.toHaveBeenCalled()
  })

  it('loads a final canonical publication through isolated replay', async () => {
    const deps = dependencies(state('final'))
    const publication = {
      publicationId: 'publication-1',
      primaryRecorderId: 'recorder-1',
      primaryDisplayName: 'Primary Recorder',
    } as BasketballCanonicalPublication
    vi.mocked(deps.loadCanonical).mockResolvedValue(publication)
    const result = await loadBasketballSummarySource(state(), 'game-1', deps)
    expect(result.kind).toBe('canonical')
    expect(deps.projectCanonical).toHaveBeenCalledWith(
      expect.any(Object), recorder(), publication
    )
  })

  it('allows managers to inspect another recorder without blending streams', async () => {
    const other = recorder({
      recorderId: 'recorder-2', displayName: 'Other Recorder', isPrimary: false,
    })
    const deps = dependencies()
    vi.mocked(deps.loadRecorders).mockResolvedValue([recorder(), other])
    const primary = await loadBasketballSummarySource(state(), 'game-1', deps)
    const loadOther = vi.fn().mockResolvedValue(projection(state(), other))
    const result = await loadBasketballSummaryRecordingSource(primary, other, loadOther)
    expect(result.kind).toBe('cloud_recording')
    if (result.kind !== 'cloud_recording') throw new Error('Expected alternate recorder')
    expect(result.recorder.recorderId).toBe('recorder-2')
    expect(loadOther).toHaveBeenCalledWith('game-1', other)
  })

  it('rejects alternate review when recorder metadata does not grant manager access', async () => {
    const primaryRecorder = recorder({ canSelectPrimary: false })
    const other = recorder({
      recorderId: 'recorder-2', isPrimary: false, canSelectPrimary: false,
    })
    const deps = dependencies()
    vi.mocked(deps.loadRecorders).mockResolvedValue([primaryRecorder, other])
    vi.mocked(deps.loadRecorder).mockResolvedValue(projection(state(), primaryRecorder))
    const primary = await loadBasketballSummarySource(state(), 'game-1', deps)
    await expect(loadBasketballSummaryRecordingSource(primary, other, vi.fn()))
      .rejects.toBeInstanceOf(BasketballSummarySourceError)
  })
})

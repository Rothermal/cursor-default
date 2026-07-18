import { describe, expect, it } from 'vitest'
import type { GameState } from '../types'
import {
  buildGameSyncFingerprint,
  canHydrateAsActiveGame,
  currentPeriodForCloudHydrate,
  shouldBlockDiscardUnsyncedGame,
  shouldBlockManualCloudHydrate,
  shouldDeferCloudResumeHydration,
  shouldPreserveLocalAfterFinalizeSuccess,
  shouldRejectSkippedFinalSync,
  shouldSkipAutoHydrateForDifferentCloudGame,
  withLastSyncedGameFingerprint,
} from './gameSyncFingerprint'

const sport = {
  id: 'basketball',
  name: 'Basketball',
  icon: '🏀',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: '',
}

function baseState(over: Partial<GameState> = {}): GameState {
  return {
    sport,
    gameInfo: { teamName: 'A', opponentName: 'B', tournamentName: '', tournamentId: null, date: '2026-01-01' },
    players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 2 } }],
    activePlayerId: 'p1',
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: {
      seasonId: 's1',
      teamId: 't1',
      gameId: 'g1',
      gameStatus: 'in_progress',
      playerIdMap: { p1: 'p1' },
      status: 'synced',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
      lastSyncedGameFingerprint: null,
      shotChartHydrationDroppedRows: 0,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    ...over,
    eventStream: over.eventStream === undefined ? null : over.eventStream,
  }
}

describe('gameSyncFingerprint', () => {
  it('includes the raw event stream and distinguishes legacy from initialized games', () => {
    const legacy = buildGameSyncFingerprint(baseState())
    const initialized = buildGameSyncFingerprint(
      baseState({ eventStream: { version: 1, events: [] } })
    )
    const revision = buildGameSyncFingerprint(
      baseState({ eventStream: { version: 1, events: [{ id: 'e1', revision: 2 }] } })
    )

    expect(initialized).not.toBe(legacy)
    expect(revision).not.toBe(initialized)
  })

  it('canonicalizes raw event order and object keys for dirty detection', () => {
    const first = buildGameSyncFingerprint(
      baseState({
        eventStream: {
          version: 1,
          events: [{ id: 'b', payload: { z: 1, a: 2 } }, { id: 'a' }],
        },
      })
    )
    const reordered = buildGameSyncFingerprint(
      baseState({
        eventStream: {
          version: 1,
          events: [{ id: 'a' }, { payload: { a: 2, z: 1 }, id: 'b' }],
        },
      })
    )

    expect(first).toBe(reordered)
  })

  it('withLastSyncedGameFingerprint stores canonical fingerprint', () => {
    const s = baseState()
    const next = withLastSyncedGameFingerprint(s)
    expect(next.cloudSync.lastSyncedGameFingerprint).toBe(buildGameSyncFingerprint(s))
  })

  it('shouldDeferCloudResumeHydration when fingerprint differs from last synced', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const edited = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 5 } }],
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldDeferCloudResumeHydration(edited, false)).toBe(true)
  })

  it('does not defer when fingerprint matches last synced', () => {
    const s0 = baseState()
    const fp = buildGameSyncFingerprint(s0)
    const s = baseState({
      cloudSync: { ...s0.cloudSync, lastSyncedGameFingerprint: fp },
    })
    expect(shouldDeferCloudResumeHydration(s, false)).toBe(false)
  })

  it('defers when durable pending flag is set', () => {
    const s = baseState({
      cloudSync: { ...baseState().cloudSync, lastSyncedGameFingerprint: buildGameSyncFingerprint(baseState()) },
    })
    expect(shouldDeferCloudResumeHydration(s, true)).toBe(true)
  })

  it('defers when lastSyncedGameFingerprint is unknown (null)', () => {
    expect(shouldDeferCloudResumeHydration(baseState(), false)).toBe(true)
  })

  it('defers when there is no cloud game id yet', () => {
    const s = baseState({
      cloudSync: { ...baseState().cloudSync, gameId: null, lastSyncedGameFingerprint: 'x' },
    })
    expect(shouldDeferCloudResumeHydration(s, false)).toBe(true)
  })

  it('defers when current period changed since last sync', () => {
    const synced = withLastSyncedGameFingerprint(baseState({ currentPeriod: 1 }))
    const advanced = baseState({
      currentPeriod: 2,
      cloudSync: { ...synced.cloudSync },
    })
    expect(shouldDeferCloudResumeHydration(advanced, false)).toBe(true)
  })

  it('currentPeriodForCloudHydrate preserves period for same game id', () => {
    const local = baseState({ currentPeriod: 3 })
    expect(currentPeriodForCloudHydrate(local, 'g1')).toBe(3)
    expect(currentPeriodForCloudHydrate(local, 'other')).toBe(1)
  })

  it('shouldRejectSkippedFinalSync when local fingerprint differs from last synced', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const edited = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 5 } }],
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldRejectSkippedFinalSync(edited)).toBe(true)
  })

  it('does not reject skipped-final sync when fingerprint matches last synced', () => {
    const s0 = baseState()
    const fp = buildGameSyncFingerprint(s0)
    const s = baseState({
      cloudSync: { ...s0.cloudSync, lastSyncedGameFingerprint: fp },
    })
    expect(shouldRejectSkippedFinalSync(s)).toBe(false)
  })

  it('shouldBlockManualCloudHydrate mirrors shouldDeferCloudResumeHydration', () => {
    const dirty = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 5 } }],
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: buildGameSyncFingerprint(baseState()),
      },
    })
    expect(shouldBlockManualCloudHydrate(dirty, false)).toBe(true)
    expect(shouldBlockManualCloudHydrate(dirty, false)).toBe(
      shouldDeferCloudResumeHydration(dirty, false)
    )
  })

  it('rejects skipped-final sync when last synced fingerprint is unknown', () => {
    expect(shouldRejectSkippedFinalSync(baseState())).toBe(true)
  })

  it('shouldBlockDiscardUnsyncedGame allows pure local games (no cloud binding)', () => {
    const localOnly = baseState({
      cloudSync: {
        ...baseState().cloudSync,
        seasonId: null,
        teamId: null,
        gameId: null,
        lastSyncedGameFingerprint: null,
      },
    })
    // Hydrate defer still true (!gameId) — discard must not reuse that gate.
    expect(shouldBlockManualCloudHydrate(localOnly, false)).toBe(true)
    expect(shouldBlockDiscardUnsyncedGame(localOnly, false)).toBe(false)
  })

  it('shouldBlockDiscardUnsyncedGame blocks cloud team without gameId (pre-first-sync)', () => {
    const pendingCreate = baseState({
      cloudSync: {
        ...baseState().cloudSync,
        gameId: null,
        teamId: 't1',
        lastSyncedGameFingerprint: null,
      },
    })
    expect(shouldBlockDiscardUnsyncedGame(pendingCreate, false)).toBe(true)
  })

  it('shouldBlockDiscardUnsyncedGame blocks dirty cloud games and allows clean synced ones', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const clean = baseState({
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldBlockDiscardUnsyncedGame(clean, false)).toBe(false)

    const dirty = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 99 } }],
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldBlockDiscardUnsyncedGame(dirty, false)).toBe(true)
    expect(shouldBlockDiscardUnsyncedGame(clean, true)).toBe(true)
  })

  it('shouldPreserveLocalAfterFinalizeSuccess keeps fingerprint-ahead locals after cloud final', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const clean = baseState({
      cloudSync: {
        ...baseState().cloudSync,
        gameStatus: 'final',
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldPreserveLocalAfterFinalizeSuccess(clean, false)).toBe(false)

    const midFinalEdit = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 11 } }],
      cloudSync: {
        ...baseState().cloudSync,
        gameStatus: 'final',
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldPreserveLocalAfterFinalizeSuccess(midFinalEdit, false)).toBe(true)
  })

  it('shouldSkipAutoHydrateForDifferentCloudGame when local is bound to another game', () => {
    const local = baseState({
      cloudSync: {
        ...baseState().cloudSync,
        gameId: 'game-a',
        lastSyncedGameFingerprint: buildGameSyncFingerprint(baseState()),
      },
    })
    expect(shouldSkipAutoHydrateForDifferentCloudGame(local, 'game-b')).toBe(true)
    expect(shouldSkipAutoHydrateForDifferentCloudGame(local, 'game-a')).toBe(false)
    expect(shouldSkipAutoHydrateForDifferentCloudGame(local, null)).toBe(false)

    const empty = baseState({
      sport: null,
      gameInfo: null,
      cloudSync: { ...baseState().cloudSync, gameId: 'game-a' },
    })
    expect(shouldSkipAutoHydrateForDifferentCloudGame(empty, 'game-b')).toBe(false)
  })

  it('shouldRejectSkippedFinalSync still catches mid-sync edits on latest state', () => {
    const syncedFp = buildGameSyncFingerprint(baseState())
    const cleanSnapshot = baseState({
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    const latestWithEdits = baseState({
      players: [{ id: 'p1', name: 'One', number: '1', stats: { pts: 7 } }],
      cloudSync: {
        ...baseState().cloudSync,
        lastSyncedGameFingerprint: syncedFp,
      },
    })
    expect(shouldRejectSkippedFinalSync(cleanSnapshot)).toBe(false)
    expect(shouldRejectSkippedFinalSync(latestWithEdits)).toBe(true)
  })

  it('canHydrateAsActiveGame only allows in_progress and scheduled', () => {
    expect(canHydrateAsActiveGame('in_progress')).toBe(true)
    expect(canHydrateAsActiveGame('scheduled')).toBe(true)
    expect(canHydrateAsActiveGame('final')).toBe(false)
    expect(canHydrateAsActiveGame('')).toBe(false)
  })
})

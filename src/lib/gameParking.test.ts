import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../types'
import { activeCloudSyncStateAction } from './cloudSyncState'
import {
  createBasketballMatchRules,
  DEFAULT_BASKETBALL_RULES_SOURCE,
} from './basketball/rules'
import { createBasketballSportGameState } from './basketball/state'
import { prepareBasketballGameStart } from './basketball/commands'
import { gameReducer } from './gameReducer'
import {
  cloudSyncRouteForState,
  isAggregateCloudSyncEligible,
  withLastSyncedGameFingerprint,
} from './gameSyncFingerprint'
import {
  GAME_RECORD_KEY_PREFIX,
  GAME_STORAGE_KEY,
  GAMES_MANIFEST_KEY,
} from './gameStorageKeys'
import {
  activateParkedGame,
  beginNewActiveParkedGame,
  clearActiveParkedGame,
  commitGameSetupState,
  discardParkedGame,
  exportParkedGames,
  getActiveLocalGameId,
  getParkedGameRecord,
  getParkedGameStorageInfo,
  hasDirtyParkedGames,
  hasUnsyncedParkedBindingForCloudGame,
  hasUnsyncedParkedBindingForCloudSeason,
  hasUnsyncedParkedBindingForCloudTeam,
  importParkedGames,
  listDirtyParkedGameRecords,
  listParkedGames,
  loadActiveParkedGameState,
  markParkedCloudGameReopened,
  MAX_PARKED_GAMES,
  parkActiveGame,
  ParkedGameStorageError,
  parkedGameStorageErrorMessage,
  saveActiveGameState,
  saveParkedGameRecordState,
  saveParkedGameRecordStateAtomically,
} from './gameParking'

class MemoryStorage {
  protected store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

class ThrowingManifestStorage extends MemoryStorage {
  private failed = false

  setItem(key: string, value: string): void {
    if (key === GAMES_MANIFEST_KEY && !this.failed) {
      this.failed = true
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    super.setItem(key, value)
  }
}

class QuotaStorage extends MemoryStorage {
  setItem(key: string, value: string): void {
    void key
    void value
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  }
}

class ThrowingImportManifestStorage extends MemoryStorage {
  private shouldThrowManifest = false

  failManifestWrites(): void {
    this.shouldThrowManifest = true
  }

  setItem(key: string, value: string): void {
    if (key === GAMES_MANIFEST_KEY && this.shouldThrowManifest) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    super.setItem(key, value)
  }
}

class FailNthManifestWriteStorage extends MemoryStorage {
  private remaining: number | null = null

  failOnManifestWrite(number: number): void {
    this.remaining = number
  }

  setItem(key: string, value: string): void {
    if (key === GAMES_MANIFEST_KEY && this.remaining !== null) {
      this.remaining -= 1
      if (this.remaining === 0) {
        this.remaining = null
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
    }
    super.setItem(key, value)
  }
}

const basketball: SportConfig = {
  id: 'basketball',
  name: 'Basketball',
  icon: 'B',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'PTS',
}

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'G',
}

function gameState(sport: SportConfig, teamName: string, opponentName: string): GameState {
  return {
    gameDataAuthority: null,
    sport,
    gameInfo: {
      teamName,
      opponentName,
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-12',
    },
    players: [{ id: 'p1', name: 'One', number: '1', stats: {} }],
    activePlayerId: 'p1',
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: {
      seasonId: null,
      teamId: null,
      gameId: null,
      gameStatus: 'in_progress',
      playerIdMap: {},
      status: 'idle',
      lastSyncedAt: null,
      lastError: null,
      lastSyncedGameFingerprint: null,
      shotChartHydrationDroppedRows: 0,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    eventStream: null,
    sportGameState: null,
  }
}

function basketballEventSetupState(teamName: string, opponentName: string): GameState {
  return {
    ...gameState(basketball, teamName, opponentName),
    gameDataAuthority: 'sport_events',
    players: [],
    activePlayerId: null,
  }
}

function importedRecord(localGameId: string, state: GameState) {
  return {
    localGameId,
    ownerId: null,
    createdAt: '2026-07-12T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    gameState: state,
  }
}

function importPayload(records: unknown[], activeLocalGameId: string | null = null): string {
  return JSON.stringify({
    version: 1,
    exportedAt: '2026-07-12T12:00:00.000Z',
    ownerId: null,
    activeLocalGameId,
    records,
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('gameParking', () => {
  it('commits one complete setup while parking the prior active game', () => {
    const current = gameState(basketball, 'Current', 'One')
    const next = gameState(basketball, 'Next', 'Two')
    saveActiveGameState(current, null)
    const previousId = getActiveLocalGameId(null)

    const committed = commitGameSetupState(current, next, null)

    expect(committed.localGameId).not.toBe(previousId)
    expect(getActiveLocalGameId(null)).toBe(committed.localGameId)
    expect(getParkedGameRecord(committed.localGameId, null)?.gameState).toEqual(next)
    expect(getParkedGameRecord(previousId!, null)?.gameState).toEqual(current)
  })

  it('restores a parked record, manifest, and active mirror when atomic replacement fails', () => {
    const storage = new FailNthManifestWriteStorage()
    vi.stubGlobal('localStorage', storage)
    const current = gameState(basketball, 'Current', 'One')
    saveActiveGameState(current, 'user-1')
    const localGameId = getActiveLocalGameId('user-1')!
    const before = {
      manifest: localStorage.getItem(GAMES_MANIFEST_KEY),
      record: localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}${localGameId}`),
      mirror: localStorage.getItem(GAME_STORAGE_KEY),
    }
    const next = { ...current, notes: 'cloud enabled' }

    storage.failOnManifestWrite(1)
    expect(() => saveParkedGameRecordStateAtomically(
      localGameId,
      next,
      'user-1',
      { dirty: false }
    )).toThrow(ParkedGameStorageError)

    expect(localStorage.getItem(GAMES_MANIFEST_KEY)).toBe(before.manifest)
    expect(localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}${localGameId}`)).toBe(before.record)
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBe(before.mirror)
    expect(getParkedGameRecord(localGameId, 'user-1')?.gameState.notes).toBe('')
  })

  it('restores the exact prior parking state when the setup transaction fails', () => {
    const storage = new FailNthManifestWriteStorage()
    vi.stubGlobal('localStorage', storage)
    const current = gameState(basketball, 'Current', 'One')
    const next = gameState(basketball, 'Next', 'Two')
    saveActiveGameState(current, null)
    const previousId = getActiveLocalGameId(null)
    const manifestBefore = storage.getItem(GAMES_MANIFEST_KEY)
    const recordBefore = storage.getItem(`${GAME_RECORD_KEY_PREFIX}${previousId}`)
    const mirrorBefore = storage.getItem(GAME_STORAGE_KEY)
    storage.failOnManifestWrite(3)

    expect(() => commitGameSetupState(current, next, null)).toThrow(ParkedGameStorageError)

    expect(storage.getItem(GAMES_MANIFEST_KEY)).toBe(manifestBefore)
    expect(storage.getItem(`${GAME_RECORD_KEY_PREFIX}${previousId}`)).toBe(recordBefore)
    expect(storage.getItem(GAME_STORAGE_KEY)).toBe(mirrorBefore)
    expect(listParkedGames(null)).toHaveLength(1)
    expect(getActiveLocalGameId(null)).toBe(previousId)
  })

  it('updates a matching committed setup without creating another local game', () => {
    const current = gameState(basketball, 'Current', 'One')
    const next = gameState(basketball, 'Current', 'Updated')
    saveActiveGameState(current, null)
    const localGameId = getActiveLocalGameId(null)!

    const committed = commitGameSetupState(current, next, null, localGameId)

    expect(committed.localGameId).toBe(localGameId)
    expect(listParkedGames(null)).toHaveLength(1)
    expect(getParkedGameRecord(localGameId, null)?.gameState).toEqual(next)
  })

  it('fails closed before creating an unapproved Basketball Event setup slot', () => {
    const current = gameState(basketball, 'Current', 'One')
    const next = basketballEventSetupState('Next', 'Two')
    saveActiveGameState(current, null)
    const previousId = getActiveLocalGameId(null)

    expect(() => commitGameSetupState(current, next, null)).toThrow(
      'Enable New event tracker (preview)'
    )
    expect(getActiveLocalGameId(null)).toBe(previousId)
    expect(listParkedGames(null)).toHaveLength(1)

    const committed = commitGameSetupState(current, next, null, null, true)
    expect(committed.localGameId).not.toBe(previousId)
    expect(getParkedGameRecord(committed.localGameId, null)?.gameState).toEqual(next)
  })

  it('continues only the exact committed pre-start Basketball Event setup', () => {
    const current = basketballEventSetupState('Aces', 'Bears')
    saveActiveGameState(current, null)
    const localGameId = getActiveLocalGameId(null)!
    const updated = basketballEventSetupState('Aces', 'Cats')

    const committed = commitGameSetupState(current, updated, null, localGameId)
    expect(committed.localGameId).toBe(localGameId)
    expect(getParkedGameRecord(localGameId, null)?.gameState.gameInfo?.opponentName).toBe('Cats')

    expect(() => commitGameSetupState(
      { ...updated, players: [{ id: 'p1', name: 'One', number: '1', stats: {} }] },
      basketballEventSetupState('Aces', 'Dogs'),
      null,
      localGameId
    )).toThrow('Enable New event tracker (preview)')
  })
  it('round-trips marked Basketball setup intent without aggregate fallback', () => {
    const marked = {
      ...gameState(basketball, 'Wildcats', 'Tigers'),
      gameDataAuthority: 'sport_events' as const,
      players: [],
      gameInfo: null,
    }

    saveActiveGameState(marked, 'user-1')
    const restored = loadActiveParkedGameState('user-1')

    expect(restored).toMatchObject({
      gameDataAuthority: 'sport_events',
      eventStream: null,
      sportGameState: null,
    })
    expect(isAggregateCloudSyncEligible(restored!)).toBe(false)
  })

  it('round-trips an initialized local Basketball event game', () => {
    const eventBasketball: SportConfig = {
      ...basketball,
      teamCategories: [{ id: 'team', name: 'Team', color: 'blue', actions: [] }],
    }
    const before = {
      ...gameState(eventBasketball, 'Wildcats', 'Tigers'),
      gameDataAuthority: 'sport_events' as const,
    }
    const started = prepareBasketballGameStart(before, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-02T16:00:00.000Z',
      eventId: '71000000-0000-4000-8000-000000000001',
      participantIds: ['71000000-0000-4000-8000-000000000101'],
    })
    if (!started.ok) throw new Error(started.message)

    saveActiveGameState(started.state, 'user-1')
    const restored = loadActiveParkedGameState('user-1')
    const hydrated = gameReducer(restored!, { type: 'HYDRATE_STATE', state: restored! })

    expect(restored?.gameDataAuthority).toBe('sport_events')
    expect(restored?.eventStream?.events).toHaveLength(1)
    expect(hydrated.sportGameState?.sportId).toBe('basketball')
    if (hydrated.sportGameState?.sportId === 'basketball') {
      expect(hydrated.sportGameState.projection).toMatchObject({
        status: 'in_progress',
        currentPeriodId: 'regulation-1',
      })
    }
    expect(isAggregateCloudSyncEligible(restored!)).toBe(false)
  })

  it('round-trips a confirmed local-only to automatic binding through park and reload', () => {
    const eventBasketball: SportConfig = {
      ...basketball,
      teamCategories: [{ id: 'team', name: 'Team', color: 'blue', actions: [] }],
    }
    const before = {
      ...gameState(eventBasketball, 'Wildcats', 'Tigers'),
      gameDataAuthority: 'sport_events' as const,
    }
    const started = prepareBasketballGameStart(before, {
      recorderUserId: 'user-1',
      occurredAt: '2026-08-25T16:00:00.000Z',
      eventId: '71000000-0000-4000-8000-000000000011',
      participantIds: ['71000000-0000-4000-8000-000000000111'],
    })
    if (!started.ok) throw new Error(started.message)
    const localOnly: GameState = {
      ...started.state,
      cloudSync: {
        ...started.state.cloudSync,
        eventCloudPolicy: 'local_only',
      },
    }
    const [summary] = saveActiveGameState(localOnly, 'user-1')
    const automatic = withLastSyncedGameFingerprint({
      ...localOnly,
      cloudSync: {
        ...localOnly.cloudSync,
        eventCloudPolicy: 'automatic',
        gameId: 'cloud-game-1',
        gameStatus: 'in_progress',
        playerIdMap: { p1: 'cloud-p1' },
        status: 'synced',
        lastSyncedAt: '2026-08-25T16:01:00.000Z',
      },
    })

    saveParkedGameRecordStateAtomically(summary.localGameId, automatic, 'user-1', {
      dirty: false,
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
    })
    parkActiveGame('user-1')
    const resumed = activateParkedGame(summary.localGameId, 'user-1')
    const restored = loadActiveParkedGameState('user-1')

    expect(resumed?.cloudSync).toMatchObject({
      eventCloudPolicy: 'automatic',
      gameId: 'cloud-game-1',
      status: 'synced',
    })
    expect(restored).toEqual(resumed)
    expect(getParkedGameRecord(summary.localGameId, 'user-1')?.sync.dirty).toBe(false)
    expect(cloudSyncRouteForState(restored!)).toBe('basketball_events')
    expect(isAggregateCloudSyncEligible(restored!)).toBe(false)
  })

  it('round-trips recognized Basketball event setup without trusting persisted projection', () => {
    const base = gameState(basketball, 'Wildcats', 'Tigers')
    const sportGameState = createBasketballSportGameState({
      version: 1,
      trackedTeamDesignation: 'home',
      sourceTeamId: 'team-1',
      sourceSeasonId: 'season-1',
      rulesSource: structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
      rulesSnapshot: createBasketballMatchRules(),
      participants: [{
        id: 'match-p1',
        playerId: 'p1',
        displayName: 'One',
        number: '1',
        teamSide: 'tracked',
        initialStatus: 'starter',
        position: null,
        captain: false,
      }],
    })
    sportGameState.projection.status = 'ended'
    sportGameState.capturePreferences.courtOrientation = 'flipped'

    saveActiveGameState({ ...base, sportGameState }, 'user-1')
    const restored = loadActiveParkedGameState('user-1')

    expect(restored?.sportGameState?.sportId).toBe('basketball')
    if (restored?.sportGameState?.sportId !== 'basketball') {
      throw new Error('Expected parked Basketball state.')
    }
    expect(restored.sportGameState.projection.status).toBe('not_started')
    expect(restored.sportGameState.capturePreferences.courtOrientation).toBe('flipped')
    expect(restored.sportGameState.setup.participants[0]?.id).toBe('match-p1')
  })

  it('migrates the legacy single-game key into an active parked record', () => {
    const legacy = gameState(basketball, 'Wildcats', 'Tigers')
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(legacy))

    const restored = loadActiveParkedGameState('user-1')
    const summaries = listParkedGames('user-1')

    expect(restored?.gameInfo?.teamName).toBe('Wildcats')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      sportId: 'basketball',
      sportName: 'Basketball',
      teamName: 'Wildcats',
      opponentName: 'Tigers',
    })
    expect(getActiveLocalGameId('user-1')).toBe(summaries[0].localGameId)
  })

  it('preserves the legacy game if migration cannot write the manifest', () => {
    vi.stubGlobal('localStorage', new ThrowingManifestStorage())
    const legacy = gameState(basketball, 'Wildcats', 'Tigers')
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(legacy))

    const restored = loadActiveParkedGameState('user-1')

    expect(restored).toBeNull()
    expect(JSON.parse(localStorage.getItem(GAME_STORAGE_KEY) ?? '{}')).toMatchObject({
      gameInfo: { teamName: 'Wildcats', opponentName: 'Tigers' },
    })
    expect(localStorage.getItem(GAMES_MANIFEST_KEY)).toBeNull()
    expect(listParkedGames('user-1')).toHaveLength(1)
  })

  it('keeps parked games for different sports as separate records', () => {
    saveActiveGameState(gameState(basketball, 'Wildcats', 'Tigers'), 'user-1')
    parkActiveGame('user-1')
    beginNewActiveParkedGame('user-1')
    saveActiveGameState(gameState(soccer, 'Wildcats', 'Hawks'), 'user-1')

    const summaries = listParkedGames('user-1')
    const sportIds = summaries.map(summary => summary.sportId).sort()

    expect(summaries).toHaveLength(2)
    expect(sportIds).toEqual(['basketball', 'soccer'])
    expect(new Set(summaries.map(summary => summary.localGameId)).size).toBe(2)
  })

  it('parks the active game without deleting its record', () => {
    const summaries = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), null)
    const localGameId = summaries[0].localGameId

    parkActiveGame(null)

    expect(getActiveLocalGameId(null)).toBeNull()
    expect(localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}${localGameId}`)).not.toBeNull()
    expect(listParkedGames(null)).toHaveLength(1)
  })

  it('activates a parked game and restores its state', () => {
    saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), null)
    parkActiveGame(null)
    const [summary] = listParkedGames(null)

    const restored = activateParkedGame(summary.localGameId, null)

    expect(restored?.sport?.id).toBe('basketball')
    expect(restored?.gameInfo?.opponentName).toBe('Bears')
    expect(getActiveLocalGameId(null)).toBe(summary.localGameId)
  })

  it('clears an empty active state as a discard instead of leaving a blank parked row', () => {
    saveActiveGameState(gameState(soccer, 'Aces', 'Hawks'), null)
    const activeId = getActiveLocalGameId(null)

    saveActiveGameState({ ...gameState(soccer, '', ''), sport: null, gameInfo: null, players: [] }, null)

    expect(activeId).not.toBeNull()
    expect(listParkedGames(null)).toEqual([])
    expect(localStorage.getItem(GAMES_MANIFEST_KEY)).not.toContain(activeId!)
  })

  it('marks unsynced records dirty and clears dirty when the snapshot fingerprint is synced', () => {
    const [summary] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    const dirtyRecord = getParkedGameRecord(summary.localGameId, 'user-1')

    expect(dirtyRecord?.sync.dirty).toBe(true)
    expect(listDirtyParkedGameRecords('user-1').map(record => record.localGameId)).toEqual([
      summary.localGameId,
    ])

    const syncedState = withLastSyncedGameFingerprint(dirtyRecord!.gameState)
    saveParkedGameRecordState(summary.localGameId, syncedState, 'user-1')

    expect(getParkedGameRecord(summary.localGameId, 'user-1')?.sync.dirty).toBe(false)
    expect(listDirtyParkedGameRecords('user-1')).toEqual([])
  })

  it('blocks cloud game/team/season deletes when a parked (non-active) binding is still unsynced', () => {
    const dirtyCloud: GameState = {
      ...gameState(basketball, 'Aces', 'Bears'),
      players: [{ id: 'p1', name: 'One', number: '1', stats: { '2pt': 2 } }],
      cloudSync: {
        ...gameState(basketball, 'Aces', 'Bears').cloudSync,
        seasonId: 'season-parked',
        teamId: 'team-parked',
        gameId: 'game-parked',
        gameStatus: 'in_progress',
        lastSyncedGameFingerprint: 'stale',
      },
    }
    saveActiveGameState(dirtyCloud, 'user-1')
    parkActiveGame('user-1')
    beginNewActiveParkedGame('user-1')
    saveActiveGameState(gameState(soccer, 'Aces', 'Hawks'), 'user-1')

    expect(hasUnsyncedParkedBindingForCloudGame('user-1', 'game-parked')).toBe(true)
    expect(hasUnsyncedParkedBindingForCloudTeam('user-1', 'team-parked')).toBe(true)
    expect(hasUnsyncedParkedBindingForCloudSeason('user-1', 'season-parked')).toBe(true)
    expect(hasUnsyncedParkedBindingForCloudGame('user-1', 'game-other')).toBe(false)
    expect(hasUnsyncedParkedBindingForCloudTeam('user-1', 'team-other')).toBe(false)
    expect(hasUnsyncedParkedBindingForCloudSeason('user-1', 'season-other')).toBe(false)

    const parked = listParkedGames('user-1').find(game => game.cloudGameId === 'game-parked')
    expect(parked).toBeTruthy()
    const syncedParked = withLastSyncedGameFingerprint(
      getParkedGameRecord(parked!.localGameId, 'user-1')!.gameState
    )
    saveParkedGameRecordState(parked!.localGameId, syncedParked, 'user-1')

    expect(hasUnsyncedParkedBindingForCloudGame('user-1', 'game-parked')).toBe(false)
    expect(hasUnsyncedParkedBindingForCloudTeam('user-1', 'team-parked')).toBe(false)
    expect(hasUnsyncedParkedBindingForCloudSeason('user-1', 'season-parked')).toBe(false)
  })

  it('matches a legacy unsynced season binding through its cloud team id', () => {
    const legacyCloud: GameState = {
      ...gameState(basketball, 'Aces', 'Bears'),
      players: [{ id: 'p1', name: 'One', number: '1', stats: { '2pt': 2 } }],
      cloudSync: {
        ...gameState(basketball, 'Aces', 'Bears').cloudSync,
        seasonId: null,
        teamId: 'team-legacy',
        gameId: 'game-legacy',
        gameStatus: 'in_progress',
        lastSyncedGameFingerprint: 'stale',
      },
    }
    saveActiveGameState(legacyCloud, 'user-1')
    parkActiveGame('user-1')
    beginNewActiveParkedGame('user-1')
    saveActiveGameState(gameState(soccer, 'Aces', 'Hawks'), 'user-1')

    expect(hasUnsyncedParkedBindingForCloudSeason(
      'user-1',
      'season-legacy',
      new Set(['team-legacy'])
    )).toBe(true)
    expect(hasUnsyncedParkedBindingForCloudSeason(
      'user-1',
      'season-legacy',
      new Set(['team-other'])
    )).toBe(false)
  })

  it('clears inherited aggregate retry state for event-backed parked games', () => {
    const eventState: GameState = {
      ...gameState(soccer, 'Aces', 'Hawks'),
      eventStream: { version: 1, events: [] },
    }
    const incoming = {
      ...importedRecord('event-backed-game', eventState),
      sync: {
        dirty: true,
        revision: 4,
        lastEnqueuedRevision: 4,
        lastSuccessfulSyncRevision: 3,
        attempts: 2,
        lastError: 'legacy retry',
        nextAttemptAt: '2026-07-12T12:10:00.000Z',
      },
    }

    importParkedGames(importPayload([incoming]), 'user-1')

    expect(getParkedGameRecord('event-backed-game', 'user-1')?.sync).toMatchObject({
      dirty: false,
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
    })
    expect(listDirtyParkedGameRecords('user-1')).toEqual([])
  })

  it('orders dirty sync records active first, then older parked records', () => {
    const [first] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    parkActiveGame('user-1')
    beginNewActiveParkedGame('user-1')
    const [active] = saveActiveGameState(
      gameState({ ...soccer, id: 'football', name: 'Football' }, 'Aces', 'Hawks'),
      'user-1'
    )

    expect(listDirtyParkedGameRecords('user-1').map(record => record.localGameId)).toEqual([
      active.localGameId,
      first.localGameId,
    ])
  })

  it('hides dirty records from the due list until their next attempt time', () => {
    const [summary] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    const record = getParkedGameRecord(summary.localGameId, 'user-1')!
    saveParkedGameRecordState(summary.localGameId, record.gameState, 'user-1', {
      dirty: true,
      nextAttemptAt: '2026-07-12T12:01:00.000Z',
    })

    expect(
      listDirtyParkedGameRecords('user-1', new Date('2026-07-12T12:00:00.000Z'))
    ).toEqual([])
    expect(
      listDirtyParkedGameRecords('user-1', new Date('2026-07-12T12:01:00.000Z'))
    ).toHaveLength(1)
  })

  it('hydrates active recovery conflicts, pauses retry, and resumes after resolution', () => {
    const [summary] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    const record = getParkedGameRecord(summary.localGameId, 'user-1')!
    const recoveredState: GameState = {
      ...record.gameState,
      notes: 'remote merge adopted',
      cloudSync: {
        ...record.gameState.cloudSync,
        eventConflicts: [{ eventId: 'event-1' } as never],
        status: 'error',
        lastError: 'Review competing event revisions before syncing.',
      },
    }
    const activeAction = activeCloudSyncStateAction(
      recoveredState,
      { status: 'error', lastError: recoveredState.cloudSync.lastError },
      true
    )
    const activeState = gameReducer(record.gameState, activeAction)
    saveParkedGameRecordState(summary.localGameId, activeState, 'user-1', { dirty: true })

    expect(activeAction.type).toBe('HYDRATE_STATE')
    expect(activeState.notes).toBe('remote merge adopted')
    expect(activeState.cloudSync.eventConflicts).toHaveLength(1)
    expect(hasDirtyParkedGames('user-1')).toBe(true)
    expect(listDirtyParkedGameRecords('user-1')).toEqual([])

    const resolvedState: GameState = {
      ...activeState,
      cloudSync: {
        ...activeState.cloudSync,
        eventConflicts: [],
        status: 'idle',
        lastError: null,
      },
    }
    saveParkedGameRecordState(summary.localGameId, resolvedState, 'user-1', { dirty: true })

    expect(listDirtyParkedGameRecords('user-1')).toHaveLength(1)
  })

  it('shows parked summaries as pending when the latest snapshot is still dirty', () => {
    const [summary] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    const record = getParkedGameRecord(summary.localGameId, 'user-1')!
    const staleSyncedState: GameState = {
      ...record.gameState,
      cloudSync: {
        ...record.gameState.cloudSync,
        status: 'synced',
        lastSyncedGameFingerprint: 'older-snapshot',
      },
    }

    saveParkedGameRecordState(summary.localGameId, staleSyncedState, 'user-1')

    const [parked] = listParkedGames('user-1')
    expect(parked.syncDirty).toBe(true)
    expect(parked.syncStatus).toBe('idle')
  })

  it('surfaces per-record sync errors on parked summaries', () => {
    const [summary] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    const record = getParkedGameRecord(summary.localGameId, 'user-1')!

    saveParkedGameRecordState(summary.localGameId, record.gameState, 'user-1', {
      dirty: true,
      lastError: 'Cloud sync failed',
    })

    const [parked] = listParkedGames('user-1')
    expect(parked.syncDirty).toBe(true)
    expect(parked.syncStatus).toBe('error')
    expect(parked.syncLastError).toBe('Cloud sync failed')
  })

  it('exports and imports parked games', () => {
    saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    parkActiveGame('user-1')
    beginNewActiveParkedGame('user-1')
    const [activeBeforeExport] = saveActiveGameState(gameState(soccer, 'Aces', 'Hawks'), 'user-1')

    const exported = exportParkedGames('user-1')
    localStorage.clear()

    const result = importParkedGames(exported, 'user-1')

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.skippedExisting).toBe(0)
    expect(result.skippedAtCap).toBe(0)
    expect(result.skippedInvalid).toBe(0)
    expect(result.skippedCloudBinding).toBe(0)
    expect(getActiveLocalGameId('user-1')).toBeNull()
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBeNull()
    expect(activeBeforeExport.localGameId).toBeTruthy()
    expect(listParkedGames('user-1').map(game => game.sportId).sort()).toEqual([
      'basketball',
      'soccer',
    ])
  })

  it('round-trips local-only policy without restoring cloud binding or queue work', () => {
    const localOnly = {
      ...gameState(basketball, 'Local Event', 'Bears'),
      gameDataAuthority: 'sport_events' as const,
      eventStream: { version: 1, events: [] },
      sportGameState: { sportId: 'basketball', version: 1 } as never,
      cloudSync: {
        ...gameState(basketball, 'Local Event', 'Bears').cloudSync,
        eventCloudPolicy: 'local_only' as const,
        teamId: 'must-be-removed',
        seasonId: 'must-be-removed',
        gameId: 'must-be-removed',
      },
    }
    const [saved] = saveActiveGameState(localOnly, 'user-1')
    const exported = exportParkedGames('user-1')
    localStorage.clear()

    const result = importParkedGames(exported, 'user-1')
    const imported = getParkedGameRecord(saved.localGameId, 'user-1')

    expect(result.imported).toBe(1)
    expect(imported?.gameState.cloudSync).toMatchObject({
      eventCloudPolicy: 'local_only',
      teamId: null,
      seasonId: null,
      gameId: null,
    })
    expect(imported?.sync.dirty).toBe(false)
    expect(imported?.summary.eventCloudPolicy).toBe('local_only')
  })

  it('normalizes missing legacy event streams during import', () => {
    const legacy = gameState(basketball, 'Legacy', 'Bears') as Partial<GameState>
    delete legacy.eventStream

    const result = importParkedGames(
      importPayload([importedRecord('legacy-import', legacy as GameState)]),
      'user-1'
    )

    expect(result.imported).toBe(1)
    expect(getParkedGameRecord('legacy-import', 'user-1')?.gameState.eventStream).toBeNull()
  })

  it('round-trips event recovery metadata through export and import', () => {
    const recoveryState = gameState(basketball, 'Recovery', 'Bears')
    recoveryState.cloudSync = {
      ...recoveryState.cloudSync,
      gameId: 'cloud-recovery-game',
      eventSyncBase: {
        'event-1': { revision: 2, fingerprint: 'remote-fingerprint' },
      },
      eventConflicts: [{ eventId: 'event-1', conflictId: 'conflict-1' } as never],
      pendingEventConflictResolutions: [{
        eventId: 'event-2',
        conflictId: 'conflict-2',
        resolution: 'local',
      }],
    }
    const [saved] = saveActiveGameState(recoveryState, 'user-1')
    const exported = exportParkedGames('user-1')
    localStorage.clear()

    const result = importParkedGames(exported, 'user-1')
    const imported = getParkedGameRecord(saved.localGameId, 'user-1')?.gameState

    expect(result.imported).toBe(1)
    expect(imported?.cloudSync.eventSyncBase).toEqual(recoveryState.cloudSync.eventSyncBase)
    expect(imported?.cloudSync.eventConflicts).toEqual(recoveryState.cloudSync.eventConflicts)
    expect(imported?.cloudSync.pendingEventConflictResolutions).toEqual(
      recoveryState.cloudSync.pendingEventConflictResolutions
    )
  })

  it('preserves event authority while quarantining malformed imported event data', () => {
    const marked = {
      ...gameState(basketball, 'Marked', 'Bears'),
      gameDataAuthority: 'sport_events',
      eventStream: { version: 'invalid', events: 'invalid' },
      sportGameState: { sportId: 'basketball', version: 999 },
    } as unknown as GameState

    const result = importParkedGames(
      importPayload([importedRecord('marked-import', marked)]),
      'user-1'
    )
    const restored = getParkedGameRecord('marked-import', 'user-1')?.gameState

    expect(result.imported).toBe(1)
    expect(restored).toMatchObject({
      gameDataAuthority: 'sport_events',
      eventStream: null,
      sportGameState: null,
    })
    expect(isAggregateCloudSyncEligible(restored!)).toBe(false)
  })

  it('keeps existing games when imported records use the same local id', () => {
    const [existing] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    const payload = importPayload([
      importedRecord(existing.localGameId, gameState(soccer, 'Imported', 'Hawks')),
    ])

    const result = importParkedGames(payload, 'user-1')

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.skippedExisting).toBe(1)
    expect(result.skippedAtCap).toBe(0)
    expect(result.skippedInvalid).toBe(0)
    expect(result.skippedCloudBinding).toBe(0)
    expect(getParkedGameRecord(existing.localGameId, 'user-1')?.gameState.gameInfo).toMatchObject({
      teamName: 'Aces',
      opponentName: 'Bears',
    })
  })

  it('skips records that fail shallow import validation', () => {
    const result = importParkedGames(
      importPayload([
        { localGameId: 'missing-state' },
        {
          localGameId: 'missing-sport',
          gameState: {
            ...gameState(basketball, 'Aces', 'Bears'),
            sport: null,
          },
        },
      ]),
      'user-1'
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(2)
    expect(result.skippedInvalid).toBe(2)
    expect(listParkedGames('user-1')).toEqual([])
  })

  it('keeps one local record per cloud game binding during import', () => {
    const existingState = gameState(basketball, 'Aces', 'Bears')
    existingState.cloudSync.gameId = 'cloud-game-1'
    saveActiveGameState(existingState, 'user-1')

    const duplicateState = gameState(basketball, 'Imported', 'Hawks')
    duplicateState.cloudSync.gameId = 'cloud-game-1'
    const secondDuplicate = gameState(basketball, 'Imported 2', 'Owls')
    secondDuplicate.cloudSync.gameId = 'cloud-game-2'
    const thirdDuplicate = gameState(basketball, 'Imported 3', 'Foxes')
    thirdDuplicate.cloudSync.gameId = 'cloud-game-2'

    const result = importParkedGames(
      importPayload([
        importedRecord('duplicate-existing-binding', duplicateState),
        importedRecord('first-new-binding', secondDuplicate),
        importedRecord('duplicate-new-binding', thirdDuplicate),
      ]),
      'user-1'
    )

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(2)
    expect(result.skippedCloudBinding).toBe(2)
    expect(getParkedGameRecord('duplicate-existing-binding', 'user-1')).toBeNull()
    expect(getParkedGameRecord('first-new-binding', 'user-1')).not.toBeNull()
    expect(getParkedGameRecord('duplicate-new-binding', 'user-1')).toBeNull()
  })

  it('imports what fits and skips remaining valid rows at the parked-game limit', () => {
    for (let i = 0; i < MAX_PARKED_GAMES - 1; i += 1) {
      saveActiveGameState(gameState(basketball, `Team ${i}`, 'Bears'), 'user-1')
      parkActiveGame('user-1')
    }

    const result = importParkedGames(
      importPayload([
        importedRecord('import-1', gameState(soccer, 'Import 1', 'Hawks')),
        importedRecord('import-2', gameState(soccer, 'Import 2', 'Hawks')),
        importedRecord('import-3', gameState(soccer, 'Import 3', 'Hawks')),
      ]),
      'user-1'
    )

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(2)
    expect(result.skippedAtCap).toBe(2)
    expect(listParkedGames('user-1')).toHaveLength(MAX_PARKED_GAMES)
    expect(getParkedGameRecord('import-1', 'user-1')).not.toBeNull()
    expect(getParkedGameRecord('import-2', 'user-1')).toBeNull()
    expect(getParkedGameRecord('import-3', 'user-1')).toBeNull()
  })

  it('rolls back records written by an import when the final manifest write fails', () => {
    const storage = new ThrowingImportManifestStorage()
    vi.stubGlobal('localStorage', storage)
    storage.failManifestWrites()

    expect(() =>
      importParkedGames(
        importPayload([
          importedRecord('import-1', gameState(basketball, 'Aces', 'Bears')),
          importedRecord('import-2', gameState(soccer, 'Aces', 'Hawks')),
        ]),
        'user-1'
      )
    ).toThrow(ParkedGameStorageError)

    expect(localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}import-1`)).toBeNull()
    expect(localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}import-2`)).toBeNull()
    expect(localStorage.getItem(GAMES_MANIFEST_KEY)).toBeNull()
  })

  it('rejects invalid parked-game import files', () => {
    expect(() => importParkedGames('{"nope":true}', 'user-1')).toThrow(ParkedGameStorageError)
  })

  it('enforces the parked game limit before creating another local slot', () => {
    for (let i = 0; i < MAX_PARKED_GAMES; i += 1) {
      beginNewActiveParkedGame('user-1')
      saveActiveGameState(gameState(basketball, `Team ${i}`, 'Bears'), 'user-1')
      parkActiveGame('user-1')
    }

    expect(() => beginNewActiveParkedGame('user-1')).toThrow(ParkedGameStorageError)
  })

  it('maps quota failures to a parked-game storage error', () => {
    vi.stubGlobal('localStorage', new QuotaStorage())

    expect(() => saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')).toThrow(
      ParkedGameStorageError
    )
  })

  it('reports parked storage capacity for Settings', () => {
    saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    parkActiveGame('user-1')
    beginNewActiveParkedGame('user-1')
    saveActiveGameState(gameState(soccer, 'Aces', 'Hawks'), 'user-1')

    const info = getParkedGameStorageInfo('user-1')

    expect(info.parkedCount).toBe(2)
    expect(info.maxParkedGames).toBe(MAX_PARKED_GAMES)
    expect(info.canCreateParkedGame).toBe(true)
    expect(info.estimatedBytes).toBeGreaterThan(0)
  })

  it('discards a parked game and clears the active slot when needed', () => {
    const [summary] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    const localGameId = summary.localGameId

    expect(discardParkedGame(localGameId, 'user-1')).toEqual([])
    expect(getActiveLocalGameId('user-1')).toBeNull()
    expect(localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}${localGameId}`)).toBeNull()
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBeNull()
  })

  it('preserves skipped-final games whose fingerprint is still ahead of last sync', () => {
    const base = gameState(basketball, 'Aces', 'Bears')
    const synced = withLastSyncedGameFingerprint({
      ...base,
      cloudSync: {
        ...base.cloudSync,
        teamId: 'team-1',
        gameId: 'game-1',
        gameStatus: 'in_progress',
      },
      players: [{ id: 'p1', name: 'One', number: '1', stats: { '2pt': 1 } }],
    })
    const [summary] = saveActiveGameState(synced, 'user-1')

    // Mid-session edits after last sync, then cloud is finalized elsewhere (skippedFinal path).
    const unsyncedFinal: GameState = {
      ...synced,
      players: [{ id: 'p1', name: 'One', number: '1', stats: { '2pt': 3 } }],
      cloudSync: {
        ...synced.cloudSync,
        gameStatus: 'final',
        status: 'error',
        lastError: 'Game was finalized elsewhere. Unsynced stats could not be saved.',
      },
    }
    saveParkedGameRecordState(summary.localGameId, unsyncedFinal, 'user-1', {
      dirty: false,
      lastError: unsyncedFinal.cloudSync.lastError,
    })

    expect(loadActiveParkedGameState('user-1')?.players[0]?.stats['2pt']).toBe(3)
    expect(getParkedGameRecord(summary.localGameId, 'user-1')).not.toBeNull()

    // Persist effect / New Game / park all call saveActiveGameState with the final status.
    saveActiveGameState(unsyncedFinal, 'user-1')

    expect(getParkedGameRecord(summary.localGameId, 'user-1')?.gameState.players[0]?.stats['2pt']).toBe(
      3
    )
    expect(loadActiveParkedGameState('user-1')?.cloudSync.gameStatus).toBe('final')
  })

  it('still auto-discards cleanly synced final games from active storage', () => {
    const base = gameState(basketball, 'Aces', 'Bears')
    const syncedFinal = withLastSyncedGameFingerprint({
      ...base,
      cloudSync: {
        ...base.cloudSync,
        teamId: 'team-1',
        gameId: 'game-1',
        gameStatus: 'final',
        status: 'synced',
      },
    })
    const [summary] = saveActiveGameState(
      { ...syncedFinal, cloudSync: { ...syncedFinal.cloudSync, gameStatus: 'in_progress' } },
      'user-1'
    )
    saveParkedGameRecordState(summary.localGameId, syncedFinal, 'user-1', { dirty: false })

    expect(loadActiveParkedGameState('user-1')).toBeNull()
    expect(getParkedGameRecord(summary.localGameId, 'user-1')).toBeNull()

    beginNewActiveParkedGame('user-1')
    saveParkedGameRecordState(getActiveLocalGameId('user-1')!, syncedFinal, 'user-1', {
      dirty: false,
    })
    // Direct save of a clean final must clear the active slot (post-finalize path).
    const remaining = saveActiveGameState(syncedFinal, 'user-1')
    expect(remaining).toEqual([])
    expect(getActiveLocalGameId('user-1')).toBeNull()
  })

  it('restores a matching parked event binding to in progress after cloud reopen', () => {
    const base = gameState(basketball, 'Aces', 'Bears')
    const bound = withLastSyncedGameFingerprint({
      ...base,
      gameDataAuthority: 'sport_events',
      eventStream: { version: 1, events: [] },
      sportGameState: { sportId: 'basketball', version: 1 } as never,
      cloudSync: {
        ...base.cloudSync,
        teamId: 'team-1',
        gameId: 'game-1',
        gameStatus: 'in_progress',
        status: 'synced',
      },
    })
    const [summary] = saveActiveGameState(bound, 'user-1')
    saveParkedGameRecordState(summary.localGameId, {
      ...bound,
      cloudSync: {
        ...bound.cloudSync,
        gameStatus: 'final',
      },
    }, 'user-1')

    markParkedCloudGameReopened('user-1', 'game-1')

    const reopened = getParkedGameRecord(summary.localGameId, 'user-1')
    expect(reopened?.gameState.cloudSync).toMatchObject({
      gameStatus: 'in_progress',
      status: 'idle',
      lastError: null,
    })
  })

  it('clearActiveParkedGame removes only the active record', () => {
    saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    parkActiveGame('user-1')
    const parkedId = listParkedGames('user-1')[0].localGameId
    beginNewActiveParkedGame('user-1')
    saveActiveGameState(gameState(soccer, 'Aces', 'Hawks'), 'user-1')
    const activeId = getActiveLocalGameId('user-1')

    const remaining = clearActiveParkedGame('user-1')

    expect(activeId).not.toBeNull()
    expect(remaining.map(summary => summary.localGameId)).toEqual([parkedId])
    expect(getActiveLocalGameId('user-1')).toBeNull()
    expect(hasDirtyParkedGames('user-1')).toBe(true)
  })

  it('maps storage errors for Settings and GameContext banners', () => {
    expect(
      parkedGameStorageErrorMessage(
        new ParkedGameStorageError('max_parked_games', 'Too many parked games on this device.')
      )
    ).toBe('Too many parked games on this device.')
    expect(parkedGameStorageErrorMessage(new Error('boom'))).toBe(
      'Parked games could not be saved on this device.'
    )
  })
})

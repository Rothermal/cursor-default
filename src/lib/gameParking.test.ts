import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../types'
import { withLastSyncedGameFingerprint } from './gameSyncFingerprint'
import {
  GAME_RECORD_KEY_PREFIX,
  GAME_STORAGE_KEY,
  GAMES_MANIFEST_KEY,
} from './gameStorageKeys'
import {
  activateParkedGame,
  beginNewActiveParkedGame,
  getActiveLocalGameId,
  getParkedGameRecord,
  listDirtyParkedGameRecords,
  listParkedGames,
  loadActiveParkedGameState,
  parkActiveGame,
  saveActiveGameState,
  saveParkedGameRecordState,
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
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('gameParking', () => {
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

  it('orders dirty sync records active first, then older parked records', () => {
    const [first] = saveActiveGameState(gameState(basketball, 'Aces', 'Bears'), 'user-1')
    parkActiveGame('user-1')
    beginNewActiveParkedGame('user-1')
    const [active] = saveActiveGameState(gameState(soccer, 'Aces', 'Hawks'), 'user-1')

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
})

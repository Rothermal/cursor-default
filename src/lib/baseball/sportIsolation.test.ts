import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, SportConfig } from '../../types'
import { gameReducer, createInitialState } from '../gameReducer'
import {
  beginNewActiveParkedGame,
  exportParkedGames,
  importParkedGames,
  listParkedGameRecords,
  parkActiveGame,
  saveActiveGameState,
} from '../gameParking'
import {
  buildGameSyncFingerprint,
  cloudSyncRouteForState,
  isAggregateCloudSyncEligible,
  isCloudSyncEligible,
  isEventCloudSyncEligible,
} from '../gameSyncFingerprint'
import { sportSupportsLegacyAggregateCloudSync } from '../sportGameState/capabilities'
import {
  normalizeSportGameState,
  sportGameStateForFingerprint,
  sportSupportsEventGameState,
} from '../sportGameState/state'
import { baseballSportState } from './commands'
import { baseballSetup, startedGame, strikeout } from './testFixtures'

class MemoryStorage {
  private store = new Map<string, string>()
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

const sport = (id: string): SportConfig => sports.find(entry => entry.id === id)!

function legacyGame(sportId: string, teamName: string): GameState {
  return {
    ...createInitialState(),
    sport: sport(sportId),
    gameInfo: { teamName, opponentName: 'Visitors', tournamentName: '', tournamentId: null, date: '2026-09-26' },
    players: [{ id: 'p1', name: 'One', number: '1', stats: {} }],
    activePlayerId: 'p1',
  }
}

function eventBaseballGame(): GameState {
  return {
    ...strikeout(startedGame()),
    gameInfo: { teamName: 'Aces', opponentName: 'Visitors', tournamentName: '', tournamentId: null, date: '2026-09-26' },
  }
}

function reload(state: GameState): GameState {
  return gameReducer(createInitialState(), {
    type: 'HYDRATE_STATE',
    state: JSON.parse(JSON.stringify(state)) as GameState,
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('Baseball event engine isolation', () => {
  it('registers an event state without removing legacy aggregate support', () => {
    expect(sportSupportsEventGameState('baseball')).toBe(true)
    expect(sportSupportsLegacyAggregateCloudSync('baseball')).toBe(true)
  })

  it('keeps legacy aggregate Baseball on the aggregate route', () => {
    const legacy = legacyGame('baseball', 'Aces')
    expect(isAggregateCloudSyncEligible(legacy)).toBe(true)
    expect(cloudSyncRouteForState(legacy)).toBe('aggregate')
  })

  it('rejects event Baseball from every cloud route', () => {
    const state = eventBaseballGame()
    expect(state.gameDataAuthority).toBe('sport_events')
    expect(isAggregateCloudSyncEligible(state)).toBe(false)
    expect(isEventCloudSyncEligible(state)).toBe(false)
    expect(cloudSyncRouteForState(state)).toBe('unsupported')
    expect(isCloudSyncEligible(state)).toBe(false)
  })

  it('fails closed when Baseball sport state is corrupt or missing', () => {
    const state = eventBaseballGame()
    const corrupt = reload({ ...state, sportGameState: { sportId: 'baseball', version: 1 } as never })
    expect(corrupt.sportGameState).toBeNull()
    expect(corrupt.eventStream).not.toBeNull()
    expect(cloudSyncRouteForState(corrupt)).toBe('unsupported')

    const missing = { ...state, sportGameState: null }
    expect(cloudSyncRouteForState(missing)).toBe('unsupported')

    expect(normalizeSportGameState({ ...baseballSportState(state)!, sportId: 'cricket' })).toBeNull()
  })

  it('survives reload with an identical fingerprint and setup', () => {
    const state = eventBaseballGame()
    const reloaded = reload(state)
    expect(buildGameSyncFingerprint(reloaded)).toBe(buildGameSyncFingerprint(state))
    expect(baseballSportState(reloaded)?.setup).toEqual(baseballSportState(state)?.setup)
    expect(cloudSyncRouteForState(reloaded)).toBe('unsupported')
  })

  it('fingerprints Baseball setup without the Soccer snapshot-version field', () => {
    const state = eventBaseballGame()
    const fingerprint = sportGameStateForFingerprint(state.sportGameState) as Record<string, unknown>
    expect(Object.keys(fingerprint).sort()).toEqual(['setup', 'sportId', 'version'])

    const changed = {
      ...state,
      sportGameState: { ...baseballSportState(state)!, setup: baseballSetup({ rules: { scheduledInnings: 6 } }) },
    }
    expect(buildGameSyncFingerprint(changed)).not.toBe(buildGameSyncFingerprint(state))
  })

  it('parks, exports and imports alongside other sports without changing any of them', () => {
    const games = [legacyGame('basketball', 'Hoops'), legacyGame('soccer', 'Kickers'), eventBaseballGame()]
    for (const [index, game] of games.entries()) {
      if (index > 0) beginNewActiveParkedGame('user-1')
      saveActiveGameState(game, 'user-1')
      parkActiveGame('user-1')
    }
    const before = listParkedGameRecords('user-1').map(record => buildGameSyncFingerprint(record.gameState)).sort()

    const exported = exportParkedGames('user-1')
    localStorage.clear()
    const result = importParkedGames(exported, 'user-1')

    expect(result.imported).toBe(3)
    expect(result.skipped).toBe(0)
    const records = listParkedGameRecords('user-1')
    expect(records.map(record => buildGameSyncFingerprint(record.gameState)).sort()).toEqual(before)
    const baseball = records.find(record => record.gameState.sport?.id === 'baseball')!.gameState
    expect(baseballSportState(baseball)?.setup).toEqual(baseballSetup())
    expect(cloudSyncRouteForState(baseball)).toBe('unsupported')
    const basketball = records.find(record => record.gameState.sport?.id === 'basketball')!.gameState
    expect(cloudSyncRouteForState(basketball)).toBe('aggregate')
  })
})

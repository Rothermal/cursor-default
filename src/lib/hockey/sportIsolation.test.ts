import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, SportConfig } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  beginNewActiveParkedGame,
  exportParkedGames,
  importParkedGames,
  listParkedGameRecords,
  parkActiveGame,
  activateParkedGame,
  saveActiveGameState,
} from '../gameParking'
import {
  buildGameSyncFingerprint,
  cloudSyncRouteForState,
  isAggregateCloudSyncEligible,
  isCloudSyncEligible,
} from '../gameSyncFingerprint'
import { sportSupportsLegacyAggregateCloudSync } from '../sportGameState/capabilities'
import {
  normalizeSportGameState,
  sportGameStateForFingerprint,
  sportSupportsEventGameState,
} from '../sportGameState/state'
import { hockeySportState, startHockeyClock, startHockeyGame } from './live'
import { CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyMatchSetup } from './types'

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
    gameInfo: { teamName, opponentName: 'Visitors', tournamentName: '', tournamentId: null, date: '2026-09-27' },
    players: [{ id: 'p1', name: 'One', number: '1', stats: { goals: 1 } }],
    activePlayerId: 'p1',
  }
}

function eventHockeyGame(setup: HockeyMatchSetup = hockeySetup()): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(setup), ctx(0)))
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

describe('Hockey event engine isolation', () => {
  it('registers an event state without removing legacy aggregate support', () => {
    expect(sportSupportsEventGameState('hockey')).toBe(true)
    expect(sportSupportsLegacyAggregateCloudSync('hockey')).toBe(true)
  })

  it('keeps a legacy stat-grid Hockey game on the aggregate route, unchanged by reload', () => {
    const legacy = legacyGame('hockey', 'Blades')
    expect(cloudSyncRouteForState(legacy)).toBe('aggregate')
    const reloaded = reload(legacy)
    expect(reloaded.sportGameState).toBeNull()
    expect(reloaded.eventStream).toBeNull()
    expect(buildGameSyncFingerprint(reloaded)).toBe(buildGameSyncFingerprint(legacy))
  })

  it('keeps event Hockey out of every cloud route, including when its sport state is corrupt', () => {
    const state = eventHockeyGame()
    expect(state.gameDataAuthority).toBe('sport_events')
    expect(isAggregateCloudSyncEligible(state)).toBe(false)
    expect(isCloudSyncEligible(state)).toBe(false)

    const corrupt = reload({ ...state, sportGameState: { sportId: 'hockey', version: 1 } as never })
    expect(corrupt.sportGameState).toBeNull()
    expect(corrupt.eventStream).not.toBeNull()
    expect(cloudSyncRouteForState(corrupt)).toBe('unsupported')
  })

  it('rejects malformed sport state', () => {
    const valid = hockeySportState(eventHockeyGame())!
    expect(normalizeSportGameState(valid)).not.toBeNull()
    expect(normalizeSportGameState({ ...valid, version: 2 })).toBeNull()
    expect(normalizeSportGameState({ ...valid, setup: { ...valid.setup, version: 2 } })).toBeNull()
    expect(normalizeSportGameState({ ...valid, setup: { ...valid.setup, extra: true } })).toBeNull()
    const noCache = normalizeSportGameState({ ...valid, projection: null, capturePreferences: 'x' })
    expect(noCache).toMatchObject({ projection: { status: 'pregame' }, capturePreferences: { rinkFlipped: false } })
  })

  it('fingerprints setup only', () => {
    const state = eventHockeyGame()
    const fingerprint = sportGameStateForFingerprint(state.sportGameState) as Record<string, unknown>
    expect(Object.keys(fingerprint).sort()).toEqual(['setup', 'sportId', 'version'])
  })

  it.each([
    ['anchored', hockeySetup()],
    ['clockless', hockeySetup({ rules: CLOCKLESS })],
  ])('survives reload, park and resume with the %s clock, period and direction intact', (_label, setup) => {
    let state = eventHockeyGame(setup)
    if (setup.rulesSnapshot.clockModel === 'anchored') state = expectOk(startHockeyClock(state, ctx(10)))
    const before = projection(state)

    const reloaded = reload(state)
    expect(buildGameSyncFingerprint(reloaded)).toBe(buildGameSyncFingerprint(state))
    expect(projection(reloaded)).toEqual(before)

    saveActiveGameState(state, 'user-1')
    parkActiveGame('user-1')
    const [record] = listParkedGameRecords('user-1')
    const resumed = reload(activateParkedGame(record.localGameId, 'user-1')!)
    expect(buildGameSyncFingerprint(resumed)).toBe(buildGameSyncFingerprint(state))
    expect(projection(resumed)).toEqual(before)
    expect(projection(resumed).trackedAttackingDirection).toBe('left_to_right')
  })

  it('parks, exports and imports alongside legacy games without changing any of them', () => {
    const games = [legacyGame('basketball', 'Hoops'), legacyGame('hockey', 'Legacy'), eventHockeyGame()]
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
    const records = listParkedGameRecords('user-1').map(record => reload(record.gameState))
    expect(records.map(buildGameSyncFingerprint).sort()).toEqual(before)
    const routes = records.map(record => [record.sport?.id, record.sportGameState?.sportId ?? null, cloudSyncRouteForState(record)])
    expect(routes).toEqual(expect.arrayContaining([
      ['basketball', null, 'aggregate'],
      ['hockey', null, 'aggregate'],
      ['hockey', 'hockey', 'unsupported'],
    ]))
  })
})

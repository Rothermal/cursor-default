import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameAction, GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { commitGameSetupState, exportParkedGames, importParkedGames, listParkedGameRecords, saveActiveGameState } from '../gameParking'
import { buildGameSyncFingerprint, cloudSyncRouteForState, shouldBlockDiscardUnsyncedGame } from '../gameSyncFingerprint'
import { routeForResumedGame } from '../sportNavigation'
import { baseballAuthorityForHydration, canFinalizeAggregateGame, isLegacyBaseballGame, legacyBaseballBinding } from './releasePolicy'
import { finishedAggregateState } from './aggregateTestFixtures'
import { startedGame } from './testFixtures'

function legacy(): GameState {
  return { ...createInitialState(), sport: sports.find(sport => sport.id === 'baseball')!,
    gameInfo: { teamName: 'Aces', opponentName: 'Visitors', tournamentName: '', date: '2026-10-24' },
    players: [{ id: 'p1', name: 'Pat', number: '7', stats: { hit: 3, run: 2 } }], notes: 'Preserve me',
    cloudSync: { ...createInitialState().cloudSync, teamId: 'team', gameId: 'game', status: 'offline' } }
}

beforeEach(() => {
  const rows = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value), removeItem: (key: string) => rows.delete(key) })
})

describe('BSB-7D legacy retirement and preservation', () => {
  it.each([null, 'scheduled', 'in_progress', 'final'] as const)('keeps legacy %s read-only without changing facts or debt', status => {
    const state = legacy(); state.cloudSync.gameStatus = status
    const fingerprint = buildGameSyncFingerprint(state)
    const actions: GameAction[] = [
      { type: 'INCREMENT_STAT', playerId: 'p1', statId: 'hit' },
      { type: 'DECREMENT_STAT', playerId: 'p1', statId: 'hit' },
      { type: 'SET_GAME_INFO', gameInfo: { ...state.gameInfo!, opponentName: 'Changed' } },
      { type: 'SET_PLAYERS', players: [] }, { type: 'ADD_PLAYER', player: state.players[0] },
      { type: 'REMOVE_PLAYER', playerId: 'p1' }, { type: 'SET_ACTIVE_PLAYER', playerId: 'p1' },
      { type: 'SET_NOTES', notes: 'Changed' }, { type: 'SET_PERIOD', period: 2 },
      { type: 'INCREMENT_HOME_SCORE' }, { type: 'DECREMENT_HOME_SCORE' },
      { type: 'INCREMENT_OPPONENT_SCORE' }, { type: 'DECREMENT_OPPONENT_SCORE' },
      { type: 'UNDO' }, { type: 'UNDO_LAST_SHOT' }, { type: 'CLEAR_SHOT_CHART' },
      { type: 'REMOVE_LAST_SHOT' }, { type: 'INITIALIZE_EVENT_STREAM' },
      { type: 'SET_SPORT_GAME_STATE', sportGameState: startedGame().sportGameState },
      { type: 'SET_TEAM_STATS_CONFIG', config: {} },
    ]
    for (const action of actions) expect(gameReducer(state, action)).toBe(state)
    expect(buildGameSyncFingerprint(state)).toBe(fingerprint)
    expect(shouldBlockDiscardUnsyncedGame(state, true)).toBe(true)
    expect(cloudSyncRouteForState(state)).toBe('aggregate')
    expect(canFinalizeAggregateGame(state)).toBe(false)
    expect(routeForResumedGame(state)).toBe('/summary')
  })

  it('allows transport settlement, hydration and explicit resets without permitting legacy creation', () => {
    const state = legacy()
    const synced = gameReducer(state, { type: 'SET_CLOUD_SYNC_STATE', cloudSync: { status: 'synced' } })
    expect(synced.players).toEqual(state.players)
    expect(synced.cloudSync.status).toBe('synced')
    expect(gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state }).players).toEqual(state.players)
    expect(gameReducer(state, { type: 'RESET_GAME' }).sport).toBeNull()
    expect(gameReducer(state, { type: 'SET_SPORT', sport: state.sport! })).toBe(state)
    expect(() => commitGameSetupState(createInitialState(), state, null)).toThrow('event setup')
    expect(localStorage.getItem('statkeeper_games_manifest')).toBeNull()
  })

  it('preserves legacy export/import facts, notes and dirty cloud binding without initializing events', () => {
    const state = legacy(), fingerprint = buildGameSyncFingerprint(state)
    saveActiveGameState(state, 'owner')
    const exported = exportParkedGames('owner')
    const record = listParkedGameRecords('owner')[0]
    expect(record.sync.dirty).toBe(true)
    expect(JSON.parse(exported).records[0].gameState.players).toEqual(state.players)
    localStorage.removeItem('statkeeper_games_manifest')
    localStorage.removeItem(`statkeeper_game:${record.localGameId}`)
    localStorage.removeItem('statkeeper_game')
    expect(importParkedGames(exported, 'owner').imported).toBe(1)
    const imported = listParkedGameRecords('owner')[0]
    expect(buildGameSyncFingerprint(imported.gameState)).toBe(fingerprint)
    expect(imported.gameState.notes).toBe('Preserve me')
    expect(imported.gameState.eventStream).toBeNull()
    expect(imported.gameState.cloudSync.gameId).toBe('game')
    expect(imported.sync.dirty).toBe(true)
    expect(routeForResumedGame(imported.gameState)).toBe('/summary')
  })

  it('prefers the matching local binding and refuses duplicate or incompatible bindings', () => {
    const state = legacy(), record = { localGameId: 'local', gameState: state }
    expect(legacyBaseballBinding(state, [record], 'game')).toEqual({ kind: 'active' })
    expect(legacyBaseballBinding(createInitialState(), [record], 'game')).toEqual({ kind: 'parked', localGameId: 'local' })
    expect(legacyBaseballBinding(createInitialState(), [{ ...record, localGameId: 'active' }], 'game')).toEqual({ kind: 'parked', localGameId: 'active' })
    expect(legacyBaseballBinding(createInitialState(), [], 'game')).toBeNull()
    expect(() => legacyBaseballBinding(state, [record, { ...record, localGameId: 'duplicate' }], 'game')).toThrow('conflicting')
    expect(() => legacyBaseballBinding(state, [{ ...record, gameState: { ...state, gameDataAuthority: 'sport_events' } }], 'game')).toThrow('conflicting')
  })

  it.each(['eventStream', 'sportGameState'] as const)('quarantines malformed %s instead of reviving legacy capture', key => {
    const state = { ...legacy(), [key]: { broken: true } } as unknown as GameState
    expect(isLegacyBaseballGame(state)).toBe(false)
    expect(baseballAuthorityForHydration(state)).toBe('sport_events')
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state })
    expect(hydrated.gameDataAuthority).toBe('sport_events')
    expect(isLegacyBaseballGame(hydrated)).toBe(false)
    expect(cloudSyncRouteForState(hydrated)).toBe('unsupported')
    expect(routeForResumedGame(hydrated)).toBe('/game')
  })

  it('keeps current/finished and clockless Baseball events reachable with the same transport', () => {
    const event = startedGame(), finished = finishedAggregateState(event)
    expect(isLegacyBaseballGame(event)).toBe(false)
    expect(routeForResumedGame(event)).toBe('/game')
    expect(routeForResumedGame(finished)).toBe('/summary?tab=overview')
    expect(cloudSyncRouteForState(event)).not.toBe('aggregate')
    expect(canFinalizeAggregateGame(event)).toBe(false)
    expect(event.sportGameState?.sportId).toBe('baseball')
  })

  it.each(['soccer', 'hockey', 'football'])('does not retire sibling %s aggregate behavior', id => {
    const state = { ...legacy(), sport: sports.find(sport => sport.id === id)! }
    expect(isLegacyBaseballGame(state)).toBe(false)
    expect(canFinalizeAggregateGame(state)).toBe(true)
    expect(gameReducer(state, { type: 'INCREMENT_STAT', playerId: 'p1', statId: 'hit' }).players[0].stats.hit).toBe(4)
  })
})

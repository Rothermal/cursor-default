import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { sports } from '../../config/sports'
import type { GameAction, GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { commitGameSetupState, exportParkedGames, importParkedGames, listParkedGameRecords, saveActiveGameState } from '../gameParking'
import { buildGameSyncFingerprint, cloudSyncRouteForState, shouldBlockDiscardUnsyncedGame } from '../gameSyncFingerprint'
import { canFinalizeAggregateGame, isLegacyGameForSport, isRetiredLegacyGame, legacyRetiredGameBinding } from '../legacyGameRetirement'
import { routeForResumedGame } from '../sportNavigation'
import { CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame } from './testFixtures'
import { startHockeyGame } from './live'
import { isHockeySummaryRoute } from './summary'

function legacy(): GameState {
  return { ...createInitialState(), sport: sports.find(sport => sport.id === 'hockey')!,
    gameInfo: { teamName: 'Blades', opponentName: 'Rivals', tournamentName: '', date: '2026-10-25' },
    players: [{ id: 'p', name: 'Pat', number: '7', stats: { goal: 3, ast: 2 } }],
    notes: 'Preserve local facts', opponentScore: 4, homeScoreAdjustment: 1,
    cloudSync: { ...createInitialState().cloudSync, gameId: 'cloud', teamId: 'team', status: 'offline' } }
}
beforeEach(() => {
  const rows = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value), removeItem: (key: string) => rows.delete(key) })
})

describe('TUI-2 Hockey legacy retirement', () => {
  it.each([null, 'scheduled', 'in_progress', 'final'] as const)('preserves %s history while refusing aggregate mutations', status => {
    const state = legacy(); state.cloudSync.gameStatus = status
    const before = JSON.stringify(state)
    const actions: GameAction[] = [
      { type: 'INCREMENT_STAT', playerId: 'p', statId: 'goal' }, { type: 'DECREMENT_STAT', playerId: 'p', statId: 'ast' },
      { type: 'SET_PLAYERS', players: [] }, { type: 'ADD_PLAYER', player: state.players[0] },
      { type: 'REMOVE_PLAYER', playerId: 'p' }, { type: 'SET_ACTIVE_PLAYER', playerId: 'p' },
      { type: 'SET_GAME_INFO', gameInfo: { ...state.gameInfo!, opponentName: 'Changed' } },
      { type: 'SET_NOTES', notes: 'Changed' }, { type: 'SET_PERIOD', period: 3 },
      { type: 'INCREMENT_HOME_SCORE' }, { type: 'DECREMENT_HOME_SCORE' },
      { type: 'INCREMENT_OPPONENT_SCORE' }, { type: 'DECREMENT_OPPONENT_SCORE' },
      { type: 'UNDO' }, { type: 'INITIALIZE_EVENT_STREAM' }, { type: 'SET_TEAM_STATS_CONFIG', config: {} },
      { type: 'SET_SPORT_GAME_STATE', sportGameState: initializedHockeyGame().sportGameState },
    ]
    for (const action of actions) expect(gameReducer(state, action)).toBe(state)
    expect(JSON.stringify(state)).toBe(before)
    expect(shouldBlockDiscardUnsyncedGame(state, true)).toBe(true)
    expect(cloudSyncRouteForState(state)).toBe('aggregate')
    expect(canFinalizeAggregateGame(state)).toBe(false)
    expect(isRetiredLegacyGame(state)).toBe(true)
    expect(routeForResumedGame(state)).toBe('/summary')
  })

  it('refuses raw creation before parking, while retaining settlement, hydration and reset', () => {
    const state = legacy()
    expect(gameReducer(createInitialState(), { type: 'SET_SPORT', sport: state.sport! }).sport).toBeNull()
    expect(() => commitGameSetupState(createInitialState(), state, 'owner')).toThrow('event setup')
    expect(localStorage.getItem('statkeeper_games_manifest')).toBeNull()
    expect(gameReducer(state, { type: 'SET_CLOUD_SYNC_STATE', cloudSync: { status: 'synced' } }).players).toEqual(state.players)
    expect(gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state }).players).toEqual(state.players)
    expect(gameReducer(state, { type: 'RESET_GAME' }).sport).toBeNull()
  })

  it('exports and imports dirty saved facts and binding without conversion or acknowledgment', () => {
    const state = legacy(), fingerprint = buildGameSyncFingerprint(state)
    saveActiveGameState(state, 'owner')
    const exported = exportParkedGames('owner'), record = listParkedGameRecords('owner')[0]
    localStorage.removeItem('statkeeper_games_manifest'); localStorage.removeItem(`statkeeper_game:${record.localGameId}`)
    localStorage.removeItem('statkeeper_game')
    expect(importParkedGames(exported, 'owner').imported).toBe(1)
    const imported = listParkedGameRecords('owner')[0]
    expect(buildGameSyncFingerprint(imported.gameState)).toBe(fingerprint)
    expect(imported.gameState.players).toEqual(state.players)
    expect(imported.gameState.notes).toBe(state.notes)
    expect(imported.gameState.eventStream).toBeNull()
    expect(imported.sync.dirty).toBe(true)
    expect(imported.summary.legacyReadOnly).toBe(true)
  })

  it('refuses duplicate, sibling and event local bindings instead of overwriting them', () => {
    const state = legacy(), record = { localGameId: 'local', gameState: state }
    expect(legacyRetiredGameBinding(state, [record], 'cloud', 'hockey')).toEqual({ kind: 'active' })
    expect(legacyRetiredGameBinding(createInitialState(), [record], 'cloud', 'hockey')).toEqual({ kind: 'parked', localGameId: 'local' })
    for (const records of [[record, { ...record, localGameId: 'duplicate' }],
      [{ ...record, gameState: { ...state, sport: sports.find(sport => sport.id === 'football')! } }],
      [{ ...record, gameState: { ...state, gameDataAuthority: 'sport_events' as const } }]]) {
      expect(() => legacyRetiredGameBinding(state, records, 'cloud', 'hockey')).toThrow('conflicting')
    }
  })

  it.each([
    ['gameDataAuthority', 'unknown'], ['eventStream', { broken: true }], ['sportGameState', { broken: true }],
    ['eventStream', false], ['eventStream', 0], ['eventStream', ''], ['sportGameState', false],
    ['sportGameState', 0], ['sportGameState', ''],
  ])('preserves malformed %s authority and refuses aggregate fallback', (key, value) => {
    const state = { ...legacy(), [key as string]: value } as unknown as GameState
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state })
    expect(hydrated.gameDataAuthority).toBe('sport_events')
    expect(isLegacyGameForSport(hydrated, 'hockey')).toBe(false)
    expect(cloudSyncRouteForState(hydrated)).toBe('unsupported')
    expect(routeForResumedGame(hydrated)).toBe('/game')
    expect(isHockeySummaryRoute(hydrated, new URLSearchParams())).toBe(true)
  })

  it.each([false, true])('commits a complete clockless=%s event game atomically and preserves the previous game', clockless => {
    const event = initializedHockeyGame(hockeySetup(clockless ? { rules: CLOCKLESS } : {}))
    const committed = commitGameSetupState(legacy(), event, 'owner')
    expect(committed.localGameId).toBeTruthy()
    expect(listParkedGameRecords('owner')).toHaveLength(2)
    expect(isRetiredLegacyGame(event)).toBe(false)
    const started = expectOk(startHockeyGame(event, ctx(0)))
    expect(routeForResumedGame(started)).toBe('/game')
    expect(cloudSyncRouteForState(started)).not.toBe('aggregate')
  })

  it('pins route interception and keeps Football aggregate tracking and finalization available', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app.match(/isLegacyGameForSport\(state, 'hockey'\) \? '\/summary' : '\/game'/g)).toHaveLength(3)
    expect(app).toContain("if (state.sport?.id === 'hockey') return isLegacyGameForSport(state, 'hockey')")
    const football = { ...legacy(), sport: sports.find(sport => sport.id === 'football')! }
    expect(gameReducer(football, { type: 'INCREMENT_STAT', playerId: 'p', statId: 'goal' }).players[0].stats.goal).toBe(4)
    expect(canFinalizeAggregateGame(football)).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { sports } from '../../config/sports'
import type { GameAction, GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { commitGameSetupState, exportParkedGames, importParkedGames, listParkedGameRecords, saveActiveGameState } from '../gameParking'
import { buildGameSyncFingerprint, cloudSyncRouteForState, shouldBlockDiscardUnsyncedGame } from '../gameSyncFingerprint'
import { canFinalizeAggregateGame, isLegacyGameForSport, isRetiredLegacyGame, legacyRetiredGameBinding } from '../legacyGameRetirement'
import { routeForResumedGame } from '../sportNavigation'
import { prepareBasketballGameStart } from './commands'

const basketball = sports.find(sport => sport.id === 'basketball')!
function legacy(): GameState {
  return { ...createInitialState(), sport: basketball,
    gameInfo: { teamName: 'Aces', opponentName: 'Visitors', tournamentName: '', date: '2026-10-24' },
    players: [{ id: 'p', name: 'Pat', number: '7', stats: { '2pt': 3, ast: 2 } }],
    notes: 'Preserve local facts', opponentScore: 4, homeScoreAdjustment: 1,
    shotChart: [{ id: 'shot', playerId: 'p', x: 0, y: 8, made: true, shotType: '2pt', zone: 'paint', timestamp: 1 }],
    cloudSync: { ...createInitialState().cloudSync, gameId: 'cloud', teamId: 'team', status: 'offline' } }
}
beforeEach(() => {
  const rows = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value), removeItem: (key: string) => rows.delete(key) })
})

describe('TUI-1 Basketball legacy retirement', () => {
  it.each([null, 'scheduled', 'in_progress', 'final'] as const)('preserves legacy %s facts and sync debt while refusing capture', status => {
    const state = legacy(); state.cloudSync.gameStatus = status
    const before = buildGameSyncFingerprint(state)
    const actions: GameAction[] = [
      { type: 'ADD_SHOT', shot: state.shotChart[0] }, { type: 'CLEAR_SHOT_CHART' },
      { type: 'INCREMENT_STAT', playerId: 'p', statId: 'ast' }, { type: 'DECREMENT_STAT', playerId: 'p', statId: '2pt' },
      { type: 'SET_PLAYERS', players: [] }, { type: 'ADD_PLAYER', player: state.players[0] },
      { type: 'REMOVE_PLAYER', playerId: 'p' }, { type: 'SET_ACTIVE_PLAYER', playerId: 'p' },
      { type: 'SET_GAME_INFO', gameInfo: { ...state.gameInfo!, opponentName: 'Changed' } },
      { type: 'SET_NOTES', notes: 'Changed' }, { type: 'SET_PERIOD', period: 4 },
      { type: 'INCREMENT_HOME_SCORE' }, { type: 'INCREMENT_OPPONENT_SCORE' },
      { type: 'UNDO' }, { type: 'UNDO_LAST_SHOT' }, { type: 'REMOVE_LAST_SHOT' },
      { type: 'INITIALIZE_EVENT_STREAM' }, { type: 'SET_TEAM_STATS_CONFIG', config: {} },
    ]
    for (const action of actions) expect(gameReducer(state, action)).toBe(state)
    expect(buildGameSyncFingerprint(state)).toBe(before)
    expect(shouldBlockDiscardUnsyncedGame(state, true)).toBe(true)
    expect(cloudSyncRouteForState(state)).toBe('aggregate')
    expect(routeForResumedGame(state)).toBe('/summary')
    expect(isRetiredLegacyGame(state)).toBe(true)
  })

  it('refuses raw creation before touching parking, but permits old-data settlement and reset', () => {
    const state = legacy()
    expect(gameReducer(createInitialState(), { type: 'SET_SPORT', sport: basketball }).sport).toBeNull()
    expect(() => commitGameSetupState(createInitialState(), state, 'owner', null, true)).toThrow('event setup')
    expect(localStorage.getItem('statkeeper_games_manifest')).toBeNull()
    expect(gameReducer(state, { type: 'SET_CLOUD_SYNC_STATE', cloudSync: { status: 'synced' } }).players).toEqual(state.players)
    expect(gameReducer(state, { type: 'RESET_GAME' }).sport).toBeNull()
  })

  it('round-trips dirty stats, shot rows, notes, identity and debt through export/import', () => {
    const state = legacy(), before = buildGameSyncFingerprint(state)
    saveActiveGameState(state, 'owner')
    const exported = exportParkedGames('owner'), record = listParkedGameRecords('owner')[0]
    localStorage.removeItem('statkeeper_games_manifest'); localStorage.removeItem(`statkeeper_game:${record.localGameId}`)
    localStorage.removeItem('statkeeper_game')
    expect(importParkedGames(exported, 'owner').imported).toBe(1)
    const restored = listParkedGameRecords('owner')[0]
    expect(buildGameSyncFingerprint(restored.gameState)).toBe(before)
    expect(restored.gameState.shotChart).toEqual(state.shotChart)
    expect(restored.gameState.notes).toBe(state.notes)
    expect(restored.sync.dirty).toBe(true)
    expect(restored.summary.legacyReadOnly).toBe(true)
    expect(routeForResumedGame(restored.gameState)).toBe('/summary')
  })

  it('prefers owned local bindings and refuses duplicates, sibling or event authorities', () => {
    const state = legacy(), record = { localGameId: 'local', gameState: state }
    expect(legacyRetiredGameBinding(state, [record], 'cloud', 'basketball')).toEqual({ kind: 'active' })
    expect(legacyRetiredGameBinding(createInitialState(), [record], 'cloud', 'basketball')).toEqual({ kind: 'parked', localGameId: 'local' })
    for (const records of [[record, { ...record, localGameId: 'duplicate' }],
      [{ ...record, gameState: { ...state, sport: sports.find(sport => sport.id === 'baseball')! } }],
      [{ ...record, gameState: { ...state, gameDataAuthority: 'sport_events' as const } }]]) {
      expect(() => legacyRetiredGameBinding(state, records, 'cloud', 'basketball')).toThrow('conflicting')
    }
  })

  it.each(['eventStream', 'sportGameState'] as const)('keeps corrupt %s event-marked instead of restoring aggregate capture', key => {
    const state = { ...legacy(), [key]: { broken: true } } as unknown as GameState
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state })
    expect(hydrated.gameDataAuthority).toBe('sport_events')
    expect(isRetiredLegacyGame(hydrated)).toBe(false)
    expect(cloudSyncRouteForState(hydrated)).toBe('unsupported')
  })

  it.each([
    ['gameDataAuthority', 'unknown_authority'], ['eventStream', false],
    ['eventStream', 0], ['eventStream', ''], ['sportGameState', false],
    ['sportGameState', 0], ['sportGameState', ''],
  ])('quarantines even falsey/unknown %s markers', (key, value) => {
    const state = { ...legacy(), [key as string]: value } as unknown as GameState
    expect(canFinalizeAggregateGame(state)).toBe(false)
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state })
    expect(hydrated.gameDataAuthority).toBe('sport_events')
    expect(isRetiredLegacyGame(hydrated)).toBe(false)
    expect(cloudSyncRouteForState(hydrated)).toBe('unsupported')
  })

  it('retains clockless historical event replay and tracker routing', () => {
    const setup = { ...legacy(), gameDataAuthority: 'sport_events' as const,
      players: [{ id: 'p', name: 'Pat', number: '7', stats: {} }], shotChart: [],
      opponentScore: 0, homeScoreAdjustment: 0, cloudSync: createInitialState().cloudSync }
    const started = prepareBasketballGameStart(setup, { recorderUserId: 'owner', occurredAt: '2026-10-24T12:00:00Z' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(isLegacyGameForSport(started.state, 'basketball')).toBe(false)
    expect(routeForResumedGame(started.state)).toBe('/game')
    expect(cloudSyncRouteForState(started.state)).not.toBe('aggregate')
  })

  it('pins route, correction and metadata guards while leaving sibling capture available', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app.match(/if \(isLegacyGameForSport\(state, 'basketball'\)\) return <Navigate to="\/summary" replace \/>/g)).toHaveLength(3)
    expect(app).toContain("!requestedSport && !teamId && isLegacyGameForSport(state, 'basketball')")
    const summary = readFileSync('src/pages/GameSummary.tsx', 'utf8')
    expect(summary).toContain('const legacyReadOnly = isRetiredLegacyGame(state)')
    expect(summary).toContain('if (legacyReadOnly || !correcting')
    expect(summary).toContain('if (legacyReadOnly || !gameId || !supabase) return')
    const games = readFileSync('src/pages/Games.tsx', 'utf8')
    expect(games.match(/if \(isRetiredLegacySport\(sportId\)\)/g)).toHaveLength(2)
    const sibling = { ...legacy(), sport: sports.find(sport => sport.id === 'football')! }
    expect(gameReducer(sibling, { type: 'INCREMENT_STAT', playerId: 'p', statId: 'ast' }).players[0].stats.ast).toBe(3)
  })
})

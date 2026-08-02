import { describe, expect, it } from 'vitest'
import type { GameState, Player, ShotRecord, SportConfig } from '../types'
import { TEAM_PLAYER_HOME_ID } from './teamPlayers'
import { applyUndoLastEntry, createInitialState, gameReducer } from './gameReducer'

const basketball: SportConfig = {
  id: 'basketball',
  name: 'Basketball',
  icon: 'B',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [
    {
      id: 'shooting',
      name: 'Shooting',
      color: 'amber',
      actions: [
        { id: '2pt', label: '2PT', shortLabel: '2', pointValue: 2 },
        { id: '2pt_miss', label: '2PT Miss', shortLabel: '2M' },
        { id: '3pt', label: '3PT', shortLabel: '3', pointValue: 3 },
        { id: 'ast', label: 'AST', shortLabel: 'A' },
      ],
    },
  ],
  scoreLabel: 'PTS',
}

function player(id: string, stats: Record<string, number> = {}): Player {
  return { id, name: id, number: '1', stats }
}

function shot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    id: 'shot-1',
    playerId: 'p1',
    x: 10,
    y: 20,
    made: true,
    shotType: '2pt',
    zone: 'paint',
    timestamp: 1,
    ...overrides,
  }
}

function base(over: Partial<GameState> = {}): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-15',
    },
    players: [player('p1'), player('p2')],
    activePlayerId: 'p1',
    cloudSync: {
      ...createInitialState().cloudSync,
      teamId: 'team-1',
      gameId: 'game-1',
      gameStatus: 'in_progress',
      playerIdMap: { p1: 'remote-p1', p2: 'remote-p2' },
      lastSyncedAt: '2026-07-15T00:00:00.000Z',
      lastSyncedGameFingerprint: 'fp',
    },
    ...over,
  }
}

describe('gameReducer live tracking', () => {
  it('ADD_SHOT increments the made shot stat, appends chart + undoable log', () => {
    const next = gameReducer(base(), { type: 'ADD_SHOT', shot: shot() })
    expect(next.players.find(p => p.id === 'p1')?.stats['2pt']).toBe(1)
    expect(next.shotChart).toHaveLength(1)
    expect(next.actionLog).toHaveLength(1)
    expect(next.actionLog[0]).toMatchObject({
      type: 'increment',
      playerId: 'p1',
      statId: '2pt',
      previousValue: 0,
      shotId: 'shot-1',
    })
  })

  it('ADD_SHOT is a no-op when the shooter is not on the roster', () => {
    const state = base()
    const next = gameReducer(state, {
      type: 'ADD_SHOT',
      shot: shot({ playerId: 'missing' }),
    })
    expect(next).toBe(state)
  })

  it('UNDO after ADD_SHOT restores stats and removes the shot marker', () => {
    const withShot = gameReducer(base(), { type: 'ADD_SHOT', shot: shot() })
    const undone = gameReducer(withShot, { type: 'UNDO' })
    expect(undone.players.find(p => p.id === 'p1')?.stats['2pt'] ?? 0).toBe(0)
    expect(undone.shotChart).toEqual([])
    expect(undone.actionLog).toEqual([])
  })

  it('INCREMENT_STAT with linkedShotId then UNDO restores without touching the shot chart', () => {
    const withShot = gameReducer(base(), { type: 'ADD_SHOT', shot: shot() })
    const withAssist = gameReducer(withShot, {
      type: 'INCREMENT_STAT',
      playerId: 'p2',
      statId: 'ast',
      linkedShotId: 'shot-1',
    })
    expect(withAssist.players.find(p => p.id === 'p2')?.stats.ast).toBe(1)
    expect(withAssist.actionLog[withAssist.actionLog.length - 1]?.linkedShotId).toBe('shot-1')

    const undoneAssist = gameReducer(withAssist, { type: 'UNDO' })
    expect(undoneAssist.players.find(p => p.id === 'p2')?.stats.ast ?? 0).toBe(0)
    expect(undoneAssist.shotChart).toHaveLength(1)
  })

  it('DECREMENT_STAT does not go below zero', () => {
    const state = base()
    const next = gameReducer(state, { type: 'DECREMENT_STAT', playerId: 'p1', statId: 'ast' })
    expect(next).toBe(state)
  })

  it('SET_PLAYERS keeps shot chart when only team placeholders are prepended', () => {
    const withShot = gameReducer(base(), { type: 'ADD_SHOT', shot: shot() })
    const next = gameReducer(withShot, {
      type: 'SET_PLAYERS',
      players: [
        {
          id: TEAM_PLAYER_HOME_ID,
          name: 'Aces Team',
          number: '',
          stats: {},
          isTeamPlayer: true,
        },
        ...withShot.players,
      ],
    })
    expect(next.shotChart).toHaveLength(1)
    expect(next.shotChart[0].id).toBe('shot-1')
  })

  it('SET_PLAYERS strips shots for removed roster players', () => {
    const withShot = gameReducer(base(), { type: 'ADD_SHOT', shot: shot() })
    const next = gameReducer(withShot, {
      type: 'SET_PLAYERS',
      players: [player('p2')],
    })
    expect(next.shotChart).toEqual([])
    expect(next.cloudSync.playerIdMap).toEqual({ p2: 'remote-p2' })
    // Active player remaps to the first remaining roster id when the prior active left.
    expect(next.activePlayerId).toBe('p2')
  })

  it('SET_GAME_INFO clears cloud binding when team name changes', () => {
    const next = gameReducer(base(), {
      type: 'SET_GAME_INFO',
      gameInfo: {
        teamName: 'Renamed',
        opponentName: 'Bears',
        tournamentName: '',
        tournamentId: null,
        date: '2026-07-15',
      },
    })
    expect(next.cloudSync.gameId).toBeNull()
    expect(next.cloudSync.teamId).toBeNull()
    expect(next.cloudSync.playerIdMap).toEqual({})
    expect(next.cloudSync.lastSyncedGameFingerprint).toBeNull()
  })

  it('SET_GAME_INFO keeps cloud binding when team name is unchanged', () => {
    const state = base()
    const next = gameReducer(state, {
      type: 'SET_GAME_INFO',
      gameInfo: {
        ...state.gameInfo!,
        opponentName: 'New Opp',
      },
    })
    expect(next.cloudSync.gameId).toBe('game-1')
    expect(next.cloudSync.playerIdMap).toEqual(state.cloudSync.playerIdMap)
  })

  it('INCREMENT_HOME_SCORE from derived baseline stores undo metadata to restore adjustment mode', () => {
    const state = base({
      homeTeamScore: null,
      homeScoreAdjustment: 2,
      players: [player('p1', { '2pt': 1 })],
    })
    const next = gameReducer(state, { type: 'INCREMENT_HOME_SCORE' })
    // baseline = 2pt points (2) + adjustment (2) = 4, then +1
    expect(next.homeTeamScore).toBe(5)
    expect(next.homeScoreAdjustment).toBe(0)
    expect(next.actionLog[next.actionLog.length - 1]).toMatchObject({
      type: 'home_team_score_up',
      previousHomeTeamScore: null,
      previousHomeScoreAdjustment: 2,
    })

    const undone = applyUndoLastEntry(next)!
    expect(undone.homeTeamScore).toBeNull()
    expect(undone.homeScoreAdjustment).toBe(2)
  })

  it('REMOVE_LAST_SHOT undoes matching log entry instead of orphaning the chart pop', () => {
    const withShot = gameReducer(base(), { type: 'ADD_SHOT', shot: shot() })
    const next = gameReducer(withShot, { type: 'REMOVE_LAST_SHOT' })
    expect(next.shotChart).toEqual([])
    expect(next.players.find(p => p.id === 'p1')?.stats['2pt'] ?? 0).toBe(0)
    expect(next.actionLog).toEqual([])
  })

  it('SET_PERIOD clamps invalid values to 1 and floors fractions', () => {
    expect(gameReducer(base(), { type: 'SET_PERIOD', period: 0 }).currentPeriod).toBe(1)
    expect(gameReducer(base(), { type: 'SET_PERIOD', period: Number.NaN }).currentPeriod).toBe(1)
    expect(gameReducer(base(), { type: 'SET_PERIOD', period: 2.9 }).currentPeriod).toBe(2)
  })

  it('blocks aggregate mutations as soon as event creation intent is stamped', () => {
    const marked = base({
      gameDataAuthority: 'sport_events',
      eventStream: null,
      sportGameState: null,
    })
    expect(gameReducer(marked, { type: 'INCREMENT_STAT', playerId: 'p1', statId: 'ast' }))
      .toBe(marked)
    expect(gameReducer(marked, { type: 'INCREMENT_OPPONENT_SCORE' })).toBe(marked)
    expect(gameReducer(marked, { type: 'ADD_SHOT', shot: shot() })).toBe(marked)
  })

  it('RESET_GAME preserves offline status', () => {
    const next = gameReducer(base({ cloudSync: { ...base().cloudSync, status: 'offline' } }), {
      type: 'RESET_GAME',
    })
    expect(next.sport).toBeNull()
    expect(next.cloudSync.status).toBe('offline')
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sports } from '../config/sports'
import type { GameAction, GameState } from '../types'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from './authIdentity'
import { listParkedGameRecords, saveParkedGameRecordState } from './gameParking'
import { createInitialState, gameReducer } from './gameReducer'
import { shouldBlockDiscardUnsyncedGame, withLastSyncedGameFingerprint } from './gameSyncFingerprint'
import { withOpponentLabels } from './opponentLabels'
import { relabelOpponentEverywhere } from './opponentLocalGames'

function boundGame(cloudGameId: string, team: string, opponent: string): GameState {
  const state = createInitialState()
  return {
    ...state,
    sport: sports.find(sport => sport.id === 'football')!,
    gameInfo: { teamName: team, opponentName: opponent, opponentNickname: null, tournamentName: '', date: '2026-11-08' },
    cloudSync: { ...state.cloudSync, gameId: cloudGameId, teamId: 'team-1' },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('RTN-1 opponent relabel settlement', () => {
  beforeEach(() => { localStorage.clear(); resetCurrentAuthUserIdForTests() })
  afterEach(() => { localStorage.clear(); resetCurrentAuthUserIdForTests() })

  it('relabels a parked copy and dispatches a cloud-game-keyed patch', async () => {
    setCurrentAuthUserId('user-a')
    saveParkedGameRecordState('local-1', boundGame('g1', 'Us', 'Old'), 'user-a')
    const actions: GameAction[] = []
    const outcome = await relabelOpponentEverywhere({
      userId: 'user-a', cloudGameId: 'g1', name: ' New ', nickname: ' N ',
      writeServer: async () => {}, dispatch: action => actions.push(action),
    })
    expect(outcome).toBe('updated')
    const record = listParkedGameRecords('user-a').find(item => item.localGameId === 'local-1')!
    expect(record.gameState.gameInfo).toMatchObject({ teamName: 'Us', opponentName: 'New', opponentNickname: 'N' })
    expect(record.gameState.cloudSync.gameId).toBe('g1')
    expect(actions).toEqual([{ type: 'SET_OPPONENT_LABELS', cloudGameId: 'g1', opponentName: 'New', opponentNickname: 'N' }])
  })

  it('touches no storage or state when the account changes before the server call settles', async () => {
    setCurrentAuthUserId('user-a')
    const server = deferred()
    const actions: GameAction[] = []
    const pending = relabelOpponentEverywhere({
      userId: 'user-a', cloudGameId: 'g1', name: 'New', nickname: null,
      writeServer: () => server.promise, dispatch: action => actions.push(action),
    })
    setCurrentAuthUserId('user-b')
    saveParkedGameRecordState('local-b', boundGame('g9', 'B team', 'B opp'), 'user-b')
    server.resolve()
    expect(await pending).toBe('account_changed')
    expect(actions).toEqual([])
    expect(listParkedGameRecords('user-b').map(record => record.localGameId)).toEqual(['local-b'])
  })

  it('refuses to start without a current session for that account', async () => {
    setCurrentAuthUserId('user-b')
    await expect(relabelOpponentEverywhere({
      userId: 'user-a', cloudGameId: 'g1', name: 'New', nickname: null,
      writeServer: async () => { throw new Error('should not be called') }, dispatch: () => {},
    })).rejects.toThrow(/account changed/)
  })

  it('patches only opponent fields, and only on the game still bound to that cloud game', () => {
    const gameB = boundGame('g2', 'B team', 'B opp')
    const ignored = gameReducer(gameB, { type: 'SET_OPPONENT_LABELS', cloudGameId: 'g1', opponentName: 'Renamed A', opponentNickname: null })
    expect(ignored).toBe(gameB)
    const applied = gameReducer(gameB, { type: 'SET_OPPONENT_LABELS', cloudGameId: 'g2', opponentName: 'Renamed B', opponentNickname: 'RB' })
    expect(applied.gameInfo).toMatchObject({ teamName: 'B team', opponentName: 'Renamed B', opponentNickname: 'RB' })
    expect(applied.cloudSync).toBe(gameB.cloudSync)
  })

  it('keeps an in-sync final copy in sync and droppable after a relabel', async () => {
    setCurrentAuthUserId('user-a')
    const base = boundGame('g1', 'Us', 'Old')
    const final = withLastSyncedGameFingerprint({ ...base, cloudSync: { ...base.cloudSync, gameStatus: 'final' } })
    expect(shouldBlockDiscardUnsyncedGame(final, false)).toBe(false)
    saveParkedGameRecordState('local-final', final, 'user-a')
    await relabelOpponentEverywhere({
      userId: 'user-a', cloudGameId: 'g1', name: 'New', nickname: null,
      writeServer: async () => {}, dispatch: () => {},
    })
    const record = listParkedGameRecords('user-a').find(item => item.localGameId === 'local-final')!
    expect(record.gameState.gameInfo?.opponentName).toBe('New')
    expect(shouldBlockDiscardUnsyncedGame(record.gameState, false)).toBe(false)
    // The active copy goes through the reducer and keeps the same guarantee.
    const active = gameReducer(final, { type: 'SET_OPPONENT_LABELS', cloudGameId: 'g1', opponentName: 'New', opponentNickname: null })
    expect(shouldBlockDiscardUnsyncedGame(active, false)).toBe(false)
  })

  it('keeps unsynced work on a copy that was already ahead', () => {
    const synced = withLastSyncedGameFingerprint(boundGame('g1', 'Us', 'Old'))
    const ahead = { ...synced, notes: 'unsynced note' }
    const next = withOpponentLabels(ahead, 'New', null)
    expect(next.cloudSync.lastSyncedGameFingerprint).toBe(synced.cloudSync.lastSyncedGameFingerprint)
    expect(shouldBlockDiscardUnsyncedGame({ ...next, cloudSync: { ...next.cloudSync, gameStatus: 'final' } }, false)).toBe(true)
  })
})

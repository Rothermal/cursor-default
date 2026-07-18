import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, SportConfig } from '../types'
import { TEAM_PLAYER_HOME_ID } from './teamPlayers'

const mock = vi.hoisted(() => ({
  ops: [] as string[],
  gameStatsError: 'boom' as string | null,
  shotChartDeleteError: null as string | null,
  linkUpdateError: null as string | null,
  gameDeleteError: null as string | null,
  existingGameStatus: 'in_progress' as string,
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      mock.ops.push(`${table}.from`)

      if (table === 'team_players') {
        return {
          select: () => {
            mock.ops.push('team_players.select')
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }
          },
          upsert: () => {
            mock.ops.push('team_players.upsert')
            return Promise.resolve({ error: null })
          },
        }
      }

      if (table === 'players') {
        return {
          select: () => {
            mock.ops.push('players.select')
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () =>
                      Promise.resolve({ data: [{ id: 'remote-player-1' }], error: null }),
                  }),
                }),
              }),
            }
          },
          insert: () => {
            mock.ops.push('players.insert')
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'remote-team-player' }, error: null }),
              }),
            }
          },
        }
      }

      if (table === 'games') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { status: mock.existingGameStatus },
                  error: null,
                }),
            }),
          }),
          insert: () => {
            mock.ops.push('games.insert')
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'game-1' }, error: null }),
              }),
            }
          },
          update: () => {
            mock.ops.push('games.update')
            return {
              eq: () =>
                Promise.resolve({
                  error: mock.linkUpdateError ? { message: mock.linkUpdateError } : null,
                }),
            }
          },
          delete: () => {
            mock.ops.push('games.delete')
            return {
              eq: (column: string, value: string) => {
                mock.ops.push(`games.delete.eq:${column}=${value}`)
                return {
                  eq: (column2: string, value2: string) => ({
                    eq: (column3: string, value3: string) => {
                      mock.ops.push(`games.delete.eq:${column2}=${value2}`)
                      mock.ops.push(`games.delete.eq:${column3}=${value3}`)
                      return Promise.resolve({
                        error: mock.gameDeleteError ? { message: mock.gameDeleteError } : null,
                      })
                    },
                  }),
                }
              },
            }
          },
        }
      }

      if (table === 'game_stats') {
        return {
          upsert: () => {
            mock.ops.push('game_stats.upsert')
            return Promise.resolve({
              error: mock.gameStatsError ? { message: mock.gameStatsError } : null,
            })
          },
        }
      }

      if (table === 'shot_chart') {
        return {
          delete: () => {
            mock.ops.push('shot_chart.delete')
            return {
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    error: mock.shotChartDeleteError
                      ? { message: mock.shotChartDeleteError }
                      : null,
                  }),
              }),
            }
          },
          insert: () => {
            mock.ops.push('shot_chart.insert')
            return Promise.resolve({ error: null })
          },
        }
      }

      if (table === 'client_sync_errors') {
        return {
          insert: () => {
            mock.ops.push('client_sync_errors.insert')
            return Promise.resolve({ error: null })
          },
        }
      }

      return {}
    },
  },
}))

import { syncGameSnapshotToCloud } from './cloudSync'

const basketball: SportConfig = {
  id: 'basketball',
  name: 'Basketball',
  icon: 'B',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'PTS',
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    sport: basketball,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-12',
    },
    players: [{ id: 'local-1', name: 'One Player', number: '1', stats: { pts: 2 } }],
    activePlayerId: 'local-1',
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: {
      seasonId: 'season-1',
      teamId: 'team-1',
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
    ...overrides,
    eventStream: overrides.eventStream === undefined ? null : overrides.eventStream,
    sportGameState: overrides.sportGameState === undefined ? null : overrides.sportGameState,
  }
}

describe('syncGameSnapshotToCloud hardening', () => {
  beforeEach(() => {
    mock.ops.length = 0
    mock.gameStatsError = 'boom'
    mock.shotChartDeleteError = null
    mock.linkUpdateError = null
    mock.gameDeleteError = null
    mock.existingGameStatus = 'in_progress'
  })

  it('returns skippedFinalGame without writing when the cloud game is already final', async () => {
    mock.existingGameStatus = 'final'
    mock.gameStatsError = null

    const result = await syncGameSnapshotToCloud({
      state: state({
        cloudSync: {
          ...state().cloudSync,
          gameId: 'existing-final',
          seasonId: 'season-1',
          teamId: 'team-1',
          playerIdMap: { 'local-1': 'remote-player-1' },
        },
        players: [{ id: 'local-1', name: 'One Player', number: '1', stats: { pts: 9 } }],
      }),
      userId: 'user-1',
    })

    expect(result.skippedFinalGame).toBe(true)
    expect(result.gameId).toBe('existing-final')
    expect(mock.ops).not.toContain('games.insert')
    expect(mock.ops).not.toContain('games.update')
    expect(mock.ops).not.toContain('game_stats.upsert')
    expect(mock.ops).not.toContain('games.delete')
  })

  it('resolves roster before inserting a new game and rolls that game back on child write failure', async () => {
    await expect(syncGameSnapshotToCloud({ state: state(), userId: 'user-1' })).rejects.toThrow(
      'Stats sync failed: boom'
    )

    const gameInsertIndex = mock.ops.indexOf('games.insert')

    expect(gameInsertIndex).toBeGreaterThan(-1)
    expect(mock.ops.indexOf('team_players.select')).toBeLessThan(gameInsertIndex)
    expect(mock.ops.indexOf('players.select')).toBeLessThan(gameInsertIndex)
    expect(mock.ops.indexOf('team_players.upsert')).toBeLessThan(gameInsertIndex)
    expect(mock.ops.indexOf('game_stats.upsert')).toBeGreaterThan(gameInsertIndex)
    expect(mock.ops).toContain('games.delete')
    expect(mock.ops).toContain('games.delete.eq:id=game-1')
    expect(mock.ops).toContain('games.delete.eq:created_by=user-1')
    expect(mock.ops).toContain('games.delete.eq:status=in_progress')
  })

  it('rolls back a just-created game when shot chart sync throws', async () => {
    mock.gameStatsError = null
    mock.shotChartDeleteError = 'shot chart delete failed'

    await expect(
      syncGameSnapshotToCloud({
        state: state({
          shotChart: [
            {
              id: 'shot-1',
              playerId: 'local-1',
              x: 1,
              y: 2,
              made: true,
              shotType: '2pt',
              zone: 'paint',
              timestamp: 1,
            },
          ],
        }),
        userId: 'user-1',
      })
    ).rejects.toThrow('Shot chart sync (delete) failed: shot chart delete failed')

    expect(mock.ops).toContain('shot_chart.delete')
    expect(mock.ops).toContain('games.delete')
  })

  it('rolls back a just-created game when team placeholder linking throws', async () => {
    mock.gameStatsError = null
    mock.linkUpdateError = 'link failed'

    await expect(
      syncGameSnapshotToCloud({
        state: state({
          players: [
            {
              id: TEAM_PLAYER_HOME_ID,
              name: 'Aces Team',
              number: '',
              stats: { team_foul_p1: 1 },
            },
          ],
        }),
        userId: 'user-1',
      })
    ).rejects.toThrow('Game team placeholder link failed: link failed')

    expect(mock.ops).toContain('games.update')
    expect(mock.ops).toContain('games.delete')
  })

  it('links team placeholder ids before writing their stats', async () => {
    mock.gameStatsError = null

    await syncGameSnapshotToCloud({
      state: state({
        players: [
          {
            id: TEAM_PLAYER_HOME_ID,
            name: 'Aces Team',
            number: '',
            stats: { team_foul_p1: 1 },
          },
        ],
      }),
      userId: 'user-1',
    })

    expect(mock.ops.indexOf('games.update')).toBeGreaterThan(-1)
    expect(mock.ops.indexOf('games.update')).toBeLessThan(mock.ops.indexOf('game_stats.upsert'))
  })

  it('does not delete an existing cloud game when child writes fail', async () => {
    await expect(
      syncGameSnapshotToCloud({
        state: state({
          cloudSync: {
            ...state().cloudSync,
            gameId: 'existing-game',
          },
        }),
        userId: 'user-1',
      })
    ).rejects.toThrow('Stats sync failed: boom')

    expect(mock.ops).toContain('games.update')
    expect(mock.ops).not.toContain('games.delete')
  })

  it('does not rewrite player or roster rows for an existing shared-game mapping', async () => {
    mock.gameStatsError = null

    await syncGameSnapshotToCloud({
      state: state({
        cloudSync: {
          ...state().cloudSync,
          gameId: 'existing-game',
          playerIdMap: { 'local-1': '11111111-1111-4111-8111-111111111111' },
        },
      }),
      userId: 'user-2',
    })

    expect(mock.ops).not.toContain('players.update')
    expect(mock.ops).not.toContain('team_players.upsert')
    expect(mock.ops).toContain('game_stats.upsert')
  })

  it('logs when rollback of a just-created game fails', async () => {
    mock.gameDeleteError = 'delete denied'

    await expect(syncGameSnapshotToCloud({ state: state(), userId: 'user-1' })).rejects.toThrow(
      'Stats sync failed: boom'
    )

    expect(mock.ops).toContain('games.delete')
    expect(mock.ops).toContain('client_sync_errors.insert')
  })
})

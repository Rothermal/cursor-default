import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { GameState, SportConfig } from '../types'

const mock = vi.hoisted(() => ({
  ops: [] as string[],
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
                    limit: () => Promise.resolve({ data: [{ id: 'remote-player-1' }], error: null }),
                  }),
                }),
              }),
            }
          },
        }
      }

      if (table === 'games') {
        return {
          insert: () => {
            mock.ops.push('games.insert')
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'game-1' }, error: null }),
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
                      return Promise.resolve({ error: null })
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
            return Promise.resolve({ error: { message: 'boom' } })
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

function state(): GameState {
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
  }
}

describe('syncGameSnapshotToCloud hardening', () => {
  beforeEach(() => {
    mock.ops.length = 0
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
})

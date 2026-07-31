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
  teamPlayerCandidates: [] as Array<{ player_id: string; jersey_number: string | null }>,
  teamPlayersLookupError: null as string | null,
  teamPlayersUpdateError: null as string | null,
  teamPlayersUpsertError: null as string | null,
  statUpserts: [] as Array<Array<{ player_id: string; stat_id: string; value: number }>>,
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      mock.ops.push(`${table}.from`)

      if (table === 'team_players') {
        return {
          select: () => {
            mock.ops.push('team_players.select')
            const result = {
              data: mock.teamPlayerCandidates,
              error: mock.teamPlayersLookupError
                ? { message: mock.teamPlayersLookupError }
                : null,
            }
            // Support lookups that terminate on limit() and ones that await the builder
            // directly, at any eq() depth.
            const terminal: Record<string, unknown> = {
              limit: () => Promise.resolve(result),
              then: (onOk: (v: typeof result) => unknown, onErr: (e: unknown) => unknown) =>
                Promise.resolve(result).then(onOk, onErr),
            }
            terminal.eq = () => terminal
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => terminal,
                }),
              }),
            }
          },
          upsert: () => {
            mock.ops.push('team_players.upsert')
            return Promise.resolve({
              error: mock.teamPlayersUpsertError
                ? { message: mock.teamPlayersUpsertError }
                : null,
            })
          },
          update: () => {
            mock.ops.push('team_players.update')
            return {
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    error: mock.teamPlayersUpdateError
                      ? { message: mock.teamPlayersUpdateError }
                      : null,
                  }),
              }),
            }
          },
        }
      }

      if (table === 'players') {
        return {
          delete: () => {
            mock.ops.push('players.delete')
            return {
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }
          },
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
          upsert: (rows: unknown) => {
            mock.ops.push('game_stats.upsert')
            mock.statUpserts.push(
              rows as Array<{ player_id: string; stat_id: string; value: number }>
            )
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
import { resolveSoccerMatchRules } from './soccer/rules'
import { createSoccerSportGameState } from './soccer/state'

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
    mock.teamPlayerCandidates = []
    mock.teamPlayersLookupError = null
    mock.teamPlayersUpdateError = null
    mock.teamPlayersUpsertError = null
    mock.statUpserts.length = 0
  })

  it('fails closed when the same-name teammate lookup errors', async () => {
    mock.gameStatsError = null
    mock.teamPlayersLookupError = 'roster read denied'

    // An errored lookup looks identical to "no such teammate", so resolving identity from
    // it would silently create a duplicate person out of missing information.
    await expect(syncGameSnapshotToCloud({ state: state(), userId: 'user-1' })).rejects.toThrow(
      'Team roster lookup failed'
    )
    expect(mock.ops).not.toContain('games.insert')
  })

  it('fails when linking a reused teammate to the roster errors', async () => {
    mock.gameStatsError = null
    mock.teamPlayerCandidates = [{ player_id: 'cloud-1', jersey_number: '1' }]
    mock.teamPlayersUpdateError = 'roster link denied'

    await expect(syncGameSnapshotToCloud({ state: state(), userId: 'user-1' })).rejects.toThrow(
      'Team roster link failed'
    )
    // Proves the failure came from the reuse path, not the create path.
    expect(mock.ops).toContain('team_players.update')
    expect(mock.ops).not.toContain('team_players.upsert')
  })

  it('fails when linking a newly created player to the roster errors', async () => {
    mock.gameStatsError = null
    mock.teamPlayersUpsertError = 'roster link denied'

    // A player id whose roster link failed would sync stats against a team the player is
    // not on, so a half-linked identity must not be returned.
    await expect(syncGameSnapshotToCloud({ state: state(), userId: 'user-1' })).rejects.toThrow(
      'Team roster link failed'
    )
    expect(mock.ops).toContain('team_players.upsert')
  })

  it('deletes the player it created when the roster link fails', async () => {
    mock.gameStatsError = null
    mock.teamPlayersUpsertError = 'roster link denied'

    // The unlinked row is invisible to the candidate query, which joins team_players, so
    // leaving it behind would orphan one player per retry.
    await expect(syncGameSnapshotToCloud({ state: state(), userId: 'user-1' })).rejects.toThrow(
      'Team roster link failed'
    )
    expect(mock.ops.indexOf('players.delete')).toBeGreaterThan(
      mock.ops.indexOf('team_players.upsert')
    )
  })

  it('does not delete a player it only found when the roster link fails', async () => {
    mock.gameStatsError = null
    mock.teamPlayersUpsertError = 'roster link denied'
    // Blank jersey with no same-name teammate falls back to owned-by-name, where the
    // mocked players.select returns an existing row rather than inserting one.
    mock.teamPlayerCandidates = []

    await expect(
      syncGameSnapshotToCloud({
        state: state({ players: [{ id: 'local-1', name: 'One Player', number: '', stats: {} }] }),
        userId: 'user-1',
      })
    ).rejects.toThrow('Team roster link failed')
    expect(mock.ops).not.toContain('players.insert')
    expect(mock.ops).not.toContain('players.delete')
  })

  it('repairs a duplicate cloud player link instead of blocking the sync', async () => {
    mock.gameStatsError = null
    const shared = '11111111-1111-4111-8111-111111111111'

    // A map corrupted by the old name-only matching bypasses candidate resolution
    // entirely, since a valid existing mapping short-circuits it. Failing here would be
    // worse than repairing: the only manual fix deletes the player's stats and shots.
    const result = await syncGameSnapshotToCloud({
      state: state({
        players: [
          { id: 'local-1', name: 'Alex Kim', number: '', stats: {} },
          { id: 'local-2', name: 'Alex Kim', number: '', stats: {} },
        ],
        cloudSync: {
          ...state().cloudSync,
          playerIdMap: { 'local-1': shared, 'local-2': shared },
        },
      }),
      userId: 'user-1',
    })

    expect(result.repairedPlayerLinks).toEqual(['Alex Kim'])
    // First local keeps the row; the second is re-resolved onto a different player.
    expect(result.playerIdMap['local-1']).toBe(shared)
    expect(result.playerIdMap['local-2']).not.toBe(shared)
  })

  it('clears the moved player stats left on the shared cloud player', async () => {
    mock.gameStatsError = null
    const shared = '11111111-1111-4111-8111-111111111111'

    // Disjoint stats: an earlier sync wrote both pts and reb under `shared`. Relinking
    // alone would leave reb there, so the keeper keeps counting the other player's board.
    const result = await syncGameSnapshotToCloud({
      state: state({
        players: [
          { id: 'local-1', name: 'Alex Kim', number: '', stats: { pts: 2 } },
          { id: 'local-2', name: 'Alex Kim', number: '', stats: { reb: 1 } },
        ],
        cloudSync: {
          ...state().cloudSync,
          gameId: 'game-1',
          playerIdMap: { 'local-1': shared, 'local-2': shared },
        },
      }),
      userId: 'user-1',
    })

    const moved = result.playerIdMap['local-2']
    expect(moved).not.toBe(shared)

    const [cleanup, snapshot] = mock.statUpserts
    // Only the moved player's exclusive key is zeroed; pts still belongs to the keeper.
    expect(cleanup).toEqual([
      { game_id: 'game-1', player_id: shared, recorded_by: 'user-1', stat_id: 'reb', value: 0 },
    ])
    // Cleanup lands before the snapshot, so the keeper's real values win any overlap.
    expect(snapshot).toContainEqual(
      expect.objectContaining({ player_id: shared, stat_id: 'pts', value: 2 })
    )
    expect(snapshot).toContainEqual(
      expect.objectContaining({ player_id: moved, stat_id: 'reb', value: 1 })
    )
    expect(snapshot).not.toContainEqual(
      expect.objectContaining({ player_id: shared, stat_id: 'reb' })
    )
  })

  it('does not write cleanup rows for a game this sync just created', async () => {
    mock.gameStatsError = null
    const shared = '11111111-1111-4111-8111-111111111111'

    // No prior rows can exist, so zeroing would only add noise.
    await syncGameSnapshotToCloud({
      state: state({
        players: [
          { id: 'local-1', name: 'Alex Kim', number: '', stats: { pts: 2 } },
          { id: 'local-2', name: 'Alex Kim', number: '', stats: { reb: 1 } },
        ],
        cloudSync: {
          ...state().cloudSync,
          gameId: null,
          playerIdMap: { 'local-1': shared, 'local-2': shared },
        },
      }),
      userId: 'user-1',
    })

    expect(mock.statUpserts).toHaveLength(1)
    expect(mock.statUpserts[0]).not.toContainEqual(expect.objectContaining({ value: 0 }))
  })

  it('leaves a one-to-one map untouched and reports no repair', async () => {
    mock.gameStatsError = null

    const result = await syncGameSnapshotToCloud({ state: state(), userId: 'user-1' })

    expect(result.repairedPlayerLinks).toBeUndefined()
  })

  it('rejects setup-only sport state before aggregate cloud writes', async () => {
    const soccerState = state({
      sport: { ...basketball, id: 'soccer', name: 'Soccer', scoreLabel: 'G' },
      sportGameState: createSoccerSportGameState({
        version: 1,
        trackedTeamDesignation: 'home',
        firstPeriodAttackingDirection: 'left_to_right',
        sourceTeamId: null,
        sourceSeasonId: null,
        rulesSnapshot: resolveSoccerMatchRules(),
        participants: [],
      }),
    })

    await expect(
      syncGameSnapshotToCloud({ state: soccerState, userId: 'user-1' })
    ).rejects.toThrow('cannot use aggregate cloud sync')
    expect(mock.ops).toEqual([])
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
    // Jersey-set locals without a team match create a distinct player (no name-only
    // owned lookup) so same-named teammates cannot collapse onto one cloud row.
    expect(mock.ops.indexOf('players.insert')).toBeLessThan(gameInsertIndex)
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

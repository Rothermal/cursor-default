import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, ShotRecord } from '../types'
import { syncShotChartToCloud } from './cloudSync'
import { sports } from '../config/sports'

const mocks = vi.hoisted(() => ({
  deleteEq: vi.fn(),
  upsert: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'shot_chart') {
        throw new Error(`unexpected table: ${table}`)
      }
      return {
        delete: () => ({
          eq: () => ({
            eq: mocks.deleteEq,
          }),
        }),
        upsert: mocks.upsert,
        insert: mocks.insert,
      }
    },
  },
}))

const basketball = sports.find(s => s.id === 'basketball')!
const playerId = 'player-uuid'
const gameId = 'game-uuid'
const userId = 'user-uuid'

const shot: ShotRecord = {
  id: 'shot-1',
  x: 0.5,
  y: 0.5,
  made: true,
  shotType: '2pt',
  zone: 'paint',
  playerId,
  timestamp: 1,
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    sport: basketball,
    gameInfo: {
      teamName: 'Home',
      opponentName: 'Away',
      tournamentName: '',
      date: '2026-01-01',
    },
    players: [{ id: playerId, name: 'A', number: '1', stats: {} }],
    activePlayerId: playerId,
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    currentPeriod: 1,
    teamStatsConfig: null,
    actionLog: [],
    shotChart: [shot],
    cloudSync: {
      seasonId: null,
      teamId: null,
      gameId,
      gameStatus: 'in_progress',
      playerIdMap: { [playerId]: playerId },
      status: 'idle',
      lastSyncedAt: null,
      lastError: null,
      shotChartHydrationDroppedRows: 0,
    },
    ...overrides,
  }
}

describe('syncShotChartToCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteEq.mockResolvedValue({ error: null })
    mocks.upsert.mockResolvedValue({ error: null })
    mocks.insert.mockResolvedValue({ error: null })
  })

  it('upserts local rows when hydration dropped cloud rows (no full delete)', async () => {
    const state = baseState({
      cloudSync: {
        ...baseState().cloudSync,
        shotChartHydrationDroppedRows: 2,
      },
    })

    const mode = await syncShotChartToCloud(state, userId, gameId, { [playerId]: playerId })

    expect(mode).toBe('skipped_incomplete_hydration')
    expect(mocks.upsert).toHaveBeenCalledOnce()
    expect(mocks.deleteEq).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('delete+replaces when hydration was complete', async () => {
    const mode = await syncShotChartToCloud(baseState(), userId, gameId, { [playerId]: playerId })

    expect(mode).toBe('synced')
    expect(mocks.deleteEq).toHaveBeenCalledOnce()
    expect(mocks.insert).toHaveBeenCalledOnce()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})

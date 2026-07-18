import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../types'

const insertMock = vi.hoisted(() => {
  const fn = vi.fn()
  fn.mockResolvedValue({ error: null as { message?: string } | null })
  return fn
})

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'client_sync_errors') {
        throw new Error(`unexpected table ${table}`)
      }
      return {
        insert: (row: unknown) => insertMock(row),
      }
    },
  },
}))

import {
  isPersistedSyncLastErrorNetworkish,
  logClientSyncError,
  resetClientSyncErrorThrottleForTests,
} from './logClientSyncError'

function state(over: Partial<GameState> = {}): GameState {
  return {
    sport: {
      id: 'basketball',
      name: 'Basketball',
      icon: 'B',
      theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
      categories: [],
      scoreLabel: 'PTS',
    },
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: 'Tipoff',
      tournamentId: 'tour-1',
      date: '2026-07-15',
    },
    players: [{ id: 'p1', name: 'One', number: '1', stats: {} }],
    activePlayerId: 'p1',
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: {
      seasonId: 'season-1',
      teamId: 'team-1',
      gameId: 'game-1',
      gameStatus: 'in_progress',
      playerIdMap: {},
      status: 'error',
      lastSyncedAt: null,
      lastError: 'boom',
      lastSyncedGameFingerprint: null,
      shotChartHydrationDroppedRows: 0,
    },
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    ...over,
    eventStream: over.eventStream === undefined ? null : over.eventStream,
  }
}

describe('isPersistedSyncLastErrorNetworkish', () => {
  it('matches common transport / offline failure messages', () => {
    expect(isPersistedSyncLastErrorNetworkish('NetworkError when attempting to fetch')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('Device is offline')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('TypeError: Failed to fetch')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('fetch failed')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('Request timeout after 30s')).toBe(true)
  })

  it('does not treat application or auth failures as networkish', () => {
    expect(isPersistedSyncLastErrorNetworkish('JWT expired')).toBe(false)
    expect(isPersistedSyncLastErrorNetworkish('duplicate key value violates unique constraint')).toBe(
      false
    )
    expect(isPersistedSyncLastErrorNetworkish('')).toBe(false)
  })
})

describe('logClientSyncError', () => {
  beforeEach(() => {
    insertMock.mockReset()
    insertMock.mockResolvedValue({ error: null })
    resetClientSyncErrorThrottleForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('inserts a truncated message with game context and returns true', async () => {
    const long = `x`.repeat(5000)
    const ok = await logClientSyncError('user-1', `  ${long}  `, state(), {
      extraContext: { phase: 'test' },
    })

    expect(ok).toBe(true)
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0][0] as {
      user_id: string
      message: string
      context: Record<string, unknown>
    }
    expect(row.user_id).toBe('user-1')
    expect(row.message).toHaveLength(4000)
    expect(row.context).toMatchObject({
      sportId: 'basketball',
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentId: 'tour-1',
      cloudGameId: 'game-1',
      playerCount: 1,
      phase: 'test',
    })
  })

  it('throttles duplicate user+message inserts within the window', async () => {
    expect(await logClientSyncError('user-1', 'same error', state())).toBe(true)
    expect(await logClientSyncError('user-1', 'same error', state())).toBe(false)
    expect(insertMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(45_000)
    expect(await logClientSyncError('user-1', 'same error', state())).toBe(true)
    expect(insertMock).toHaveBeenCalledTimes(2)
  })

  it('bypassThrottle allows an immediate duplicate insert', async () => {
    expect(await logClientSyncError('user-1', 'dup', state())).toBe(true)
    expect(
      await logClientSyncError('user-1', 'dup', state(), { bypassThrottle: true })
    ).toBe(true)
    expect(insertMock).toHaveBeenCalledTimes(2)
  })

  it('returns false and swallows missing-table errors', async () => {
    insertMock.mockResolvedValue({
      error: { message: 'relation "client_sync_errors" does not exist' },
    })
    expect(await logClientSyncError('user-1', 'table missing', state())).toBe(false)
  })

  it('returns false when userId is empty', async () => {
    expect(await logClientSyncError('', 'msg', state())).toBe(false)
    expect(insertMock).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const deleteMock = vi.fn()
const upsertMock = vi.fn(() => Promise.resolve({ error: null }))

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'shot_chart') {
        return {
          delete: () => ({
            eq: () => ({
              eq: () => {
                deleteMock()
                return Promise.resolve({ error: null })
              },
            }),
          }),
          insert: vi.fn(() => Promise.resolve({ error: null })),
          upsert: upsertMock,
        }
      }
      return {}
    }),
  },
}))

import { syncShotChartToCloud } from './cloudSync'
import { sports } from '../config/sports'
import type { GameState } from '../types'

function basketballState(overrides: Partial<GameState> = {}): GameState {
  const sport = sports.find(s => s.id === 'basketball')!
  return {
    sport,
    shotChart: [
      {
        id: 's1',
        playerId: 'local-1',
        x: 1,
        y: 2,
        made: true,
        shotType: '2pt' as const,
        zone: 'paint' as const,
        timestamp: 1,
      },
    ],
    cloudSync: {
      seasonId: null,
      teamId: null,
      gameId: 'game-1',
      gameStatus: 'in_progress',
      playerIdMap: {},
      status: 'idle',
      lastSyncedAt: null,
      lastError: null,
      shotChartHydrationDroppedRows: 0,
      lastSyncedGameFingerprint: null,
    },
    ...overrides,
  } as GameState
}

describe('syncShotChartToCloud', () => {
  beforeEach(() => {
    deleteMock.mockClear()
    upsertMock.mockClear()
  })

  it('does not delete cloud rows when every local shot lacks a mapped player id', async () => {
    const state = basketballState({
      shotChart: [
        {
          id: 's1',
          playerId: 'local-only',
          x: 1,
          y: 2,
          made: true,
          shotType: '2pt' as const,
          zone: 'paint' as const,
          timestamp: 1,
        },
      ],
    })

    const mode = await syncShotChartToCloud(state, 'user-1', 'game-1', {
      'other-player': '00000000-0000-4000-8000-000000000001',
    })

    expect(mode).toBe('skipped_unmappable_shots')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns synced_partial (not synced) when hydration dropped rows and upserts mappable shots', async () => {
    const state = basketballState()
    state.cloudSync.shotChartHydrationDroppedRows = 2

    const mode = await syncShotChartToCloud(state, 'user-1', 'game-1', {
      'local-1': '00000000-0000-4000-8000-000000000001',
    })

    expect(mode).toBe('synced_partial')
    expect(upsertMock).toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

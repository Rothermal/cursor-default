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

describe('syncShotChartToCloud', () => {
  beforeEach(() => {
    deleteMock.mockClear()
    upsertMock.mockClear()
  })

  it('does not delete cloud rows when every local shot lacks a mapped player id', async () => {
    const sport = sports.find(s => s.id === 'basketball')!
    const state = {
      sport,
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
      cloudSync: { shotChartHydrationDroppedRows: 0 },
    } as unknown as GameState

    const mode = await syncShotChartToCloud(state, 'user-1', 'game-1', {
      'other-player': '00000000-0000-4000-8000-000000000001',
    })

    expect(mode).toBe('skipped_unmappable_shots')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('uses upsert-only path when hydration dropped rows and returns synced_upsert_only', async () => {
    const sport = sports.find(s => s.id === 'basketball')!
    const playerId = 'p1'
    const remoteId = '00000000-0000-4000-8000-000000000001'
    const state = {
      sport,
      shotChart: [
        {
          id: 's1',
          playerId,
          x: 1,
          y: 2,
          made: true,
          shotType: '2pt' as const,
          zone: 'paint' as const,
          timestamp: 1,
        },
      ],
      cloudSync: { shotChartHydrationDroppedRows: 2 },
    } as unknown as GameState

    const mode = await syncShotChartToCloud(state, 'user-1', 'game-1', {
      [playerId]: remoteId,
    })

    expect(mode).toBe('synced_upsert_only')
    expect(upsertMock).toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

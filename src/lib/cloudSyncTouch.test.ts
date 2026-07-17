import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  configured: true,
  updateError: null as { message?: string } | null,
  lastUpdate: null as { table: string; payload: Record<string, unknown>; gameId: string } | null,
}))

vi.mock('./supabase', () => ({
  get supabase() {
    if (!mock.configured) return null
    return {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => ({
          eq: (_column: string, gameId: string) => {
            mock.lastUpdate = { table, payload, gameId }
            return Promise.resolve({ error: mock.updateError })
          },
        }),
      }),
    }
  },
}))

import {
  getLastOpenedPreferenceSupport,
  touchCloudGameLastOpened,
} from './cloudSync'

describe('touchCloudGameLastOpened', () => {
  beforeEach(() => {
    mock.configured = true
    mock.updateError = null
    mock.lastUpdate = null
  })

  it('throws when Supabase is not configured', async () => {
    mock.configured = false
    await expect(touchCloudGameLastOpened('game-1')).rejects.toThrow(
      'Supabase client not configured'
    )
  })

  it('updates last_opened_at and marks preference support as supported', async () => {
    await touchCloudGameLastOpened('game-1')

    expect(mock.lastUpdate?.table).toBe('games')
    expect(mock.lastUpdate?.gameId).toBe('game-1')
    expect(typeof mock.lastUpdate?.payload.last_opened_at).toBe('string')
    expect(getLastOpenedPreferenceSupport()).toBe('supported')
  })

  it('swallows missing last_opened_at column errors and marks preference support missing', async () => {
    mock.updateError = { message: 'column games.last_opened_at does not exist' }
    await expect(touchCloudGameLastOpened('game-2')).resolves.toBeUndefined()
    expect(getLastOpenedPreferenceSupport()).toBe('missing')
  })

  it('rethrows unexpected update failures', async () => {
    mock.updateError = { message: 'permission denied for table games' }
    await expect(touchCloudGameLastOpened('game-3')).rejects.toThrow(
      'Game touch failed: permission denied for table games'
    )
  })
})

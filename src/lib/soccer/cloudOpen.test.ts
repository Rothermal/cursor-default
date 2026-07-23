import { describe, expect, it, vi } from 'vitest'
import type { ParkedGameSummary } from '../gameParking'
import { resolveSoccerRecorderOpenSource } from './cloudOpen'

function parked(
  localGameId: string,
  overrides: Partial<ParkedGameSummary> = {}
): ParkedGameSummary {
  return {
    localGameId,
    sportId: 'soccer',
    sportName: 'Soccer',
    sportIcon: '',
    teamName: 'Tracked',
    opponentName: 'Opponent',
    gameDate: '2026-07-22',
    status: 'in_progress',
    updatedAt: '2026-07-22T12:00:00.000Z',
    cloudGameId: 'game-1',
    syncStatus: 'idle',
    syncDirty: false,
    syncLastError: null,
    ...overrides,
  }
}

describe('soccer Cloud Games open source', () => {
  it('resumes an active matching local binding without loading cloud state', async () => {
    const loadCloud = vi.fn<() => Promise<string | null>>()
    const source = await resolveSoccerRecorderOpenSource(
      'game-1',
      'local-active',
      [
        parked('local-dirty', { syncDirty: true }),
        parked('local-active'),
      ],
      loadCloud
    )

    expect(source).toEqual({ kind: 'local', localGameId: 'local-active' })
    expect(loadCloud).not.toHaveBeenCalled()
  })

  it('prefers unsynced local work when no matching binding is active', async () => {
    const source = await resolveSoccerRecorderOpenSource(
      'game-1',
      'different-game',
      [
        parked('local-clean', { updatedAt: '2026-07-22T13:00:00.000Z' }),
        parked('local-dirty', { syncDirty: true }),
      ],
      vi.fn()
    )

    expect(source).toEqual({ kind: 'local', localGameId: 'local-dirty' })
  })

  it('distinguishes an existing cloud stream from an empty recorder stream', async () => {
    await expect(resolveSoccerRecorderOpenSource(
      'game-1',
      null,
      [],
      async () => 'cloud-state'
    )).resolves.toEqual({ kind: 'cloud', state: 'cloud-state' })

    await expect(resolveSoccerRecorderOpenSource(
      'game-1',
      null,
      [],
      async () => null
    )).resolves.toEqual({ kind: 'empty' })
  })

  it('propagates load failures instead of treating them as an empty stream', async () => {
    await expect(resolveSoccerRecorderOpenSource(
      'game-1',
      null,
      [],
      async () => {
        throw new Error('projection failed')
      }
    )).rejects.toThrow('projection failed')
  })
})

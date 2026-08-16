import { describe, expect, it, vi } from 'vitest'
import type { ParkedGameSummary } from '../gameParking'
import { resolveEventRecorderOpenSource } from './cloudOpen'

function parked(
  localGameId: string,
  sportId: string,
  overrides: Partial<ParkedGameSummary> = {}
): ParkedGameSummary {
  return {
    localGameId,
    sportId,
    sportName: sportId,
    sportIcon: '',
    teamName: 'Tracked',
    opponentName: 'Opponent',
    gameDate: '2026-08-16',
    status: 'in_progress',
    updatedAt: '2026-08-16T12:00:00.000Z',
    cloudGameId: 'game-1',
    syncStatus: 'idle',
    syncDirty: false,
    syncLastError: null,
    ...overrides,
  }
}

describe('event recorder open source', () => {
  it('matches only the requested sport and resumes local work before loading cloud', async () => {
    const loadCloud = vi.fn<() => Promise<string | null>>()
    const source = await resolveEventRecorderOpenSource(
      'basketball',
      'game-1',
      'basketball-active',
      [
        parked('soccer-dirty', 'soccer', { syncDirty: true }),
        parked('basketball-active', 'basketball'),
      ],
      loadCloud
    )

    expect(source).toEqual({ kind: 'local', localGameId: 'basketball-active' })
    expect(loadCloud).not.toHaveBeenCalled()
  })

  it('loads a cloud stream or reports an empty current-recorder stream', async () => {
    await expect(resolveEventRecorderOpenSource(
      'basketball', 'game-1', null, [], async () => 'cloud-state'
    )).resolves.toEqual({ kind: 'cloud', state: 'cloud-state' })
    await expect(resolveEventRecorderOpenSource(
      'basketball', 'game-1', null, [], async () => null
    )).resolves.toEqual({ kind: 'empty' })
  })
})

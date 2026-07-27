import { describe, expect, it } from 'vitest'
import {
  canFinalizeBoundCloudGame,
  resolveCloudGameTrackingAccess,
} from './cloudGameAccess'

describe('resolveCloudGameTrackingAccess', () => {
  it('allows tracking when the game is not bound to a cloud team', () => {
    expect(
      resolveCloudGameTrackingAccess({
        teamId: null,
        role: null,
        loading: true,
        error: null,
      })
    ).toEqual({ kind: 'allowed' })
  })

  it('allows tracking for accepted scoring roles', () => {
    expect(
      resolveCloudGameTrackingAccess({
        teamId: 'team-1',
        role: 'scorer',
        loading: false,
        error: null,
      })
    ).toEqual({ kind: 'allowed' })
  })

  it('fails closed as checking while role is loading without an error', () => {
    expect(
      resolveCloudGameTrackingAccess({
        teamId: 'team-1',
        role: null,
        loading: true,
        error: null,
      })
    ).toEqual({
      kind: 'checking',
      title: 'Checking game access',
      message: 'Confirming your role for this team...',
    })
  })

  it('denies viewers and surfaces verification errors', () => {
    expect(
      resolveCloudGameTrackingAccess({
        teamId: 'team-1',
        role: 'viewer',
        loading: false,
        error: null,
      })
    ).toEqual({
      kind: 'denied',
      title: 'Game tracking unavailable',
      message:
        'Viewer access is read-only. You can review this game from Team Info without changing its stats.',
    })

    expect(
      resolveCloudGameTrackingAccess({
        teamId: 'team-1',
        role: null,
        loading: false,
        error: 'Unable to verify team access.',
      })
    ).toEqual({
      kind: 'denied',
      title: 'Game tracking unavailable',
      message: 'Unable to verify team access.',
    })
  })
})

describe('canFinalizeBoundCloudGame', () => {
  it('requires auth, supabase, an in-progress bound game, and a tracking role', () => {
    expect(
      canFinalizeBoundCloudGame({
        isConfigured: true,
        hasUser: true,
        hasSupabase: true,
        gameId: 'game-1',
        gameStatus: 'in_progress',
        role: 'admin',
      })
    ).toBe(true)
  })

  it('fails closed while role is unknown, already final, or auth is incomplete', () => {
    const base = {
      isConfigured: true,
      hasUser: true,
      hasSupabase: true,
      gameId: 'game-1',
      gameStatus: 'in_progress' as const,
      role: null as null,
    }

    expect(canFinalizeBoundCloudGame({ ...base, role: null })).toBe(false)
    expect(canFinalizeBoundCloudGame({ ...base, role: 'viewer' })).toBe(false)
    expect(canFinalizeBoundCloudGame({ ...base, role: 'scorer', gameStatus: 'final' })).toBe(false)
    expect(canFinalizeBoundCloudGame({ ...base, role: 'scorer', gameId: null })).toBe(false)
    expect(canFinalizeBoundCloudGame({ ...base, role: 'scorer', hasUser: false })).toBe(false)
    expect(canFinalizeBoundCloudGame({ ...base, role: 'scorer', hasSupabase: false })).toBe(false)
    expect(canFinalizeBoundCloudGame({ ...base, role: 'scorer', isConfigured: false })).toBe(false)
  })
})

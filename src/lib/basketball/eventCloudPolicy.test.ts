import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { sports } from '../../config/sports'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  basketballEventCloudPolicyForState,
  INVALID_BASKETBALL_EVENT_CLOUD_POLICY_ERROR,
  normalizeBasketballEventCloudPolicyState,
} from './eventCloudPolicy'

function eventState(): GameState {
  return {
    ...createInitialState(),
    gameDataAuthority: 'sport_events',
    sport: sports.find(sport => sport.id === 'basketball')!,
  }
}

describe('Basketball Event cloud policy', () => {
  it('preserves missing pre-C3 policy while resolving it as automatic', () => {
    const state = eventState()
    const normalized = normalizeBasketballEventCloudPolicyState(state)

    expect(normalized).toBe(state)
    expect(normalized.cloudSync).not.toHaveProperty('eventCloudPolicy')
    expect(basketballEventCloudPolicyForState(normalized)).toBe('automatic')
  })

  it('preserves pre-C3 automatic compatibility through metadata patches and hydration', () => {
    const state = {
      ...eventState(),
      eventStream: { version: 1, events: [] },
      sportGameState: { sportId: 'basketball' } as GameState['sportGameState'],
      cloudSync: {
        ...eventState().cloudSync,
        seasonId: 'season-1',
        teamId: 'team-1',
        gameId: 'game-1',
        gameStatus: 'in_progress',
      },
    }

    const patched = gameReducer(state, {
      type: 'SET_CLOUD_SYNC_STATE',
      cloudSync: { status: 'synced', lastSyncedAt: '2026-08-25T00:00:00.000Z' },
    })
    expect(patched.cloudSync).not.toHaveProperty('eventCloudPolicy')
    expect(basketballEventCloudPolicyForState(patched)).toBe('automatic')

    const hydrated = gameReducer(patched, { type: 'HYDRATE_STATE', state: patched })
    expect(hydrated.cloudSync).toMatchObject({
      seasonId: 'season-1',
      teamId: 'team-1',
      gameId: 'game-1',
      gameStatus: 'in_progress',
    })
    expect(basketballEventCloudPolicyForState(hydrated)).toBe('automatic')
  })

  it('fails malformed bound policy closed without destroying binding evidence', () => {
    const state = eventState()
    const malformed = {
      ...state,
      cloudSync: {
        ...state.cloudSync,
        eventCloudPolicy: 'surprise',
        seasonId: 'season-1',
        teamId: 'team-1',
        gameId: 'game-1',
        gameStatus: 'in_progress',
        playerIdMap: { p1: 'cloud-p1' },
        status: 'error',
        lastError: 'old error',
      },
    } as unknown as GameState

    const normalized = normalizeBasketballEventCloudPolicyState(malformed)
    expect(normalized.cloudSync).toMatchObject({
      seasonId: 'season-1',
      teamId: 'team-1',
      gameId: 'game-1',
      gameStatus: 'in_progress',
      playerIdMap: { p1: 'cloud-p1' },
      status: 'error',
      lastError: INVALID_BASKETBALL_EVENT_CLOUD_POLICY_ERROR,
    })
    expect((normalized.cloudSync as unknown as Record<string, unknown>).eventCloudPolicy)
      .toBe('surprise')
    expect(basketballEventCloudPolicyForState(normalized)).toBe('local_only')

    const rehydrated = normalizeBasketballEventCloudPolicyState(normalized)
    expect(rehydrated.cloudSync).toMatchObject({
      teamId: 'team-1',
      gameId: 'game-1',
      status: 'error',
      lastError: INVALID_BASKETBALL_EVENT_CLOUD_POLICY_ERROR,
    })
  })

  it('removes accidental binding metadata from an explicit local-only game', () => {
    const state = eventState()
    const normalized = normalizeBasketballEventCloudPolicyState({
      ...state,
      cloudSync: {
        ...state.cloudSync,
        eventCloudPolicy: 'local_only',
        seasonId: 'season-1',
        teamId: 'team-1',
        gameId: 'game-1',
      },
    })

    expect(normalized.cloudSync).toMatchObject({
      eventCloudPolicy: 'local_only',
      seasonId: null,
      teamId: null,
      gameId: null,
      status: 'idle',
    })
  })

  it('removes the Basketball-only policy from Legacy games', () => {
    const state = {
      ...createInitialState(),
      sport: sports.find(sport => sport.id === 'basketball')!,
      cloudSync: {
        ...createInitialState().cloudSync,
        eventCloudPolicy: 'local_only' as const,
      },
    }
    const normalized = normalizeBasketballEventCloudPolicyState(state)

    expect(normalized.cloudSync).not.toHaveProperty('eventCloudPolicy')
    expect(basketballEventCloudPolicyForState(normalized)).toBeNull()
  })
})

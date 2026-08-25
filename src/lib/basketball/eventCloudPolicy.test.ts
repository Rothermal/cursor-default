import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { sports } from '../../config/sports'
import { createInitialState } from '../gameReducer'
import {
  basketballEventCloudPolicyForState,
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

  it('fails malformed policy closed and removes every binding field', () => {
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
      eventCloudPolicy: 'local_only',
      seasonId: null,
      teamId: null,
      gameId: null,
      gameStatus: null,
      playerIdMap: {},
      status: 'idle',
      lastError: null,
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

import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { getBasketballRulesProfile, upgradeBasketballRulesDraftToV3 } from './profiles'
import {
  basketballWorkflowActionKind,
  getBasketballAnchoredSetupPolicy,
  isRunningAnchoredBasketballGame,
  shouldInterceptRunningBasketballClock,
} from './productionClockPolicy'

describe('BKE-6B1 production clock policy', () => {
  const v2 = getBasketballRulesProfile('nfhs', 1)!.rules
  const anchored = upgradeBasketballRulesDraftToV3(v2, 'nfhs')

  it('allows only local equal-play-off anchored setup', () => {
    expect(getBasketballAnchoredSetupPolicy({
      rules: anchored,
      cloudIntent: 'local_only',
    })).toEqual({ allowed: true })
    expect(getBasketballAnchoredSetupPolicy({
      rules: v2,
      cloudIntent: 'local_only',
    })).toMatchObject({ allowed: false, reason: 'not_anchored' })
    expect(getBasketballAnchoredSetupPolicy({
      rules: upgradeBasketballRulesDraftToV3(
        getBasketballRulesProfile('youth_equal_play', 1)!.rules,
        'youth_equal_play'
      ),
      cloudIntent: 'local_only',
    })).toMatchObject({ allowed: false, reason: 'equal_play_requires_bke_6c' })
    expect(getBasketballAnchoredSetupPolicy({
      rules: anchored,
      cloudIntent: 'automatic',
    })).toMatchObject({ allowed: false, reason: 'cloud_requires_bke_6d' })
    expect(getBasketballAnchoredSetupPolicy({
      rules: anchored,
      cloudIntent: 'local_only',
      cloudGameId: 'game-1',
    })).toMatchObject({ allowed: false, reason: 'cloud_requires_bke_6d' })
  })

  it('classifies only parking and replacement commits as mutating actions', () => {
    expect(basketballWorkflowActionKind('setup_visit')).toBe('mutation_free')
    expect(basketballWorkflowActionKind('setup_edit')).toBe('mutation_free')
    expect(basketballWorkflowActionKind('route_navigation')).toBe('mutation_free')
    expect(basketballWorkflowActionKind('park_commit')).toBe('park_or_replace')
    expect(basketballWorkflowActionKind('resume_commit')).toBe('park_or_replace')
    expect(basketballWorkflowActionKind('import_commit')).toBe('park_or_replace')
  })

  it('intercepts mutating actions only for a running anchored Basketball clock', () => {
    const state = runningState()
    expect(isRunningAnchoredBasketballGame(state)).toBe(true)
    expect(shouldInterceptRunningBasketballClock(state, 'park_commit')).toBe(true)
    expect(shouldInterceptRunningBasketballClock(state, 'setup_visit')).toBe(false)
    expect(shouldInterceptRunningBasketballClock({
      ...state,
      sportGameState: {
        ...state.sportGameState!,
        projection: {
          ...state.sportGameState!.projection,
          clock: { ...state.sportGameState!.projection.clock!, running: false },
        },
      },
    } as GameState, 'park_commit')).toBe(false)
  })
})

function runningState(): GameState {
  const state = createInitialState('idle')
  return {
    ...state,
    sport: {
      id: 'basketball',
      name: 'Basketball',
      icon: 'B',
      theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
      categories: [],
      scoreLabel: 'PTS',
    },
    gameDataAuthority: 'sport_events',
    sportGameState: {
      sportId: 'basketball',
      version: 1,
      setup: null,
      projection: {
        status: 'in_progress',
        clock: { running: true },
      },
    },
  } as unknown as GameState
}

import type { GameState } from '../../types'
import { pauseBasketballClock } from './clockCommands'
import { isBasketballMatchRulesV3 } from './rules'
import type {
  BasketballMatchRulesV2,
  BasketballMatchRulesV3,
} from './types'

export type BasketballAnchoredSetupBlockReason =
  | 'equal_play_requires_bke_6c'
  | 'cloud_requires_bke_6d'

export type BasketballAnchoredSetupPolicy =
  | { applicable: false }
  | { applicable: true; allowed: true }
  | {
      applicable: true
      allowed: false
      reason: BasketballAnchoredSetupBlockReason
      message: string
    }

export function getBasketballAnchoredSetupPolicy({
  rules,
  cloudIntent,
  cloudGameId = null,
}: {
  rules: BasketballMatchRulesV2 | BasketballMatchRulesV3
  cloudIntent: 'automatic' | 'local_only'
  cloudGameId?: string | null
}): BasketballAnchoredSetupPolicy {
  if (!isBasketballMatchRulesV3(rules) || rules.clockModel !== 'anchored') {
    return { applicable: false }
  }
  if (rules.equalPlayPolicy.mode !== 'off') {
    return {
      applicable: true,
      allowed: false,
      reason: 'equal_play_requires_bke_6c',
      message: 'Advisory and enforced equal play require the upcoming lineup workflow.',
    }
  }
  if (cloudIntent !== 'local_only' || cloudGameId) {
    return {
      applicable: true,
      allowed: false,
      reason: 'cloud_requires_bke_6d',
      message: 'Anchored Basketball cloud games require the upcoming cloud workflow.',
    }
  }
  return { applicable: true, allowed: true }
}

export function isRunningAnchoredBasketballGame(state: GameState): boolean {
  return state.sport?.id === 'basketball' &&
    state.gameDataAuthority === 'sport_events' &&
    state.sportGameState?.sportId === 'basketball' &&
    state.sportGameState.projection.clock?.running === true
}

export type BasketballWorkflowAction =
  | 'setup_visit'
  | 'setup_edit'
  | 'setup_cancel'
  | 'route_navigation'
  | 'workspace_tab'
  | 'park_commit'
  | 'setup_replace_commit'
  | 'new_game_commit'
  | 'resume_commit'
  | 'import_commit'

export function basketballWorkflowActionKind(
  action: BasketballWorkflowAction
): 'mutation_free' | 'park_or_replace' {
  switch (action) {
    case 'setup_visit':
    case 'setup_edit':
    case 'setup_cancel':
    case 'route_navigation':
    case 'workspace_tab':
      return 'mutation_free'
    case 'park_commit':
    case 'setup_replace_commit':
    case 'new_game_commit':
    case 'resume_commit':
    case 'import_commit':
      return 'park_or_replace'
  }
}

export function shouldInterceptRunningBasketballClock(
  state: GameState,
  action: BasketballWorkflowAction
): boolean {
  return isRunningAnchoredBasketballGame(state) &&
    basketballWorkflowActionKind(action) === 'park_or_replace'
}

export function pauseRunningBasketballClockForWorkflow(
  state: GameState,
  action: BasketballWorkflowAction,
  options: { recorderUserId: string | null; occurredAt?: string }
) {
  if (!shouldInterceptRunningBasketballClock(state, action)) {
    return { ok: true as const, state }
  }
  return pauseBasketballClock(state, options)
}

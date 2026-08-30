import type { GameState } from '../../types'
import { pauseBasketballClock } from './clockCommands'

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

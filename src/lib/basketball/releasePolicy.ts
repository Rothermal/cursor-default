import type { GameState } from '../../types'
import type { BasketballEventCreationPolicy } from '../sportAvailability'
import { isBasketballEventSetupIntent } from './commands'
import type { BasketballSetupAuthority } from './setupDraft'

interface BasketballEventSetupCommitPolicyInput {
  authority: BasketballSetupAuthority
  policy: BasketballEventCreationPolicy
  draftCommittedLocalGameId: string | null
  activeLocalGameId: string | null
  activeState: GameState
}

export function canCommitBasketballSetup(
  input: BasketballEventSetupCommitPolicyInput
): boolean {
  if (input.authority === 'legacy' || input.policy.canCreateNewEventGame) return true

  return Boolean(
    input.draftCommittedLocalGameId &&
    input.draftCommittedLocalGameId === input.activeLocalGameId &&
    isBasketballEventSetupIntent(input.activeState) &&
    Boolean(input.activeState.gameInfo) &&
    input.activeState.players.length === 0
  )
}

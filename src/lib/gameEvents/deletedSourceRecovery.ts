import type { CloudSyncState, GameState } from '../../types'
import type { TeamRole } from '../teamPermissions'

export const DELETED_SOURCE_PLAYER_BINDING_ERROR =
  'Participant source player is not on the source team'

export function canOfferDeletedSourcePlayerRecovery(
  lastError: string | null | undefined,
  role: TeamRole | null
): boolean {
  return (
    (role === 'owner' || role === 'admin') &&
    lastError?.includes(DELETED_SOURCE_PLAYER_BINDING_ERROR) === true
  )
}

/** Recovery is approval for one bind attempt, regardless of its outcome. */
export function deletedSourcePlayerRecoverySettlementPatch(): Pick<
  CloudSyncState,
  'allowDeletedSourcePlayerRecovery'
> {
  return { allowDeletedSourcePlayerRecovery: undefined }
}

/**
 * The team whose owner or admin may approve recovery: the cloud binding's team, or before
 * the first bind succeeds, a Hockey game's immutable source team (HKY-5B1 review).
 */
export function deletedSourceRecoveryTeamId(state: GameState): string | null {
  if (state.cloudSync.teamId) return state.cloudSync.teamId
  const sportState = state.sportGameState
  if (sportState?.sportId === 'hockey' && !state.cloudSync.gameId) return sportState.setup.sourceTeamId
  return null
}

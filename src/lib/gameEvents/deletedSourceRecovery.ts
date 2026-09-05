import type { CloudSyncState } from '../../types'
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

import type { CloudSyncState, GameAction, GameState } from '../types'

/**
 * Active soccer recovery must replace the full reducer state. A metadata-only
 * patch would leave React holding the pre-merge event stream, which the normal
 * persistence effect could then write over the recovered parked snapshot.
 */
export function activeCloudSyncStateAction(
  fullState: GameState,
  cloudSyncPatch: Partial<CloudSyncState>,
  adoptFullState: boolean
): GameAction {
  return adoptFullState
    ? { type: 'HYDRATE_STATE', state: fullState }
    : { type: 'SET_CLOUD_SYNC_STATE', cloudSync: cloudSyncPatch }
}

export function resolvedCloudGameStatus(
  localStatus: string | null,
  synced: { gameStatus?: string; skippedFinalGame?: boolean }
): string {
  if (typeof synced.gameStatus === 'string' && synced.gameStatus) {
    return synced.gameStatus
  }
  if (synced.skippedFinalGame) return 'final'
  return localStatus === 'final' ? 'final' : 'in_progress'
}

/**
 * Merge a partial cloud-sync patch into current state.
 *
 * When `teamId` changes and the patch does not also set `gameId`, clear the
 * prior game binding. Otherwise Game Setup can point an existing `gameId` at a
 * different team and the next sync will move that cloud row (and its stats).
 * Callers that intentionally rebind (successful sync) must include `gameId` in
 * the same patch.
 */
export function mergeCloudSyncState(
  prev: CloudSyncState,
  patch: Partial<CloudSyncState>
): CloudSyncState {
  const next: CloudSyncState = {
    ...prev,
    ...patch,
  }

  if (
    patch.teamId !== undefined &&
    patch.teamId !== prev.teamId &&
    patch.gameId === undefined
  ) {
    next.gameId = null
    next.gameStatus = null
    next.playerIdMap = {}
    next.lastSyncedAt = null
    next.lastSyncedGameFingerprint = null
    next.shotChartHydrationDroppedRows = 0
    next.eventSyncBase = {}
    next.eventConflicts = []
    next.pendingEventConflictResolutions = []
  }

  return next
}

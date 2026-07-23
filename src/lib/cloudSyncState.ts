import type { CloudSyncState } from '../types'

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

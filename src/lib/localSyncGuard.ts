import type { GameState } from '../types'

/**
 * True when local game progress should not be replaced by cloud hydration.
 * Covers never-synced games, durable pending-sync flag, and edits after last successful sync.
 */
export function hasUnsyncedLocalProgress(
  state: GameState,
  pendingSyncFlag: boolean
): boolean {
  if (!state.sport || !state.gameInfo) return false
  if (!state.cloudSync.gameId) return true
  if (pendingSyncFlag) return true

  const lastSyncTs = state.cloudSync.lastSyncedAt
    ? Date.parse(state.cloudSync.lastSyncedAt)
    : 0
  const lastAction = state.actionLog[state.actionLog.length - 1]
  const lastActionTs = lastAction?.timestamp ?? 0

  if (!Number.isFinite(lastSyncTs) || lastSyncTs <= 0) {
    return lastActionTs > 0
  }

  return lastActionTs > lastSyncTs
}

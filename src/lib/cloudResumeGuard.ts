import type { GameState } from '../types'
import { shouldDeferCloudResumeHydration } from './gameSyncFingerprint'
import { getPendingSyncFlag } from './gameStorageKeys'

/** True when local game progress is ahead of the last synced snapshot (or pending sync is set). */
export function hasUnsyncedLocalGameChanges(state: GameState): boolean {
  return shouldDeferCloudResumeHydration(state, getPendingSyncFlag())
}

const DISCARD_UNSYNCED_MSG =
  'You have unsynced changes in your current game. Opening another game will discard them. Continue?'

export function confirmDiscardUnsyncedLocalGame(): boolean {
  return window.confirm(DISCARD_UNSYNCED_MSG)
}

/** Returns false when the user cancels; true when hydration may proceed. */
export function guardCloudGameHydrate(state: GameState): boolean {
  if (!hasUnsyncedLocalGameChanges(state)) return true
  return confirmDiscardUnsyncedLocalGame()
}

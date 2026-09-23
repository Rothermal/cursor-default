import type { GameState } from '../types'
import { shouldBlockDiscardUnsyncedGame } from './gameSyncFingerprint'

export interface LocalGameDiscardOptions {
  allowUnsyncedLocalDelete?: boolean
}

export function localGameDiscardError({ state, dirty, active, syncing, options }: {
  state: GameState
  dirty: boolean
  active: boolean
  syncing: boolean
  options?: LocalGameDiscardOptions
}): string | null {
  if (syncing) return 'A cloud sync is in progress. Wait for it to finish, then retry deleting the local copy.'
  if (options?.allowUnsyncedLocalDelete && active) return 'This game is now active. Park it before deleting its local copy.'
  if (!options?.allowUnsyncedLocalDelete && shouldBlockDiscardUnsyncedGame(state, dirty)) {
    return 'This parked game has unsynced cloud stats. Resume and sync it before discarding.'
  }
  return null
}

export const LOCAL_GAME_DELETE_WARNING = 'Delete this local game copy from this device? Any unsynced events, roster edits, and setup data will be permanently lost without uploading them. Existing cloud data will not be deleted or changed. This cannot be undone. Cancel and export the game in Settings > Data first if you want a backup. Close this game in other browser tabs before continuing.'

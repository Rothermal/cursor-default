import type { GameState } from '../types'
import { buildGameSyncFingerprint, withLastSyncedGameFingerprint } from './gameSyncFingerprint'
import { normalizeOpponentLabel } from './opponentTeams'

/**
 * The same game with new opponent labels; other gameInfo fields and the binding are kept.
 * The server already holds these labels, so a copy that was in sync stays in sync (its
 * synced fingerprint moves with the labels). A copy that was already ahead keeps its
 * unsynced work. Without this, a final copy, which never syncs again, would look unsynced
 * forever and block discarding it or deleting its cloud game or team.
 */
export function withOpponentLabels(state: GameState, name: string, nickname: string | null): GameState {
  if (!state.gameInfo) return state
  const wasInSync = state.cloudSync.lastSyncedGameFingerprint != null &&
    buildGameSyncFingerprint(state) === state.cloudSync.lastSyncedGameFingerprint
  const next = {
    ...state,
    gameInfo: { ...state.gameInfo, opponentName: name.trim(), opponentNickname: normalizeOpponentLabel(nickname) },
  }
  return wasInSync ? withLastSyncedGameFingerprint(next) : next
}

import type { GameState } from '../types'
import { listParkedGameRecords, saveParkedGameRecordState } from './gameParking'
import { normalizeOpponentLabel } from './opponentTeams'

/** The same game with new opponent labels; other gameInfo fields and the binding are kept. */
export function withOpponentLabels(state: GameState, name: string, nickname: string | null): GameState {
  if (!state.gameInfo) return state
  return {
    ...state,
    gameInfo: { ...state.gameInfo, opponentName: name.trim(), opponentNickname: normalizeOpponentLabel(nickname) },
  }
}

/**
 * Keep device copies of a relabeled cloud game in step, so a later sync from an
 * old copy does not write the previous opponent name back (game headers are
 * re-sent by the creator's binding). The active game is left to the caller,
 * which must dispatch SET_GAME_INFO so GameContext does not overwrite storage.
 */
export function relabelParkedCloudGameCopies(
  ownerId: string | null,
  cloudGameId: string,
  activeLocalGameId: string | null,
  name: string,
  nickname: string | null
): number {
  let updated = 0
  for (const record of listParkedGameRecords(ownerId)) {
    if (record.localGameId === activeLocalGameId) continue
    if (record.gameState.cloudSync.gameId !== cloudGameId || !record.gameState.gameInfo) continue
    saveParkedGameRecordState(record.localGameId, withOpponentLabels(record.gameState, name, nickname), ownerId)
    updated += 1
  }
  return updated
}

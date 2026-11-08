import type { GameAction } from '../types'
import { captureAuthIdentity, isCurrentAuthIdentity } from './authIdentity'
import { getActiveLocalGameId, listParkedGameRecords, saveParkedGameRecordState } from './gameParking'
import { withOpponentLabels } from './opponentLabels'
import { normalizeOpponentLabel } from './opponentTeams'

export { withOpponentLabels }


/**
 * Keep device copies of a relabeled cloud game in step, so they show the new name.
 * (Migration 082 also stops ordinary syncs from overwriting a relabeled game's
 * opponent on the server.) The active game is left to the caller,
 * which must dispatch SET_OPPONENT_LABELS so GameContext does not overwrite storage.
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

/**
 * Server relabel, then device copies. Local writes happen only if the same account
 * is still signed in when the server call settles, and resolve the active game at
 * that moment (the reducer ignores SET_OPPONENT_LABELS for any other bound game).
 */
export async function relabelOpponentEverywhere(options: {
  userId: string
  cloudGameId: string
  name: string
  nickname: string | null
  writeServer: (cloudGameId: string, name: string, nickname: string | null) => Promise<void>
  dispatch: (action: GameAction) => void
}): Promise<'updated' | 'account_changed'> {
  const identity = captureAuthIdentity(options.userId)
  if (!identity) throw new Error('The signed-in account changed. Try again.')
  const opponentName = options.name.trim()
  const opponentNickname = normalizeOpponentLabel(options.nickname)
  await options.writeServer(options.cloudGameId, opponentName, opponentNickname)
  if (!isCurrentAuthIdentity(identity)) return 'account_changed'
  relabelParkedCloudGameCopies(
    options.userId,
    options.cloudGameId,
    getActiveLocalGameId(options.userId),
    opponentName,
    opponentNickname
  )
  options.dispatch({ type: 'SET_OPPONENT_LABELS', cloudGameId: options.cloudGameId, opponentName, opponentNickname })
  return 'updated'
}

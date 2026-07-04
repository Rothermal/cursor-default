/**
 * Multi-recorder shot-chart review (F3). `shot_chart` rows are per recorder, so a game
 * charted by two people would double-plot every shot. For review we keep exactly one
 * recorder's rows per player (Option C, mirrors stat resolution):
 * primary recorder (`player_checkouts.is_primary`) → game creator → lowest `recorded_by`.
 */

interface RecorderRow {
  player_id: string
  recorded_by: string
}

/**
 * Keep one recorder's rows per player. Pure; operates on remote-id-shaped rows and
 * preserves input order. `primaryByPlayerRemoteId` maps remote player id → primary
 * recorder's user id; `creatorId` is the game's `created_by` (null when unknown).
 */
export function pickRecorderPerPlayer<T extends RecorderRow>(
  rows: T[],
  primaryByPlayerRemoteId: Record<string, string>,
  creatorId: string | null
): T[] {
  const recordersByPlayer = new Map<string, Set<string>>()
  for (const row of rows) {
    let set = recordersByPlayer.get(row.player_id)
    if (!set) {
      set = new Set()
      recordersByPlayer.set(row.player_id, set)
    }
    set.add(row.recorded_by)
  }

  const chosenByPlayer = new Map<string, string>()
  for (const [playerId, recorders] of recordersByPlayer) {
    const primary = primaryByPlayerRemoteId[playerId]
    if (primary && recorders.has(primary)) {
      chosenByPlayer.set(playerId, primary)
      continue
    }
    if (creatorId && recorders.has(creatorId)) {
      chosenByPlayer.set(playerId, creatorId)
      continue
    }
    chosenByPlayer.set(playerId, [...recorders].sort()[0])
  }

  return rows.filter(row => chosenByPlayer.get(row.player_id) === row.recorded_by)
}

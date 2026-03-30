/**
 * Helpers for PlayerStatSummaryTables (kept out of .tsx for react-refresh).
 */
export function buildResolvedByGameForPlayer(
  gameIds: string[],
  playerId: string,
  rowsByGame: Array<Array<{ player_id: string; stat_id: string; value: number }>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  gameIds.forEach((gid, i) => {
    const m: Record<string, number> = {}
    for (const row of rowsByGame[i] ?? []) {
      if (row.player_id === playerId) {
        m[row.stat_id] = (m[row.stat_id] ?? 0) + Number(row.value)
      }
    }
    out[gid] = m
  })
  return out
}

import type { ActionLogEntry, GameState } from '../types'

/** Stat key to increment when adding a shot from the chart. */
export function statIdForShotRecord(shot: {
  made: boolean
  shotType: '2pt' | '3pt'
}): string {
  if (shot.shotType === '3pt') {
    return shot.made ? '3pt' : '3pt_miss'
  }
  return shot.made ? '2pt' : '2pt_miss'
}

const LINKED_COURT_STAT_IDS = new Set(['ast', 'oreb', 'dreb'])

/**
 * Court-popup stats chained immediately after `ADD_SHOT` (F7 assist, F9 rebound).
 * Only entries with explicit `linkedShotId` are reverted on chart clear.
 */
export function linkedCourtStatEntryIds(
  actionLog: ActionLogEntry[],
  clearedShotIds: Set<string>
): Set<string> {
  const linked = new Set<string>()
  for (const entry of actionLog) {
    if (
      entry.type === 'increment' &&
      entry.linkedShotId &&
      clearedShotIds.has(entry.linkedShotId)
    ) {
      linked.add(entry.id)
    }
  }
  return linked
}

/** @deprecated Use linkedCourtStatEntryIds */
export const linkedCourtAssistEntryIds = linkedCourtStatEntryIds

/** Clear every chart shot and revert linked stats/log rows (works even when non-shot actions trail the log). */
export function clearEntireShotChart(state: GameState): GameState {
  if (state.shotChart.length === 0) return state
  const shotIds = new Set(state.shotChart.map(s => s.id))
  const linkedStatIds = linkedCourtStatEntryIds(state.actionLog, shotIds)

  const statDeltas = new Map<string, Record<string, number>>()
  for (const shot of state.shotChart) {
    const sid = statIdForShotRecord(shot)
    const prev = statDeltas.get(shot.playerId) ?? {}
    prev[sid] = (prev[sid] ?? 0) + 1
    statDeltas.set(shot.playerId, prev)
  }
  for (const entry of state.actionLog) {
    if (!linkedStatIds.has(entry.id) || !entry.playerId || !entry.statId) continue
    if (!LINKED_COURT_STAT_IDS.has(entry.statId)) continue
    const prev = statDeltas.get(entry.playerId) ?? {}
    prev[entry.statId] = (prev[entry.statId] ?? 0) + 1
    statDeltas.set(entry.playerId, prev)
  }

  const players = state.players.map(p => {
    const deltas = statDeltas.get(p.id)
    if (!deltas) return p
    const nextStats = { ...p.stats }
    for (const [statId, n] of Object.entries(deltas)) {
      const v = (nextStats[statId] ?? 0) - n
      nextStats[statId] = Math.max(0, v)
    }
    return { ...p, stats: nextStats }
  })
  const actionLog = state.actionLog.filter(
    e =>
      !(
        (e.type === 'increment' && e.shotId && shotIds.has(e.shotId)) ||
        linkedStatIds.has(e.id)
      )
  )
  return {
    ...state,
    shotChart: [],
    players,
    actionLog,
    cloudSync: {
      ...state.cloudSync,
      shotChartHydrationDroppedRows: 0,
    },
  }
}

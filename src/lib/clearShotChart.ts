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

/**
 * F7 court-popup assists are a plain `INCREMENT_STAT(ast)` logged immediately after
 * `ADD_SHOT`. When clearing the chart, those rows must be reverted too.
 */
export function linkedCourtAssistEntryIds(
  actionLog: ActionLogEntry[],
  clearedShotIds: Set<string>
): Set<string> {
  const linked = new Set<string>()
  for (let i = 0; i < actionLog.length - 1; i++) {
    const entry = actionLog[i]
    const next = actionLog[i + 1]
    if (
      entry.type === 'increment' &&
      entry.shotId &&
      clearedShotIds.has(entry.shotId) &&
      next.type === 'increment' &&
      next.statId === 'ast' &&
      !next.shotId &&
      next.playerId
    ) {
      linked.add(next.id)
    }
  }
  return linked
}

/** Clear every chart shot and revert linked stats/log rows (works even when non-shot actions trail the log). */
export function clearEntireShotChart(state: GameState): GameState {
  if (state.shotChart.length === 0) return state
  const shotIds = new Set(state.shotChart.map(s => s.id))
  const linkedAssistIds = linkedCourtAssistEntryIds(state.actionLog, shotIds)

  const statDeltas = new Map<string, Record<string, number>>()
  for (const shot of state.shotChart) {
    const sid = statIdForShotRecord(shot)
    const prev = statDeltas.get(shot.playerId) ?? {}
    prev[sid] = (prev[sid] ?? 0) + 1
    statDeltas.set(shot.playerId, prev)
  }
  for (const entry of state.actionLog) {
    if (!linkedAssistIds.has(entry.id) || !entry.playerId) continue
    const prev = statDeltas.get(entry.playerId) ?? {}
    prev.ast = (prev.ast ?? 0) + 1
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
        linkedAssistIds.has(e.id)
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

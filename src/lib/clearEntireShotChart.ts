import type { GameState, ShotRecord } from '../types'

/** Stat key to increment when adding a shot from the chart. */
export function statIdForShotRecord(shot: ShotRecord): string {
  if (shot.shotType === '3pt') {
    return shot.made ? '3pt' : '3pt_miss'
  }
  return shot.made ? '2pt' : '2pt_miss'
}

/**
 * Clear every chart shot, remove matching `increment` log rows, and align player stats.
 *
 * Uses each shot log line's `previousValue` so we only remove the chart +1 when it is
 * still reflected in current stats (e.g. after a tracker decrement that already backed
 * out the basket, we remove 0 instead of blindly subtracting from chart counts).
 */
export function clearEntireShotChartInState(state: GameState): GameState {
  if (state.shotChart.length === 0) return state
  const shotIds = new Set(state.shotChart.map(s => s.id))

  const shotLogIndices: number[] = []
  for (let i = 0; i < state.actionLog.length; i++) {
    const e = state.actionLog[i]
    if (e.type === 'increment' && e.shotId && shotIds.has(e.shotId)) {
      shotLogIndices.push(i)
    }
  }
  // Later log lines may have shifted counts; undo chart increments newest-first.
  shotLogIndices.sort((a, b) => b - a)

  const statsScratch = new Map<string, Record<string, number>>()
  for (const p of state.players) {
    statsScratch.set(p.id, { ...p.stats })
  }

  const shotsCoveredByLog = new Set<string>()
  for (const idx of shotLogIndices) {
    const e = state.actionLog[idx]
    if (e.type !== 'increment' || !e.playerId || !e.statId || !e.shotId) continue
    shotsCoveredByLog.add(e.shotId)
    const stats = statsScratch.get(e.playerId)
    if (!stats) continue
    const cur = stats[e.statId] ?? 0
    const prev = e.previousValue
    const remove = Math.min(1, Math.max(0, cur - prev))
    stats[e.statId] = cur - remove
  }

  // Chart rows with no matching log line (legacy / corruption): fall back to chart shape.
  for (const shot of state.shotChart) {
    if (shotsCoveredByLog.has(shot.id)) continue
    const statId = statIdForShotRecord(shot)
    const stats = statsScratch.get(shot.playerId)
    if (!stats) continue
    const v = (stats[statId] ?? 0) - 1
    stats[statId] = Math.max(0, v)
  }

  const players = state.players.map(p => {
    const stats = statsScratch.get(p.id)
    return stats ? { ...p, stats: { ...stats } } : p
  })

  const actionLog = state.actionLog.filter(
    e => !(e.type === 'increment' && e.shotId && shotIds.has(e.shotId))
  )

  return { ...state, shotChart: [], players, actionLog }
}

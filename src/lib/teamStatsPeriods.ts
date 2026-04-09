import type { BasketballTeamStatsConfig } from '../types'
import { getDefaultPeriodLabels } from '../config/teamStatsDefaults'

export function periodScopedStatKey(baseId: string, periodIndex: number): string {
  return `${baseId}_p${periodIndex}`
}

/**
 * Foul count that drives the bonus banner for the current segment.
 * Regulation: fouls in that period only.
 * OT with reset: fouls in that OT only.
 * OT without reset: cumulative team fouls from OT1 through the current OT.
 */
export function getBonusFoulCountForPeriod(
  stats: Record<string, number>,
  baseId: string,
  currentPeriod: number,
  rules: BasketballTeamStatsConfig
): number {
  if (currentPeriod <= 0) return 0
  if (currentPeriod <= rules.periodsPerGame) {
    return stats[periodScopedStatKey(baseId, currentPeriod)] ?? 0
  }
  if (!rules.overtimeFoulsReset) {
    let sum = 0
    for (let p = rules.periodsPerGame + 1; p <= currentPeriod; p++) {
      sum += stats[periodScopedStatKey(baseId, p)] ?? 0
    }
    return sum
  }
  return stats[periodScopedStatKey(baseId, currentPeriod)] ?? 0
}

/**
 * Labels for each selectable period segment (regulation from config, OT uses overtimeLabel).
 */
export function buildPeriodSegmentLabels(
  rules: BasketballTeamStatsConfig,
  periodButtonCount: number
): string[] {
  const reg = Math.max(1, rules.periodsPerGame)
  const defaults = getDefaultPeriodLabels(reg)
  const stored = rules.periodLabels
  const ot = rules.overtimeLabel.trim() || 'OT'
  const out: string[] = []

  for (let i = 0; i < periodButtonCount; i++) {
    const p = i + 1
    if (p <= reg) {
      const label = stored[i] ?? defaults[i] ?? `Period ${p}`
      out.push(label)
    } else {
      const otIndex = p - reg
      out.push(otIndex === 1 ? ot : `${ot} ${otIndex}`)
    }
  }
  return out
}

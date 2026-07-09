import type { BasketballTeamStatsConfig, SportConfig, StatAction } from '../types'
import { buildPeriodSegmentLabels, periodScopedStatKey } from './teamStatsPeriods'

type TeamBonusEventType = 'one_and_one' | 'double_bonus' | 'bonus_nba'

export interface TeamBonusEvent {
  periodIndex: number
  periodLabel: string
  type: TeamBonusEventType
  foulCount: number
  teamLabel: string
}

function maxPeriodIndexForBase(stats: Record<string, number>, baseId: string): number {
  const re = new RegExp(`^${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_p(\\d+)$`)
  let max = 0
  for (const key of Object.keys(stats)) {
    const m = key.match(re)
    if (m) max = Math.max(max, parseInt(m[1]!, 10))
  }
  return max
}

export function maxTeamStatPeriodIndex(
  homeStats: Record<string, number>,
  oppStats: Record<string, number>,
  foulBaseId: string
): number {
  return Math.max(
    maxPeriodIndexForBase(homeStats, foulBaseId),
    maxPeriodIndexForBase(oppStats, foulBaseId),
    1
  )
}

export function foulCountForPeriod(
  stats: Record<string, number>,
  foulBaseId: string,
  periodIndex: number
): number {
  return stats[periodScopedStatKey(foulBaseId, periodIndex)] ?? 0
}

/**
 * Derive bonus milestone events per period (design: DESIGN_TEAM_STATS_BASKETBALL §6.3).
 */
export function deriveBonusEvents(
  stats: Record<string, number>,
  config: BasketballTeamStatsConfig,
  foulBaseId: string,
  periodCount: number,
  teamLabel: string
): TeamBonusEvent[] {
  const events: TeamBonusEvent[] = []
  const labels = buildPeriodSegmentLabels(config, Math.max(periodCount, config.periodsPerGame))

  for (let p = 1; p <= periodCount; p++) {
    const fouls = foulCountForPeriod(stats, foulBaseId, p)
    const periodLabel = labels[p - 1] ?? `Period ${p}`

    if (config.hasOneAndOne && fouls >= config.bonusThreshold) {
      events.push({
        periodIndex: p,
        periodLabel,
        type: 'one_and_one',
        foulCount: config.bonusThreshold,
        teamLabel,
      })
    }
    if (!config.hasOneAndOne && fouls >= config.bonusThreshold) {
      events.push({
        periodIndex: p,
        periodLabel,
        type: 'bonus_nba',
        foulCount: config.bonusThreshold,
        teamLabel,
      })
    }
    if (fouls >= config.doubleBonusThreshold) {
      events.push({
        periodIndex: p,
        periodLabel,
        type: 'double_bonus',
        foulCount: config.doubleBonusThreshold,
        teamLabel,
      })
    }
  }
  return events
}

function sumPeriodScopedStat(stats: Record<string, number>, baseId: string): number {
  let sum = 0
  const prefix = `${baseId}_p`
  for (const [k, v] of Object.entries(stats)) {
    if (k.startsWith(prefix)) sum += v
  }
  return sum
}

export function valueForTeamAction(stats: Record<string, number>, action: StatAction): number {
  if (action.periodScoped) {
    return sumPeriodScopedStat(stats, action.id)
  }
  return stats[action.id] ?? 0
}

export function hasTrackedTeamSide(stats: Record<string, number>, sport: SportConfig): boolean {
  const bases =
    sport.teamCategories?.flatMap(c => c.actions.filter(a => !a.madeStatId).map(a => a.id)) ?? []
  if (bases.length === 0) return false
  const baseSet = new Set(bases)
  for (const [k, v] of Object.entries(stats)) {
    if (v <= 0) continue
    const base = k.replace(/_p\d+$/, '')
    if (baseSet.has(base)) return true
  }
  return false
}

export function teamStatActionRows(sport: SportConfig): StatAction[] {
  return sport.teamCategories?.flatMap(c => c.actions.filter(a => !a.madeStatId)) ?? []
}

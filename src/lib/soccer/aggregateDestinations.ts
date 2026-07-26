import {
  SOCCER_AGGREGATE_CATEGORY_IDS,
  SOCCER_AGGREGATE_STAT_DEFINITIONS,
  compareSoccerAggregatePlayerRows,
  formatSoccerAggregateRate,
  formatSoccerAggregateStat,
  type SoccerAggregateCategoryId,
  type SoccerAggregateRateId,
  type SoccerCanonicalStatId,
} from './aggregateStats'
import type {
  SoccerAggregateExclusion,
  SoccerAggregatePlayer,
  SoccerAggregateResult,
} from './aggregateProjection'

export type SoccerAggregateMetricId =
  | SoccerCanonicalStatId
  | SoccerAggregateRateId

export interface SoccerAggregateCategoryDestination {
  id: SoccerAggregateCategoryId
  label: string
  defaultMetricId: SoccerAggregateMetricId
  metricIds: SoccerAggregateMetricId[]
  defaultColumnIds: SoccerAggregateMetricId[]
}

const RATE_LABELS: Record<SoccerAggregateRateId, { label: string; shortLabel: string }> = {
  shot_accuracy: { label: 'Shot Accuracy', shortLabel: 'SH%' },
  goal_conversion: { label: 'Goal Conversion', shortLabel: 'G/SH' },
  tackle_win: { label: 'Tackle Win Rate', shortLabel: 'TW%' },
  goalkeeper_save: { label: 'Save Rate', shortLabel: 'SV%' },
}

const CATEGORY_LABELS: Record<SoccerAggregateCategoryId, string> = {
  participation: 'Participation',
  attack: 'Attack',
  defense: 'Defense',
  discipline: 'Discipline',
  goalkeeping: 'Goalkeeping',
}

const CATEGORY_RATES: Partial<
  Record<SoccerAggregateCategoryId, SoccerAggregateRateId[]>
> = {
  attack: ['shot_accuracy', 'goal_conversion'],
  defense: ['tackle_win'],
  goalkeeping: ['goalkeeper_save'],
}

const DEFAULT_METRICS: Record<
  SoccerAggregateCategoryId,
  SoccerAggregateMetricId
> = {
  participation: 'soc_app',
  attack: 'soc_goal',
  defense: 'soc_tkl_won',
  discipline: 'soc_foul_committed',
  goalkeeping: 'soc_gk_save',
}

const DEFAULT_COLUMNS: Record<
  SoccerAggregateCategoryId,
  SoccerAggregateMetricId[]
> = {
  participation: ['soc_app', 'soc_start', 'soc_min_sec', 'soc_cs'],
  attack: ['soc_goal', 'soc_ast', 'soc_sot', 'shot_accuracy', 'goal_conversion'],
  defense: ['soc_tkl_won', 'soc_tkl_att', 'tackle_win', 'soc_int', 'soc_clear'],
  discipline: ['soc_foul_committed', 'soc_foul_drawn', 'soc_yellow', 'soc_red'],
  goalkeeping: [
    'soc_gk_save',
    'soc_gk_ga',
    'soc_gk_sot_faced',
    'goalkeeper_save',
    'soc_gk_pen_save',
  ],
}

export const SOCCER_AGGREGATE_DESTINATION_CATEGORIES:
readonly SoccerAggregateCategoryDestination[] = SOCCER_AGGREGATE_CATEGORY_IDS.map(id => ({
  id,
  label: CATEGORY_LABELS[id],
  defaultMetricId: DEFAULT_METRICS[id],
  metricIds: [
    ...SOCCER_AGGREGATE_STAT_DEFINITIONS
      .filter(definition => definition.categoryId === id)
      .map(definition => definition.id),
    ...(CATEGORY_RATES[id] ?? []),
  ],
  defaultColumnIds: DEFAULT_COLUMNS[id],
}))

const STAT_DEFINITIONS = new Map(
  SOCCER_AGGREGATE_STAT_DEFINITIONS.map(definition => [definition.id, definition])
)

export function soccerAggregateMetricLabel(
  metricId: SoccerAggregateMetricId
): { label: string; shortLabel: string } {
  if (isRateId(metricId)) return RATE_LABELS[metricId]
  const definition = STAT_DEFINITIONS.get(metricId)
  return {
    label: definition?.label ?? metricId,
    shortLabel: definition?.shortLabel ?? metricId,
  }
}

export function soccerAggregateVisibleColumns(
  category: SoccerAggregateCategoryDestination,
  selectedMetricId: SoccerAggregateMetricId
): SoccerAggregateMetricId[] {
  return [
    selectedMetricId,
    ...category.defaultColumnIds.filter(id => id !== selectedMetricId),
  ].slice(0, 5)
}

export function soccerAggregateMetricValue(
  player: SoccerAggregatePlayer,
  metricId: SoccerAggregateMetricId
): number | null {
  if (isRateId(metricId)) return player.rates[metricId]?.value ?? null
  return player.stats[metricId]
}

export function formatSoccerAggregateMetric(
  player: SoccerAggregatePlayer,
  metricId: SoccerAggregateMetricId
): string {
  if (isRateId(metricId)) return formatSoccerAggregateRate(player.rates[metricId])
  return formatSoccerAggregateStat(metricId, player.stats[metricId])
}

export function sortSoccerAggregatePlayers(
  players: SoccerAggregatePlayer[],
  metricId: SoccerAggregateMetricId
): SoccerAggregatePlayer[] {
  return [...players].sort((left, right) => {
    const leftValue = soccerAggregateMetricValue(left, metricId)
    const rightValue = soccerAggregateMetricValue(right, metricId)
    if (leftValue !== rightValue) {
      if (leftValue == null) return 1
      if (rightValue == null) return -1
      return rightValue - leftValue
    }
    return compareSoccerAggregatePlayerRows(left, right)
  })
}

export function soccerAggregateCategoryHasValues(
  players: SoccerAggregatePlayer[],
  category: SoccerAggregateCategoryDestination
): boolean {
  if (category.id === 'participation') return players.length > 0
  return players.some(player =>
    category.metricIds.some(metricId => {
      const value = soccerAggregateMetricValue(player, metricId)
      return value != null && value !== 0
    })
  )
}

export function soccerAggregateManagedDiagnostics(
  aggregate: SoccerAggregateResult
): SoccerAggregateExclusion[] {
  return aggregate.exclusions.filter(exclusion => exclusion.canManage)
}

export function soccerAggregateGenericQualityMessage(
  aggregate: SoccerAggregateResult
): string | null {
  if (aggregate.quality !== 'partial') return null
  const count = aggregate.exclusions.length
  return count === 1
    ? 'One canonical match or player contribution could not be included.'
    : `${count} canonical matches or player contributions could not be included.`
}

function isRateId(metricId: SoccerAggregateMetricId): metricId is SoccerAggregateRateId {
  return metricId in RATE_LABELS
}

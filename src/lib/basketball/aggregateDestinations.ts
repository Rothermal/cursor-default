import {
  BASKETBALL_AGGREGATE_CATEGORY_IDS,
  BASKETBALL_AGGREGATE_STAT_DEFINITIONS,
  BASKETBALL_CANONICAL_STAT_IDS,
  formatBasketballAggregateRate,
  formatBasketballAggregateStat,
  type BasketballAggregateCategoryId,
  type BasketballAggregateRateId,
  type BasketballCanonicalStatId,
} from './aggregateStats'
import type {
  BasketballAggregatePlayer,
  BasketballAggregateResult,
} from './aggregateComposition'
import type { BasketballAggregateExclusion } from './aggregateProjection'

export type BasketballAggregateMetricId =
  | BasketballCanonicalStatId
  | BasketballAggregateRateId

export interface BasketballAggregateCategoryDestination {
  id: BasketballAggregateCategoryId
  label: string
  defaultMetricId: BasketballAggregateMetricId
  metricIds: BasketballAggregateMetricId[]
  defaultColumnIds: BasketballAggregateMetricId[]
  rankingMetricIds: BasketballAggregateMetricId[]
}

const RATE_LABELS: Record<
  BasketballAggregateRateId,
  { label: string; shortLabel: string; percentage: boolean; showOperands: boolean }
> = {
  points_per_game: {
    label: 'Points Per Game', shortLabel: 'PPG', percentage: false, showOperands: false,
  },
  field_goal_percentage: {
    label: 'Field Goal Percentage', shortLabel: 'FG%', percentage: true, showOperands: true,
  },
  two_point_percentage: {
    label: '2-Point Percentage', shortLabel: '2P%', percentage: true, showOperands: true,
  },
  three_point_percentage: {
    label: '3-Point Percentage', shortLabel: '3P%', percentage: true, showOperands: true,
  },
  free_throw_percentage: {
    label: 'Free Throw Percentage', shortLabel: 'FT%', percentage: true, showOperands: true,
  },
  effective_field_goal_percentage: {
    label: 'Effective Field Goal Percentage', shortLabel: 'eFG%',
    percentage: true, showOperands: false,
  },
  true_shooting_percentage: {
    label: 'True Shooting Percentage', shortLabel: 'TS%', percentage: true, showOperands: false,
  },
  assist_to_turnover_ratio: {
    label: 'Assist-to-Turnover Ratio', shortLabel: 'AST/TO',
    percentage: false, showOperands: false,
  },
}

const CATEGORY_LABELS: Record<BasketballAggregateCategoryId, string> = {
  scoring: 'Scoring',
  shooting: 'Shooting',
  rebounding: 'Rebounding',
  playmaking: 'Playmaking',
  defense: 'Defense',
  discipline: 'Discipline',
  participation: 'Participation',
}

const CATEGORY_RATES: Partial<
  Record<BasketballAggregateCategoryId, BasketballAggregateRateId[]>
> = {
  scoring: ['points_per_game', 'true_shooting_percentage'],
  shooting: [
    'field_goal_percentage',
    'two_point_percentage',
    'three_point_percentage',
    'free_throw_percentage',
    'effective_field_goal_percentage',
    'true_shooting_percentage',
  ],
  playmaking: ['assist_to_turnover_ratio'],
}

const DEFAULT_METRICS: Record<
  BasketballAggregateCategoryId,
  BasketballAggregateMetricId
> = {
  scoring: 'bk_pts',
  shooting: 'field_goal_percentage',
  rebounding: 'bk_reb',
  playmaking: 'bk_ast',
  defense: 'bk_stl',
  discipline: 'bk_pf',
  participation: 'bk_app',
}

const DEFAULT_COLUMNS: Record<
  BasketballAggregateCategoryId,
  BasketballAggregateMetricId[]
> = {
  scoring: ['bk_pts', 'points_per_game', 'bk_app', 'true_shooting_percentage'],
  shooting: ['bk_fgm', 'bk_fga', 'field_goal_percentage', 'bk_3pm', 'bk_ftm'],
  rebounding: ['bk_reb', 'bk_oreb', 'bk_dreb', 'bk_app'],
  playmaking: ['bk_ast', 'bk_to', 'assist_to_turnover_ratio', 'bk_app'],
  defense: ['bk_stl', 'bk_blk', 'bk_app'],
  discipline: ['bk_pf', 'bk_dq', 'bk_eject', 'bk_app'],
  participation: ['bk_app', 'bk_start', 'bk_dnp', 'bk_min_sec', 'bk_pm'],
}

const RANKING_METRICS: Record<
  BasketballAggregateCategoryId,
  BasketballAggregateMetricId[]
> = {
  scoring: ['bk_pts', 'points_per_game', 'bk_app'],
  shooting: [
    'field_goal_percentage', 'bk_fgm', 'bk_fga', 'three_point_percentage',
    'free_throw_percentage', 'effective_field_goal_percentage',
    'true_shooting_percentage',
  ],
  rebounding: ['bk_reb', 'bk_oreb', 'bk_dreb', 'bk_app'],
  playmaking: ['bk_ast', 'bk_to', 'assist_to_turnover_ratio', 'bk_app'],
  defense: ['bk_stl', 'bk_blk', 'bk_app'],
  discipline: ['bk_pf', 'bk_dq', 'bk_eject', 'bk_app'],
  participation: ['bk_app', 'bk_start', 'bk_dnp', 'bk_min_sec', 'bk_pm'],
}

export const BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES:
readonly BasketballAggregateCategoryDestination[] = BASKETBALL_AGGREGATE_CATEGORY_IDS.map(id => ({
  id,
  label: CATEGORY_LABELS[id],
  defaultMetricId: DEFAULT_METRICS[id],
  metricIds: [
    ...BASKETBALL_AGGREGATE_STAT_DEFINITIONS
      .filter(definition => definition.categoryId === id)
      .map(definition => definition.id),
    ...(CATEGORY_RATES[id] ?? []),
  ],
  defaultColumnIds: DEFAULT_COLUMNS[id],
  rankingMetricIds: RANKING_METRICS[id],
}))

const STAT_DEFINITIONS = new Map(
  BASKETBALL_AGGREGATE_STAT_DEFINITIONS.map(definition => [definition.id, definition])
)

export function basketballAggregateMetricLabel(
  metricId: BasketballAggregateMetricId
): { label: string; shortLabel: string } {
  if (isRateId(metricId)) {
    const { label, shortLabel } = RATE_LABELS[metricId]
    return { label, shortLabel }
  }
  const definition = STAT_DEFINITIONS.get(metricId)
  return {
    label: definition?.label ?? metricId,
    shortLabel: definition?.shortLabel ?? metricId,
  }
}

export function basketballAggregateVisibleColumns(
  category: BasketballAggregateCategoryDestination,
  selectedMetricId: BasketballAggregateMetricId,
  aggregate?: BasketballAggregateResult
): BasketballAggregateMetricId[] {
  return [
    selectedMetricId,
    ...category.defaultColumnIds.filter(id => id !== selectedMetricId),
  ].filter(metricId => !aggregate || basketballAggregateMetricAvailable(aggregate, metricId))
    .slice(0, 5)
}

export function basketballAggregateMetricValue(
  player: BasketballAggregatePlayer,
  metricId: BasketballAggregateMetricId
): number | null {
  if (isRateId(metricId)) return player.rates[metricId]?.value ?? null
  return player.stats[metricId]
}

export function formatBasketballAggregateMetric(
  player: BasketballAggregatePlayer,
  metricId: BasketballAggregateMetricId
): string {
  if (isRateId(metricId)) {
    return formatBasketballAggregateRate(
      player.rates[metricId],
      RATE_LABELS[metricId].percentage,
      RATE_LABELS[metricId].showOperands
    )
  }
  return formatBasketballAggregateStat(metricId, player.stats[metricId])
}

export function basketballAggregateMetricAvailable(
  aggregate: BasketballAggregateResult,
  metricId: BasketballAggregateMetricId
): boolean {
  const available = new Set(aggregate.availableMetricIds)
  return metricDependencies(metricId).every(id => available.has(id))
}

export function basketballPlayerAggregateMetricAvailable(
  aggregate: BasketballAggregateResult,
  player: BasketballAggregatePlayer,
  metricId: BasketballAggregateMetricId
): boolean {
  if (metricId === 'bk_dnp' || metricId === 'bk_pm') {
    const coverage = player.metricCoverage[metricId]
    if (coverage) return coverage.includedGameCount > 0
  }
  return basketballAggregateMetricAvailable(aggregate, metricId)
}

export function basketballAggregateRankingMetrics(
  aggregate: BasketballAggregateResult,
  category: BasketballAggregateCategoryDestination
): BasketballAggregateMetricId[] {
  return category.rankingMetricIds.filter(metricId =>
    basketballAggregateMetricAvailable(aggregate, metricId)
  )
}

export function sortBasketballAggregatePlayers(
  players: BasketballAggregatePlayer[],
  metricId: BasketballAggregateMetricId,
  tieBreakMetricIds: BasketballAggregateMetricId[] = RANKING_METRICS.scoring
): BasketballAggregatePlayer[] {
  return [...players].sort((left, right) => {
    for (const candidateId of [
      metricId,
      ...tieBreakMetricIds.filter(id => id !== metricId),
    ]) {
      const difference = compareMetricValues(left, right, candidateId)
      if (difference !== 0) return difference
    }
    return left.displayName.localeCompare(right.displayName) ||
      left.playerId.localeCompare(right.playerId)
  })
}

export function basketballAggregateCategoryHasValues(
  players: BasketballAggregatePlayer[],
  category: BasketballAggregateCategoryDestination,
  aggregate?: BasketballAggregateResult
): boolean {
  if (category.id === 'participation') return players.length > 0
  return players.some(player => category.metricIds.some(metricId => {
    if (aggregate && !basketballAggregateMetricAvailable(aggregate, metricId)) return false
    const value = basketballAggregateMetricValue(player, metricId)
    return value != null && value !== 0
  }))
}

export function basketballAggregateManagedDiagnostics(
  aggregate: BasketballAggregateResult
): BasketballAggregateExclusion[] {
  return aggregate.exclusions.filter(exclusion =>
    exclusion.canManage && exclusion.kind !== 'abandoned_game'
  )
}

export function basketballAggregateGenericQualityMessage(
  aggregate: BasketballAggregateResult
): string | null {
  if (aggregate.quality !== 'partial') return null
  const count = aggregate.exclusions.filter(exclusion => [
    'malformed_source',
    'unresolved_participant',
    'duplicate_source',
  ].includes(exclusion.kind)).length
  return count === 1
    ? 'One Basketball game or player contribution could not be included.'
    : `${count} Basketball games or player contributions could not be included.`
}

export function shouldAutoRefreshBasketballAggregates({
  loading,
  visible,
  now,
  lastRefreshAt,
  debounceMs = 250,
}: {
  loading: boolean
  visible: boolean
  now: number
  lastRefreshAt: number
  debounceMs?: number
}): boolean {
  return visible && !loading && now - lastRefreshAt >= debounceMs
}

function metricDependencies(
  metricId: BasketballAggregateMetricId
): BasketballCanonicalStatId[] {
  if (BASKETBALL_CANONICAL_STAT_IDS.includes(metricId as BasketballCanonicalStatId)) {
    return [metricId as BasketballCanonicalStatId]
  }
  switch (metricId) {
    case 'points_per_game': return ['bk_pts', 'bk_app']
    case 'field_goal_percentage': return ['bk_fgm', 'bk_fga']
    case 'two_point_percentage': return ['bk_2pm', 'bk_2pa']
    case 'three_point_percentage': return ['bk_3pm', 'bk_3pa']
    case 'free_throw_percentage': return ['bk_ftm', 'bk_fta']
    case 'effective_field_goal_percentage': return ['bk_fgm', 'bk_3pm', 'bk_fga']
    case 'true_shooting_percentage': return ['bk_pts', 'bk_fga', 'bk_fta']
    case 'assist_to_turnover_ratio': return ['bk_ast', 'bk_to']
  }
  throw new Error(`Unsupported Basketball aggregate metric: ${metricId}`)
}

function compareMetricValues(
  left: BasketballAggregatePlayer,
  right: BasketballAggregatePlayer,
  metricId: BasketballAggregateMetricId
): number {
  const leftValue = basketballAggregateMetricValue(left, metricId)
  const rightValue = basketballAggregateMetricValue(right, metricId)
  if (leftValue === rightValue) return 0
  if (leftValue == null) return 1
  if (rightValue == null) return -1
  return rightValue - leftValue
}

function isRateId(
  metricId: BasketballAggregateMetricId
): metricId is BasketballAggregateRateId {
  return metricId in RATE_LABELS
}

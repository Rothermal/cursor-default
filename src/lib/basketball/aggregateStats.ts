import type { StatCategory, StatColor } from '../../types'
import type { BasketballStatTotals } from './types'

export const BASKETBALL_AGGREGATE_CATEGORY_IDS = [
  'scoring',
  'shooting',
  'rebounding',
  'playmaking',
  'defense',
  'discipline',
  'participation',
] as const

export type BasketballAggregateCategoryId =
  typeof BASKETBALL_AGGREGATE_CATEGORY_IDS[number]

export const BASKETBALL_CANONICAL_STAT_IDS = [
  'bk_app',
  'bk_start',
  'bk_min_sec',
  'bk_pts',
  'bk_fgm',
  'bk_fga',
  'bk_2pm',
  'bk_2pa',
  'bk_3pm',
  'bk_3pa',
  'bk_ftm',
  'bk_fta',
  'bk_oreb',
  'bk_dreb',
  'bk_reb',
  'bk_ast',
  'bk_to',
  'bk_stl',
  'bk_blk',
  'bk_pf',
  'bk_dq',
  'bk_eject',
] as const

export type BasketballCanonicalStatId = typeof BASKETBALL_CANONICAL_STAT_IDS[number]
export type BasketballAggregateStats = Record<BasketballCanonicalStatId, number>
export type BasketballAggregateStatFormat = 'integer' | 'duration'

export interface BasketballAggregateStatDefinition {
  id: BasketballCanonicalStatId
  categoryId: BasketballAggregateCategoryId
  label: string
  shortLabel: string
  format: BasketballAggregateStatFormat
  pointValue?: number
}

interface CategoryDefinition {
  id: BasketballAggregateCategoryId
  name: string
  color: StatColor
}

const CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'scoring', name: 'Scoring', color: 'emerald' },
  { id: 'shooting', name: 'Shooting', color: 'sky' },
  { id: 'rebounding', name: 'Rebounding', color: 'amber' },
  { id: 'playmaking', name: 'Playmaking', color: 'teal' },
  { id: 'defense', name: 'Defense', color: 'violet' },
  { id: 'discipline', name: 'Discipline', color: 'red' },
  { id: 'participation', name: 'Participation', color: 'slate' },
]

export const BASKETBALL_AGGREGATE_STAT_DEFINITIONS:
readonly BasketballAggregateStatDefinition[] = [
  stat('bk_pts', 'scoring', 'Points', 'PTS', 'integer', 1),
  stat('bk_fgm', 'shooting', 'Field Goals Made', 'FGM'),
  stat('bk_fga', 'shooting', 'Field Goals Attempted', 'FGA'),
  stat('bk_2pm', 'shooting', '2-Point Field Goals Made', '2PM'),
  stat('bk_2pa', 'shooting', '2-Point Field Goals Attempted', '2PA'),
  stat('bk_3pm', 'shooting', '3-Point Field Goals Made', '3PM'),
  stat('bk_3pa', 'shooting', '3-Point Field Goals Attempted', '3PA'),
  stat('bk_ftm', 'shooting', 'Free Throws Made', 'FTM'),
  stat('bk_fta', 'shooting', 'Free Throws Attempted', 'FTA'),
  stat('bk_oreb', 'rebounding', 'Offensive Rebounds', 'OREB'),
  stat('bk_dreb', 'rebounding', 'Defensive Rebounds', 'DREB'),
  stat('bk_reb', 'rebounding', 'Rebounds', 'REB'),
  stat('bk_ast', 'playmaking', 'Assists', 'AST'),
  stat('bk_to', 'playmaking', 'Turnovers', 'TO'),
  stat('bk_stl', 'defense', 'Steals', 'STL'),
  stat('bk_blk', 'defense', 'Blocks', 'BLK'),
  stat('bk_pf', 'discipline', 'Personal Fouls', 'PF'),
  stat('bk_dq', 'discipline', 'Disqualifications', 'DQ'),
  stat('bk_eject', 'discipline', 'Ejections', 'EJ'),
  stat('bk_app', 'participation', 'Appearances', 'APP'),
  stat('bk_start', 'participation', 'Starts', 'ST'),
  stat('bk_min_sec', 'participation', 'Recorded Minutes', 'MIN', 'duration'),
]

export type BasketballAggregateRateId =
  | 'points_per_game'
  | 'field_goal_percentage'
  | 'two_point_percentage'
  | 'three_point_percentage'
  | 'free_throw_percentage'
  | 'effective_field_goal_percentage'
  | 'true_shooting_percentage'
  | 'assist_to_turnover_ratio'

export interface BasketballAggregateRate {
  numerator: number
  denominator: number
  value: number
}

export type BasketballAggregateRates = Record<
  BasketballAggregateRateId,
  BasketballAggregateRate | null
>

export interface BasketballAggregateParticipation {
  appeared: boolean
  started: boolean
  disqualified: boolean
  ejected: boolean
}

const DEFINITION_BY_ID = new Map(
  BASKETBALL_AGGREGATE_STAT_DEFINITIONS.map(definition => [definition.id, definition])
)

export function basketballAggregateSportCategories(): StatCategory[] {
  return CATEGORIES.map(category => ({
    id: category.id,
    name: category.name,
    color: category.color,
    actions: BASKETBALL_AGGREGATE_STAT_DEFINITIONS
      .filter(definition => definition.categoryId === category.id)
      .map(definition => ({
        id: definition.id,
        label: definition.label,
        shortLabel: definition.shortLabel,
        pointValue: definition.pointValue,
      })),
  }))
}

export function emptyBasketballAggregateStats(): BasketballAggregateStats {
  return Object.fromEntries(
    BASKETBALL_CANONICAL_STAT_IDS.map(id => [id, 0])
  ) as BasketballAggregateStats
}

export function basketballCanonicalStatsFromTotals(
  totals: BasketballStatTotals,
  participation: BasketballAggregateParticipation
): BasketballAggregateStats {
  const twoPointAttempts = totals['2pt'] + totals['2pt_miss']
  const threePointAttempts = totals['3pt'] + totals['3pt_miss']
  const fieldGoalsMade = totals['2pt'] + totals['3pt']
  const fieldGoalAttempts = twoPointAttempts + threePointAttempts
  const freeThrowAttempts = totals.ft + totals.ft_miss
  return {
    bk_app: participation.appeared ? 1 : 0,
    bk_start: participation.appeared && participation.started ? 1 : 0,
    bk_min_sec: Math.max(0, finiteNumber(totals.min) * 60),
    bk_pts: totals.ft + totals['2pt'] * 2 + totals['3pt'] * 3,
    bk_fgm: fieldGoalsMade,
    bk_fga: fieldGoalAttempts,
    bk_2pm: totals['2pt'],
    bk_2pa: twoPointAttempts,
    bk_3pm: totals['3pt'],
    bk_3pa: threePointAttempts,
    bk_ftm: totals.ft,
    bk_fta: freeThrowAttempts,
    bk_oreb: totals.oreb,
    bk_dreb: totals.dreb,
    bk_reb: totals.oreb + totals.dreb,
    bk_ast: totals.ast,
    bk_to: totals.to,
    bk_stl: totals.stl,
    bk_blk: totals.blk,
    bk_pf: totals.pf,
    bk_dq: participation.disqualified ? 1 : 0,
    bk_eject: participation.ejected ? 1 : 0,
  }
}

export function addBasketballAggregateStatsInPlace(
  target: BasketballAggregateStats,
  source: BasketballAggregateStats
): BasketballAggregateStats {
  for (const id of BASKETBALL_CANONICAL_STAT_IDS) target[id] += source[id]
  return target
}

export function mergeBasketballMatchStats(
  target: BasketballAggregateStats,
  source: BasketballAggregateStats
): BasketballAggregateStats {
  const appearances = Math.max(target.bk_app, source.bk_app)
  const starts = Math.max(target.bk_start, source.bk_start)
  const disqualifications = Math.max(target.bk_dq, source.bk_dq)
  const ejections = Math.max(target.bk_eject, source.bk_eject)
  addBasketballAggregateStatsInPlace(target, source)
  target.bk_app = appearances
  target.bk_start = starts
  target.bk_dq = disqualifications
  target.bk_eject = ejections
  return target
}

export function basketballAggregateRates(
  stats: BasketballAggregateStats
): BasketballAggregateRates {
  return {
    points_per_game: rate(stats.bk_pts, stats.bk_app),
    field_goal_percentage: rate(stats.bk_fgm, stats.bk_fga),
    two_point_percentage: rate(stats.bk_2pm, stats.bk_2pa),
    three_point_percentage: rate(stats.bk_3pm, stats.bk_3pa),
    free_throw_percentage: rate(stats.bk_ftm, stats.bk_fta),
    effective_field_goal_percentage: rate(
      stats.bk_fgm + 0.5 * stats.bk_3pm,
      stats.bk_fga
    ),
    true_shooting_percentage: rate(
      stats.bk_pts,
      2 * (stats.bk_fga + 0.44 * stats.bk_fta)
    ),
    assist_to_turnover_ratio: rate(stats.bk_ast, stats.bk_to),
  }
}

export function formatBasketballAggregateDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function formatBasketballAggregateStat(
  id: BasketballCanonicalStatId,
  value: number
): string {
  return DEFINITION_BY_ID.get(id)?.format === 'duration'
    ? formatBasketballAggregateDuration(value)
    : String(value)
}

export function formatBasketballAggregateRate(
  value: BasketballAggregateRate | null,
  percentage: boolean
): string {
  if (!value) return '-'
  return percentage
    ? `${Math.round(value.value * 100)}% (${value.numerator}/${value.denominator})`
    : value.value.toFixed(2)
}

export function hasBasketballBaseContribution(totals: BasketballStatTotals): boolean {
  return Object.values(totals).some(value => finiteNumber(value) !== 0)
}

function stat(
  id: BasketballCanonicalStatId,
  categoryId: BasketballAggregateCategoryId,
  label: string,
  shortLabel: string,
  format: BasketballAggregateStatFormat = 'integer',
  pointValue?: number
): BasketballAggregateStatDefinition {
  return { id, categoryId, label, shortLabel, format, ...(pointValue ? { pointValue } : {}) }
}

function rate(numerator: number, denominator: number): BasketballAggregateRate | null {
  if (denominator <= 0) return null
  return { numerator, denominator, value: numerator / denominator }
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

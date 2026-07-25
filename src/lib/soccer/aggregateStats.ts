import type { StatCategory, StatColor } from '../../types'

export const SOCCER_AGGREGATE_CATEGORY_IDS = [
  'participation',
  'attack',
  'defense',
  'discipline',
  'goalkeeping',
] as const

export type SoccerAggregateCategoryId =
  typeof SOCCER_AGGREGATE_CATEGORY_IDS[number]

export const SOCCER_CANONICAL_STAT_IDS = [
  'soc_app',
  'soc_start',
  'soc_min_sec',
  'soc_cs',
  'soc_goal',
  'soc_own_goal',
  'soc_ast',
  'soc_ast_primary',
  'soc_ast_secondary',
  'soc_shot',
  'soc_sot',
  'soc_key_pass',
  'soc_chance_created',
  'soc_pen_att',
  'soc_pen_goal',
  'soc_dfk_att',
  'soc_dfk_goal',
  'soc_tkl_att',
  'soc_tkl_won',
  'soc_tkl_lost',
  'soc_int',
  'soc_clear',
  'soc_recovery',
  'soc_block',
  'soc_foul_committed',
  'soc_foul_drawn',
  'soc_yellow',
  'soc_red',
  'soc_gk_save',
  'soc_gk_ga',
  'soc_gk_sot_faced',
  'soc_gk_pen_faced',
  'soc_gk_pen_save',
] as const

export type SoccerCanonicalStatId = typeof SOCCER_CANONICAL_STAT_IDS[number]
export type SoccerAggregateStats = Record<SoccerCanonicalStatId, number>
export type SoccerAggregateStatFormat = 'integer' | 'duration'

export interface SoccerAggregateStatDefinition {
  id: SoccerCanonicalStatId
  categoryId: SoccerAggregateCategoryId
  label: string
  shortLabel: string
  format: SoccerAggregateStatFormat
  pointValue?: number
}

interface CategoryDefinition {
  id: SoccerAggregateCategoryId
  name: string
  color: StatColor
}

const CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'participation', name: 'Participation', color: 'teal' },
  { id: 'attack', name: 'Attack', color: 'emerald' },
  { id: 'defense', name: 'Defense', color: 'sky' },
  { id: 'discipline', name: 'Discipline', color: 'amber' },
  { id: 'goalkeeping', name: 'Goalkeeping', color: 'violet' },
]

export const SOCCER_AGGREGATE_STAT_DEFINITIONS: readonly SoccerAggregateStatDefinition[] = [
  stat('soc_app', 'participation', 'Appearances', 'APP'),
  stat('soc_start', 'participation', 'Starts', 'ST'),
  stat('soc_min_sec', 'participation', 'Minutes', 'MIN', 'duration'),
  stat('soc_cs', 'participation', 'Clean Sheets', 'CS'),
  stat('soc_goal', 'attack', 'Goals', 'G', 'integer', 1),
  stat('soc_own_goal', 'attack', 'Own Goals', 'OG'),
  stat('soc_ast', 'attack', 'Assists', 'A'),
  stat('soc_ast_primary', 'attack', 'Primary Assists', 'A1'),
  stat('soc_ast_secondary', 'attack', 'Secondary Assists', 'A2'),
  stat('soc_shot', 'attack', 'Shots', 'SH'),
  stat('soc_sot', 'attack', 'Shots on Target', 'SOT'),
  stat('soc_key_pass', 'attack', 'Key Passes', 'KP'),
  stat('soc_chance_created', 'attack', 'Chances Created', 'CC'),
  stat('soc_pen_att', 'attack', 'Penalty Attempts', 'PA'),
  stat('soc_pen_goal', 'attack', 'Penalty Goals', 'PG'),
  stat('soc_dfk_att', 'attack', 'Direct Free Kick Attempts', 'DFA'),
  stat('soc_dfk_goal', 'attack', 'Direct Free Kick Goals', 'DFG'),
  stat('soc_tkl_att', 'defense', 'Tackles Attempted', 'TA'),
  stat('soc_tkl_won', 'defense', 'Tackles Won', 'TW'),
  stat('soc_tkl_lost', 'defense', 'Tackles Lost', 'TL'),
  stat('soc_int', 'defense', 'Interceptions', 'INT'),
  stat('soc_clear', 'defense', 'Clearances', 'CLR'),
  stat('soc_recovery', 'defense', 'Recoveries', 'REC'),
  stat('soc_block', 'defense', 'Blocked Shots', 'BLK'),
  stat('soc_foul_committed', 'discipline', 'Fouls Committed', 'FC'),
  stat('soc_foul_drawn', 'discipline', 'Fouls Drawn', 'FD'),
  stat('soc_yellow', 'discipline', 'Yellow Cards', 'YC'),
  stat('soc_red', 'discipline', 'Red Cards', 'RC'),
  stat('soc_gk_save', 'goalkeeping', 'Saves', 'SV'),
  stat('soc_gk_ga', 'goalkeeping', 'Goals Allowed', 'GA'),
  stat('soc_gk_sot_faced', 'goalkeeping', 'Shots on Target Faced', 'SOTF'),
  stat('soc_gk_pen_faced', 'goalkeeping', 'Penalties Faced', 'PF'),
  stat('soc_gk_pen_save', 'goalkeeping', 'Penalty Saves', 'PS'),
]

export const SOCCER_LEGACY_STAT_ALIASES = {
  s_goal: 'soc_goal',
  s_ast: 'soc_ast',
  s_shot: 'soc_shot',
  sot: 'soc_sot',
  s_tackle: 'soc_tkl_att',
  s_int: 'soc_int',
  clearance: 'soc_clear',
  foul: 'soc_foul_committed',
  yellow: 'soc_yellow',
  red_card: 'soc_red',
  s_sv: 'soc_gk_save',
  s_ga: 'soc_gk_ga',
} as const satisfies Record<string, SoccerCanonicalStatId>

export type SoccerAggregateRateId =
  | 'shot_accuracy'
  | 'goal_conversion'
  | 'tackle_win'
  | 'goalkeeper_save'

export interface SoccerAggregateRate {
  numerator: number
  denominator: number
  value: number
}

export type SoccerAggregateRates = Record<
  SoccerAggregateRateId,
  SoccerAggregateRate | null
>

const DEFINITION_BY_ID = new Map(
  SOCCER_AGGREGATE_STAT_DEFINITIONS.map(definition => [definition.id, definition])
)

export function soccerAggregateSportCategories(): StatCategory[] {
  return CATEGORIES.map(category => ({
    id: category.id,
    name: category.name,
    color: category.color,
    actions: SOCCER_AGGREGATE_STAT_DEFINITIONS
      .filter(definition => definition.categoryId === category.id)
      .map(definition => ({
        id: definition.id,
        label: definition.label,
        shortLabel: definition.shortLabel,
        pointValue: definition.pointValue,
      })),
  }))
}

export function emptySoccerAggregateStats(): SoccerAggregateStats {
  return Object.fromEntries(
    SOCCER_CANONICAL_STAT_IDS.map(id => [id, 0])
  ) as SoccerAggregateStats
}

export function normalizeSoccerAggregateStats(
  values: Record<string, number | undefined>
): SoccerAggregateStats {
  const normalized = emptySoccerAggregateStats()
  for (const id of SOCCER_CANONICAL_STAT_IDS) {
    normalized[id] = finiteInteger(values[id])
  }
  for (const [legacyId, canonicalId] of Object.entries(SOCCER_LEGACY_STAT_ALIASES)) {
    if (values[canonicalId] !== undefined) continue
    normalized[canonicalId] = finiteInteger(values[legacyId])
  }
  return normalized
}

export function addSoccerAggregateStats(
  target: SoccerAggregateStats,
  source: SoccerAggregateStats
): SoccerAggregateStats {
  for (const id of SOCCER_CANONICAL_STAT_IDS) {
    target[id] += source[id]
  }
  return target
}

export function soccerAggregateRates(
  stats: SoccerAggregateStats
): SoccerAggregateRates {
  return {
    shot_accuracy: rate(stats.soc_sot, stats.soc_shot),
    goal_conversion: rate(stats.soc_goal, stats.soc_shot),
    tackle_win: rate(stats.soc_tkl_won, stats.soc_tkl_att),
    goalkeeper_save: rate(stats.soc_gk_save, stats.soc_gk_sot_faced),
  }
}

export function formatSoccerAggregateDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function formatSoccerAggregateRate(
  value: SoccerAggregateRate | null
): string {
  if (!value) return '-'
  return `${Math.round(value.value * 100)}% (${value.numerator}/${value.denominator})`
}

export function formatSoccerAggregateStat(
  id: SoccerCanonicalStatId,
  value: number
): string {
  return DEFINITION_BY_ID.get(id)?.format === 'duration'
    ? formatSoccerAggregateDuration(value)
    : String(value)
}

export function compareSoccerAggregatePlayerRows(
  left: { playerId: string; displayName: string; stats: SoccerAggregateStats },
  right: { playerId: string; displayName: string; stats: SoccerAggregateStats },
  sortId: SoccerCanonicalStatId = 'soc_goal'
): number {
  const selectedDifference = right.stats[sortId] - left.stats[sortId]
  if (selectedDifference !== 0) return selectedDifference
  for (const id of ['soc_goal', 'soc_ast', 'soc_sot', 'soc_min_sec'] as const) {
    if (id === sortId) continue
    const difference = right.stats[id] - left.stats[id]
    if (difference !== 0) return difference
  }
  return left.displayName.localeCompare(right.displayName) ||
    left.playerId.localeCompare(right.playerId)
}

function stat(
  id: SoccerCanonicalStatId,
  categoryId: SoccerAggregateCategoryId,
  label: string,
  shortLabel: string,
  format: SoccerAggregateStatFormat = 'integer',
  pointValue?: number
): SoccerAggregateStatDefinition {
  return { id, categoryId, label, shortLabel, format, pointValue }
}

function finiteInteger(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : 0
}

function rate(numerator: number, denominator: number): SoccerAggregateRate | null {
  if (denominator <= 0) return null
  return { numerator, denominator, value: numerator / denominator }
}

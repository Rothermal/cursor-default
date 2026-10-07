import { HOCKEY_GAME_LINE_STAT_IDS } from './gameLines'
import { formatHockeyClock } from './live'
import { HOCKEY_FILLED_STAT_IDS } from './stats'

/**
 * Season totals (HKY-6B2): the per-game `hky_*` lines summed across completed games. Shootout
 * lines are match-scoped and never summed. Rates are read from the totals, never summed.
 */

export const HOCKEY_AGGREGATE_STAT_IDS: readonly string[] = Object.freeze([
  ...HOCKEY_FILLED_STAT_IDS,
  ...HOCKEY_GAME_LINE_STAT_IDS,
])

export type HockeyAggregateStats = Record<string, number>

export function emptyHockeyAggregateStats(): HockeyAggregateStats {
  return Object.fromEntries(HOCKEY_AGGREGATE_STAT_IDS.map(id => [id, 0]))
}

/** Keeps only the summed ids, so a shootout line never enters a total. */
export function hockeyAggregateStatsFromLine(line: Record<string, number> | undefined): HockeyAggregateStats {
  const stats = emptyHockeyAggregateStats()
  for (const id of HOCKEY_AGGREGATE_STAT_IDS) {
    const value = line?.[id]
    if (typeof value === 'number' && Number.isFinite(value)) stats[id] = value
  }
  return stats
}

export function addHockeyAggregateStats(target: HockeyAggregateStats, source: HockeyAggregateStats): void {
  for (const id of HOCKEY_AGGREGATE_STAT_IDS) target[id] = (target[id] ?? 0) + (source[id] ?? 0)
}

export type HockeyAggregateRole = 'skater' | 'goalie'

/** Plus/minus and time in net carry the games they are known for (`n of m games`). */
export interface HockeyAggregateCoverage {
  included: number
  total: number
}

export interface HockeyAggregatePlayerLine {
  playerId: string
  displayName: string
  number: string | null
  /** Games dressed as a skater and as a goalie. */
  skaterGames: number
  goalieGames: number
  stats: HockeyAggregateStats
  /** Skater games whose every goal had a complete on-ice set. */
  plusMinus: HockeyAggregateCoverage
  /** Goalie games with complete time in net; GAA needs every one. */
  timeInNet: HockeyAggregateCoverage
  /** Time in net as a share of each game's regulation length, summed: the GAA denominator. */
  regulationGamesInNet: number
}

export type HockeyAggregateMetricId =
  | 'hky_gp' | 'hky_gs' | 'hky_g' | 'hky_a' | 'hky_pts' | 'points_per_game'
  | 'hky_sog' | 'hky_sat' | 'shooting_pct'
  | 'hky_ppg' | 'hky_ppa' | 'hky_shg' | 'hky_sha' | 'hky_gwg' | 'hky_eng'
  | 'hky_fow' | 'hky_fol' | 'faceoff_pct'
  | 'hky_hit' | 'hky_blk' | 'hky_tk' | 'hky_gv'
  | 'hky_pim' | 'hky_pen' | 'hky_pend'
  | 'hky_pm'
  | 'hky_w' | 'hky_l' | 'hky_otl' | 'hky_t' | 'hky_sa' | 'hky_sv' | 'save_pct' | 'hky_ga' | 'gaa' | 'hky_so' | 'hky_toi_ms'

export interface HockeyAggregateMetric {
  id: HockeyAggregateMetricId
  label: string
  shortLabel: string
  /** Ranked lowest first. */
  lowerIsBetter?: boolean
}

const METRICS: readonly HockeyAggregateMetric[] = [
  { id: 'hky_gp', label: 'Games played', shortLabel: 'GP' },
  { id: 'hky_gs', label: 'Games started', shortLabel: 'GS' },
  { id: 'hky_g', label: 'Goals', shortLabel: 'G' },
  { id: 'hky_a', label: 'Assists', shortLabel: 'A' },
  { id: 'hky_pts', label: 'Points', shortLabel: 'PTS' },
  { id: 'points_per_game', label: 'Points per game', shortLabel: 'P/GP' },
  { id: 'hky_sog', label: 'Shots on goal', shortLabel: 'SOG' },
  { id: 'hky_sat', label: 'Shot attempts', shortLabel: 'SAT' },
  { id: 'shooting_pct', label: 'Shooting percentage', shortLabel: 'S%' },
  { id: 'hky_ppg', label: 'Power-play goals', shortLabel: 'PPG' },
  { id: 'hky_ppa', label: 'Power-play assists', shortLabel: 'PPA' },
  { id: 'hky_shg', label: 'Short-handed goals', shortLabel: 'SHG' },
  { id: 'hky_sha', label: 'Short-handed assists', shortLabel: 'SHA' },
  { id: 'hky_gwg', label: 'Game-winning goals', shortLabel: 'GWG' },
  { id: 'hky_eng', label: 'Empty-net goals', shortLabel: 'ENG' },
  { id: 'hky_fow', label: 'Faceoffs won', shortLabel: 'FOW' },
  { id: 'hky_fol', label: 'Faceoffs lost', shortLabel: 'FOL' },
  { id: 'faceoff_pct', label: 'Faceoff percentage', shortLabel: 'FO%' },
  { id: 'hky_hit', label: 'Hits', shortLabel: 'HIT' },
  { id: 'hky_blk', label: 'Blocked shots', shortLabel: 'BLK' },
  { id: 'hky_tk', label: 'Takeaways', shortLabel: 'TK' },
  { id: 'hky_gv', label: 'Giveaways', shortLabel: 'GV' },
  { id: 'hky_pim', label: 'Penalty minutes', shortLabel: 'PIM' },
  { id: 'hky_pen', label: 'Penalties taken', shortLabel: 'PEN' },
  { id: 'hky_pend', label: 'Penalties drawn', shortLabel: 'PD' },
  { id: 'hky_pm', label: 'Plus/minus', shortLabel: '+/-' },
  { id: 'hky_w', label: 'Wins', shortLabel: 'W' },
  { id: 'hky_l', label: 'Losses', shortLabel: 'L' },
  { id: 'hky_otl', label: 'Overtime and shootout losses', shortLabel: 'OTL' },
  { id: 'hky_t', label: 'Ties', shortLabel: 'T' },
  { id: 'hky_sa', label: 'Shots against', shortLabel: 'SA' },
  { id: 'hky_sv', label: 'Saves', shortLabel: 'SV' },
  { id: 'save_pct', label: 'Save percentage', shortLabel: 'SV%' },
  { id: 'hky_ga', label: 'Goals against', shortLabel: 'GA' },
  { id: 'gaa', label: 'Goals-against average', shortLabel: 'GAA', lowerIsBetter: true },
  { id: 'hky_so', label: 'Shutouts', shortLabel: 'SO' },
  { id: 'hky_toi_ms', label: 'Time in net', shortLabel: 'TOI' },
]

export function hockeyAggregateMetric(id: HockeyAggregateMetricId): HockeyAggregateMetric {
  return METRICS.find(metric => metric.id === id)!
}

export interface HockeyAggregateCategory {
  id: string
  label: string
  role: HockeyAggregateRole
  metricIds: HockeyAggregateMetricId[]
  defaultMetricId: HockeyAggregateMetricId
}

/** Skater categories, then Goaltending; goalies rank only against goalies. */
export const HOCKEY_AGGREGATE_CATEGORIES: readonly HockeyAggregateCategory[] = [
  { id: 'scoring', label: 'Scoring', role: 'skater', defaultMetricId: 'hky_pts', metricIds: ['hky_gp', 'hky_g', 'hky_a', 'hky_pts', 'points_per_game', 'hky_gwg', 'hky_eng'] },
  { id: 'shooting', label: 'Shooting', role: 'skater', defaultMetricId: 'hky_sog', metricIds: ['hky_gp', 'hky_sog', 'hky_sat', 'shooting_pct'] },
  { id: 'special_teams', label: 'Special teams', role: 'skater', defaultMetricId: 'hky_ppg', metricIds: ['hky_ppg', 'hky_ppa', 'hky_shg', 'hky_sha'] },
  { id: 'faceoffs', label: 'Faceoffs', role: 'skater', defaultMetricId: 'hky_fow', metricIds: ['hky_fow', 'hky_fol', 'faceoff_pct'] },
  { id: 'physical', label: 'Physical', role: 'skater', defaultMetricId: 'hky_hit', metricIds: ['hky_hit', 'hky_blk', 'hky_tk', 'hky_gv'] },
  { id: 'discipline', label: 'Discipline', role: 'skater', defaultMetricId: 'hky_pim', metricIds: ['hky_pim', 'hky_pen', 'hky_pend'] },
  { id: 'plus_minus', label: 'Plus/minus', role: 'skater', defaultMetricId: 'hky_pm', metricIds: ['hky_gp', 'hky_pm'] },
  {
    id: 'goaltending',
    label: 'Goaltending',
    role: 'goalie',
    defaultMetricId: 'save_pct',
    metricIds: ['hky_gp', 'hky_gs', 'hky_w', 'hky_l', 'hky_otl', 'hky_t', 'hky_sa', 'hky_sv', 'save_pct', 'hky_ga', 'gaa', 'hky_so', 'hky_toi_ms'],
  },
]

/** Games played in the role a category ranks: a goalie's skating line never mixes with skaters. */
export function hockeyAggregateRoleGames(player: HockeyAggregatePlayerLine, role: HockeyAggregateRole): number {
  return role === 'goalie' ? player.goalieGames : player.skaterGames
}

/**
 * The value a table shows and ranks, or null when its inputs are missing: a rate with no
 * attempts, and GAA or time in net unless every goalie game has complete time in net.
 * Plus/minus counts only games where every goal had a complete on-ice set, and needs one.
 */
export function hockeyAggregateMetricValue(
  player: HockeyAggregatePlayerLine,
  id: HockeyAggregateMetricId
): number | null {
  const stat = (key: string) => player.stats[key] ?? 0
  switch (id) {
    case 'points_per_game':
      return player.skaterGames > 0 ? stat('hky_pts') / player.skaterGames : null
    case 'shooting_pct':
      return stat('hky_sog') > 0 ? stat('hky_g') / stat('hky_sog') : null
    case 'faceoff_pct': {
      const taken = stat('hky_fow') + stat('hky_fol')
      return taken > 0 ? stat('hky_fow') / taken : null
    }
    case 'save_pct':
      return stat('hky_sa') > 0 ? stat('hky_sv') / stat('hky_sa') : null
    case 'gaa':
      return timeInNetComplete(player) && player.regulationGamesInNet > 0
        ? stat('hky_ga') / player.regulationGamesInNet
        : null
    case 'hky_toi_ms':
      return timeInNetComplete(player) ? stat('hky_toi_ms') : null
    case 'hky_pm':
      // Shown when at least one game counted, with "n of m games" beside it.
      return player.plusMinus.included > 0 ? stat('hky_pm') : null
    default:
      return stat(id)
  }
}

function timeInNetComplete(player: HockeyAggregatePlayerLine): boolean {
  return player.timeInNet.total > 0 && player.timeInNet.included === player.timeInNet.total
}

export function formatHockeyAggregateMetric(player: HockeyAggregatePlayerLine, id: HockeyAggregateMetricId): string {
  const value = hockeyAggregateMetricValue(player, id)
  if (value === null) return '–'
  switch (id) {
    case 'points_per_game':
    case 'gaa':
      return value.toFixed(2)
    case 'shooting_pct':
    case 'faceoff_pct':
      return `${(value * 100).toFixed(1)}%`
    case 'save_pct': {
      const text = value.toFixed(3)
      return text.startsWith('0') ? text.slice(1) : text
    }
    case 'hky_toi_ms':
      return formatHockeyClock(value)
    case 'hky_pm':
      return value > 0 ? `+${value}` : String(value)
    case 'hky_pim':
      return Number.isInteger(value) ? String(value) : value.toFixed(1)
    default:
      return String(value)
  }
}

/**
 * Players for a category: only those with a game in its role, ranked by the metric (nulls
 * last), then points or saves, then name.
 */
export function rankHockeyAggregatePlayers<T extends HockeyAggregatePlayerLine>(
  players: readonly T[],
  category: HockeyAggregateCategory,
  metricId: HockeyAggregateMetricId
): T[] {
  const lower = hockeyAggregateMetric(metricId).lowerIsBetter === true
  const tiebreak = category.role === 'goalie' ? 'hky_sv' : 'hky_pts'
  return players
    .filter(player => hockeyAggregateRoleGames(player, category.role) > 0 || isRosterOnly(player, category.role))
    .sort((left, right) => {
      const a = hockeyAggregateMetricValue(left, metricId)
      const b = hockeyAggregateMetricValue(right, metricId)
      if (a !== b) {
        if (a === null) return 1
        if (b === null) return -1
        return lower ? a - b : b - a
      }
      return (right.stats[tiebreak] ?? 0) - (left.stats[tiebreak] ?? 0) ||
        left.displayName.localeCompare(right.displayName) ||
        left.playerId.localeCompare(right.playerId)
    })
}

/** A roster player with no games yet shows as a zero row among the skaters. */
function isRosterOnly(player: HockeyAggregatePlayerLine, role: HockeyAggregateRole): boolean {
  return role === 'skater' && player.skaterGames === 0 && player.goalieGames === 0
}

/** Metrics a category can rank by here: a rate, GAA or TOI only when someone has it. */
export function hockeyAggregateRankingMetrics(
  players: readonly HockeyAggregatePlayerLine[],
  category: HockeyAggregateCategory
): HockeyAggregateMetricId[] {
  return category.metricIds.filter(id => {
    if (id === 'hky_gp' || id === 'hky_gs') return true
    return players.some(player =>
      hockeyAggregateRoleGames(player, category.role) > 0 && hockeyAggregateMetricValue(player, id) !== null
    )
  })
}

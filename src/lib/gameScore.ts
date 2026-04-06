import type { SportConfig } from '../types'
import { computePlayerScore } from '../config/sports'

/** Scoreboard / W–L home total: standalone when set, else legacy computed + adjustment. */
export function getDisplayedHomeScore(
  sport: SportConfig,
  players: { stats: Record<string, number> }[],
  homeTeamScore: number | null,
  homeScoreAdjustment: number
): number {
  if (homeTeamScore != null) {
    return homeTeamScore
  }
  const computed = players.reduce((t, p) => t + computePlayerScore(sport, p.stats), 0)
  return computed + homeScoreAdjustment
}

/** Finalized game row + aggregated team stats (sum across players). */
export function resolveFinalHomeScoreFromGameRow(
  sport: SportConfig,
  statsTotalsByStatId: Record<string, number>,
  row: { home_team_score?: number | null; home_score_adjustment?: number | null }
): number {
  if (row.home_team_score != null) {
    return row.home_team_score
  }
  const base = computePlayerScore(sport, statsTotalsByStatId)
  return base + (row.home_score_adjustment ?? 0)
}

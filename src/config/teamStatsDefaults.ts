import type { BasketballTeamStatsConfig, SportConfig, TeamStatsConfig } from '../types'

/** NFHS-style defaults (halves, 1-and-1 at 7, double bonus at 10). */
export const BASKETBALL_TEAM_STATS_DEFAULTS: BasketballTeamStatsConfig = {
  periodsPerGame: 2,
  periodLabels: ['1st Half', '2nd Half'],
  bonusThreshold: 7,
  doubleBonusThreshold: 10,
  hasOneAndOne: true,
  overtimeLabel: 'OT',
  overtimeFoulsReset: true,
  timeoutsPerPeriod: null,
  timeoutsPerOvertime: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge sport defaults with optional season JSON from `seasons.team_stats_config`.
 * Returns null when the sport has no team-level tracking.
 */
export function resolveTeamStatsConfig(
  sport: SportConfig,
  seasonConfig: unknown
): TeamStatsConfig | null {
  if (!sport.teamCategories?.length) return null
  if (sport.id !== 'basketball') return null

  const base = { ...BASKETBALL_TEAM_STATS_DEFAULTS }
  if (!isRecord(seasonConfig)) {
    return base
  }

  const periodsPerGame =
    typeof seasonConfig.periodsPerGame === 'number' && seasonConfig.periodsPerGame >= 1
      ? seasonConfig.periodsPerGame
      : base.periodsPerGame

  let periodLabels = base.periodLabels
  if (Array.isArray(seasonConfig.periodLabels)) {
    const labels = seasonConfig.periodLabels.filter((x): x is string => typeof x === 'string')
    if (labels.length === periodsPerGame) {
      periodLabels = labels
    }
  }

  return {
    periodsPerGame,
    periodLabels,
    bonusThreshold:
      typeof seasonConfig.bonusThreshold === 'number' && seasonConfig.bonusThreshold >= 1
        ? seasonConfig.bonusThreshold
        : base.bonusThreshold,
    doubleBonusThreshold:
      typeof seasonConfig.doubleBonusThreshold === 'number' &&
      seasonConfig.doubleBonusThreshold >= 1
        ? seasonConfig.doubleBonusThreshold
        : base.doubleBonusThreshold,
    hasOneAndOne:
      typeof seasonConfig.hasOneAndOne === 'boolean' ? seasonConfig.hasOneAndOne : base.hasOneAndOne,
    overtimeLabel:
      typeof seasonConfig.overtimeLabel === 'string' && seasonConfig.overtimeLabel.length > 0
        ? seasonConfig.overtimeLabel
        : base.overtimeLabel,
    overtimeFoulsReset:
      typeof seasonConfig.overtimeFoulsReset === 'boolean'
        ? seasonConfig.overtimeFoulsReset
        : base.overtimeFoulsReset,
    timeoutsPerPeriod:
      typeof seasonConfig.timeoutsPerPeriod === 'number' && seasonConfig.timeoutsPerPeriod >= 0
        ? Math.floor(seasonConfig.timeoutsPerPeriod)
        : base.timeoutsPerPeriod,
    timeoutsPerOvertime:
      typeof seasonConfig.timeoutsPerOvertime === 'number' && seasonConfig.timeoutsPerOvertime >= 0
        ? Math.floor(seasonConfig.timeoutsPerOvertime)
        : base.timeoutsPerOvertime,
  }
}

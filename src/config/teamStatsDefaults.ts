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

export interface BasketballTeamStatsPreset {
  id: string
  label: string
  /** Partial override merged on top of {@link BASKETBALL_TEAM_STATS_DEFAULTS}. */
  config: Partial<BasketballTeamStatsConfig>
}

/**
 * Named rulesets for season UI (WU-8) and docs. Values are approximate; leagues vary.
 * "NFHS" entry matches {@link BASKETBALL_TEAM_STATS_DEFAULTS}.
 */
export const BASKETBALL_PRESETS: BasketballTeamStatsPreset[] = [
  { id: 'nfhs', label: 'NFHS (halves)', config: {} },
  /** Same numeric rules as NFHS for typical NCAA mens play; separate id for season UI labeling. */
  { id: 'ncaa', label: 'NCAA (halves)', config: {} },
  {
    id: 'nba',
    label: 'NBA (quarters)',
    config: {
      periodsPerGame: 4,
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeFoulsReset: true,
      timeoutsPerPeriod: null,
      timeoutsPerOvertime: null,
    },
  },
  {
    id: 'fiba',
    label: 'FIBA (quarters)',
    config: {
      periodsPerGame: 4,
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeFoulsReset: true,
    },
  },
  {
    id: 'youth_halves',
    label: 'Youth / rec (halves)',
    config: {
      periodsPerGame: 2,
      bonusThreshold: 6,
      doubleBonusThreshold: 9,
      hasOneAndOne: true,
    },
  },
  {
    id: 'youth_quarters',
    label: 'Youth / rec (quarters)',
    config: {
      periodsPerGame: 4,
      bonusThreshold: 4,
      doubleBonusThreshold: 7,
      hasOneAndOne: true,
    },
  },
]

/** Regulation period button labels when the season does not define `periodLabels`. */
export function getDefaultPeriodLabels(periodsPerGame: number): string[] {
  const n = Math.max(1, Math.floor(periodsPerGame))
  if (n === 2) {
    return ['1st Half', '2nd Half']
  }
  return Array.from({ length: n }, (_, i) => `Q${i + 1}`)
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
  if (periodLabels.length !== periodsPerGame) {
    periodLabels = getDefaultPeriodLabels(periodsPerGame)
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

/** Serialize resolved basketball team rules for `seasons.team_stats_config` (jsonb). */
export function seasonTeamStatsConfigToJson(config: TeamStatsConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    periodsPerGame: config.periodsPerGame,
    periodLabels: config.periodLabels,
    bonusThreshold: config.bonusThreshold,
    doubleBonusThreshold: config.doubleBonusThreshold,
    hasOneAndOne: config.hasOneAndOne,
    overtimeLabel: config.overtimeLabel,
    overtimeFoulsReset: config.overtimeFoulsReset,
  }
  if (config.timeoutsPerPeriod != null) {
    out.timeoutsPerPeriod = config.timeoutsPerPeriod
  }
  if (config.timeoutsPerOvertime != null) {
    out.timeoutsPerOvertime = config.timeoutsPerOvertime
  }
  return out
}

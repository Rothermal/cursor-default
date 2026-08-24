import {
  BASKETBALL_TEAM_STATS_DEFAULTS,
  getDefaultPeriodLabels,
} from '../../config/teamStatsDefaults'
import { isPlainObject } from '../gameEvents/envelope'
import {
  getBasketballRulesProfile,
  type BasketballRulesProfileRef,
} from './profiles'
import { parseBasketballTeamSettings, type BasketballTeamSettingsV1 } from './settings'
import type {
  BasketballFoulWindowRule,
  BasketballMatchSegmentV2,
  BasketballOvertimeFoulPolicy,
  BasketballOvertimeTimeoutPolicy,
  BasketballTimeoutPoolRule,
} from './types'

const MAX_PERIODS = 20
const MAX_LABEL_LENGTH = 120

export type BasketballLegacySeasonImportPreview =
  | {
      ok: true
      settings: BasketballTeamSettingsV1
      legacySummary: string[]
      legacyDefaultedFields: string[]
      fallbackSummary: string[]
      mappingSummary: string[]
    }
  | { ok: false; error: string }

interface ResolvedLegacySeasonRules {
  periodsPerGame: number
  periodLabels: string[]
  bonusThreshold: number
  doubleBonusThreshold: number
  hasOneAndOne: boolean
  overtimeLabel: string
  overtimeFoulsReset: boolean
  timeoutsPerPeriod: number | null
  timeoutsPerOvertime: number | null
  defaultedFields: string[]
}

export function previewBasketballLegacySeasonImport(
  value: unknown,
  fallbackProfile: BasketballRulesProfileRef
): BasketballLegacySeasonImportPreview {
  const profile = getBasketballRulesProfile(
    fallbackProfile.profileId,
    fallbackProfile.profileVersion
  )
  if (!profile) return { ok: false, error: 'Select an available fallback tracking profile.' }

  const legacy = resolveLegacySeasonRules(value)
  if (!legacy.ok) return legacy
  const rules = legacy.value
  const regulationSegments: BasketballMatchSegmentV2[] = []
  const foulWindows: BasketballFoulWindowRule[] = []
  const timeoutPools: BasketballTimeoutPoolRule[] = []

  for (let index = 0; index < rules.periodsPerGame; index += 1) {
    const number = index + 1
    const baseSegment = profile.rules.regulationSegments[index] ??
      profile.rules.regulationSegments[0]
    const segmentId = `regulation-${number}`
    const foulWindowId = `legacy-foul-${number}`
    const timeoutPoolId = `legacy-timeout-${number}`
    regulationSegments.push({
      id: segmentId,
      label: rules.periodLabels[index] ?? `Period ${number}`,
      kind: 'regulation',
      order: number,
      durationMs: baseSegment.durationMs,
      foulWindowId,
      timeoutPoolId,
      lineupChangeBoundary: baseSegment.lineupChangeBoundary,
    })
    foulWindows.push({
      id: foulWindowId,
      label: rules.periodLabels[index] ?? `Period ${number}`,
      segmentIds: [segmentId],
      bonusThreshold: rules.bonusThreshold,
      doubleBonusThreshold: rules.doubleBonusThreshold,
      hasOneAndOne: rules.hasOneAndOne,
    })
    timeoutPools.push({
      id: timeoutPoolId,
      label: rules.periodLabels[index] ?? `Period ${number}`,
      segmentIds: [segmentId],
      totalLimit: rules.timeoutsPerPeriod,
      fullLimit: null,
      shortLimit: null,
      carryoverToPoolId: null,
    })
  }

  const overtimeTotal = rules.timeoutsPerOvertime ?? rules.timeoutsPerPeriod
  const overtimeFoulPolicy: BasketballOvertimeFoulPolicy = {
    mode: rules.overtimeFoulsReset ? 'new_each' : 'shared_overtimes',
    regulationWindowId: null,
    window: {
      label: rules.overtimeLabel,
      bonusThreshold: rules.bonusThreshold,
      doubleBonusThreshold: rules.doubleBonusThreshold,
      hasOneAndOne: rules.hasOneAndOne,
    },
  }
  const overtimeTimeoutPolicy: BasketballOvertimeTimeoutPolicy = {
    mode: 'new_each',
    regulationPoolId: null,
    pool: {
      label: rules.overtimeLabel,
      totalLimit: overtimeTotal,
      fullLimit: null,
      shortLimit: null,
    },
    additionsPerOvertime: { total: 0, full: 0, short: 0 },
  }
  const settings: BasketballTeamSettingsV1 = {
    baseProfile: {
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
    },
    ruleOverrides: {
      regulationSegments,
      foulWindows,
      timeoutPools,
      overtimeTemplate: {
        idPrefix: 'overtime',
        label: rules.overtimeLabel,
        durationMs: profile.rules.overtimeTemplate.durationMs,
        foulPolicy: overtimeFoulPolicy,
        timeoutPolicy: overtimeTimeoutPolicy,
        lineupChangeBoundary: profile.rules.overtimeTemplate.lineupChangeBoundary,
      },
    },
  }
  const parsed = parseBasketballTeamSettings(settings)
  if (!parsed.ok) {
    return { ok: false, error: `Legacy season rules cannot be imported: ${parsed.error}` }
  }

  return {
    ok: true,
    settings: parsed.value,
    legacySummary: [
      `${rules.periodsPerGame} regulation periods: ${rules.periodLabels.join(', ')}`,
      `Bonus ${rules.bonusThreshold}; double bonus ${rules.doubleBonusThreshold}; ${rules.hasOneAndOne ? 'uses' : 'does not use'} 1-and-1`,
      `Overtime label ${rules.overtimeLabel}; fouls ${rules.overtimeFoulsReset ? 'reset each overtime' : 'share one overtime-only window'}`,
      `Timeout cap per period: ${limitLabel(rules.timeoutsPerPeriod)}; per overtime: ${limitLabel(overtimeTotal)}`,
    ],
    legacyDefaultedFields: rules.defaultedFields,
    fallbackSummary: [
      `Regulation duration and lineup boundaries from ${profile.label} v${profile.profileVersion}`,
      `Overtime duration and lineup boundary from ${profile.label} v${profile.profileVersion}`,
      `Personal foul limit remains ${profile.rules.personalFoulLimit} from ${profile.label} v${profile.profileVersion}`,
    ],
    mappingSummary: [
      'Each legacy regulation period becomes its own foul window and timeout pool.',
      'Legacy timeout totals do not infer full or 30-second timeout limits.',
      'The selected fallback profile is stored explicitly; no governing profile is inferred.',
    ],
  }
}

function resolveLegacySeasonRules(
  value: unknown
): { ok: true; value: ResolvedLegacySeasonRules } | { ok: false; error: string } {
  const record = value === null || value === undefined
    ? {}
    : isPlainObject(value)
      ? value
      : null
  if (!record) return { ok: false, error: 'Legacy season rules are not a valid object.' }

  const defaultedFields: string[] = []
  const numberField = (
    key: 'periodsPerGame' | 'bonusThreshold' | 'doubleBonusThreshold',
    fallback: number,
    minimum: number,
    maximum: number
  ): number | null => {
    if (!(key in record)) {
      defaultedFields.push(key)
      return fallback
    }
    const candidate = record[key]
    return Number.isInteger(candidate) && Number(candidate) >= minimum && Number(candidate) <= maximum
      ? Number(candidate)
      : null
  }
  const periodsPerGame = numberField(
    'periodsPerGame',
    BASKETBALL_TEAM_STATS_DEFAULTS.periodsPerGame,
    1,
    MAX_PERIODS
  )
  if (periodsPerGame === null) {
    return { ok: false, error: `Legacy regulation periods must be between 1 and ${MAX_PERIODS}.` }
  }
  const bonusThreshold = numberField(
    'bonusThreshold',
    BASKETBALL_TEAM_STATS_DEFAULTS.bonusThreshold,
    1,
    100
  )
  const doubleBonusThreshold = numberField(
    'doubleBonusThreshold',
    BASKETBALL_TEAM_STATS_DEFAULTS.doubleBonusThreshold,
    1,
    100
  )
  if (bonusThreshold === null || doubleBonusThreshold === null) {
    return { ok: false, error: 'Legacy bonus thresholds must be whole numbers between 1 and 100.' }
  }
  if (doubleBonusThreshold < bonusThreshold) {
    return { ok: false, error: 'Legacy double-bonus threshold cannot be below the bonus threshold.' }
  }

  let periodLabels: string[]
  if (!('periodLabels' in record)) {
    defaultedFields.push('periodLabels')
    periodLabels = getDefaultPeriodLabels(periodsPerGame)
  } else if (
    Array.isArray(record.periodLabels) &&
    record.periodLabels.length === periodsPerGame &&
    record.periodLabels.every(label =>
      typeof label === 'string' && label.trim().length > 0 && label.trim().length <= MAX_LABEL_LENGTH
    )
  ) {
    periodLabels = record.periodLabels.map(label => String(label).trim())
  } else {
    return { ok: false, error: 'Legacy period labels must match the regulation-period count.' }
  }

  const hasOneAndOne = booleanField(
    record,
    'hasOneAndOne',
    BASKETBALL_TEAM_STATS_DEFAULTS.hasOneAndOne,
    defaultedFields
  )
  const overtimeFoulsReset = booleanField(
    record,
    'overtimeFoulsReset',
    BASKETBALL_TEAM_STATS_DEFAULTS.overtimeFoulsReset,
    defaultedFields
  )
  if (hasOneAndOne === null || overtimeFoulsReset === null) {
    return { ok: false, error: 'Legacy foul-policy values must be true or false.' }
  }

  let overtimeLabel = BASKETBALL_TEAM_STATS_DEFAULTS.overtimeLabel
  if (!('overtimeLabel' in record)) {
    defaultedFields.push('overtimeLabel')
  } else if (
    typeof record.overtimeLabel === 'string' &&
    record.overtimeLabel.trim().length > 0 &&
    record.overtimeLabel.trim().length <= MAX_LABEL_LENGTH
  ) {
    overtimeLabel = record.overtimeLabel.trim()
  } else {
    return { ok: false, error: 'Legacy overtime label is invalid.' }
  }

  const timeoutsPerPeriod = nullableLimit(
    record,
    'timeoutsPerPeriod',
    BASKETBALL_TEAM_STATS_DEFAULTS.timeoutsPerPeriod,
    defaultedFields
  )
  const timeoutsPerOvertime = nullableLimit(
    record,
    'timeoutsPerOvertime',
    BASKETBALL_TEAM_STATS_DEFAULTS.timeoutsPerOvertime,
    defaultedFields
  )
  if (!timeoutsPerPeriod.ok || !timeoutsPerOvertime.ok) {
    return { ok: false, error: 'Legacy timeout limits must be non-negative whole numbers or null.' }
  }

  return {
    ok: true,
    value: {
      periodsPerGame,
      periodLabels,
      bonusThreshold,
      doubleBonusThreshold,
      hasOneAndOne,
      overtimeLabel,
      overtimeFoulsReset,
      timeoutsPerPeriod: timeoutsPerPeriod.value,
      timeoutsPerOvertime: timeoutsPerOvertime.value,
      defaultedFields,
    },
  }
}

function booleanField(
  record: Record<string, unknown>,
  key: 'hasOneAndOne' | 'overtimeFoulsReset',
  fallback: boolean,
  defaultedFields: string[]
): boolean | null {
  if (!(key in record)) {
    defaultedFields.push(key)
    return fallback
  }
  return typeof record[key] === 'boolean' ? record[key] : null
}

function nullableLimit(
  record: Record<string, unknown>,
  key: 'timeoutsPerPeriod' | 'timeoutsPerOvertime',
  fallback: number | null,
  defaultedFields: string[]
): { ok: true; value: number | null } | { ok: false } {
  if (!(key in record)) {
    defaultedFields.push(key)
    return { ok: true, value: fallback }
  }
  const value = record[key]
  if (value === null) return { ok: true, value: null }
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100
    ? { ok: true, value: Number(value) }
    : { ok: false }
}

function limitLabel(value: number | null): string {
  return value === null ? 'unlimited' : String(value)
}

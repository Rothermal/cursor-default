import { isPlainObject } from '../gameEvents/envelope'
import { findBaseballRulesProfile } from './profiles'
import type {
  BaseballBase,
  BaseballBattingOrderFormat,
  BaseballMatchRules,
  BaseballReentryRule,
  BaseballRulesVariant,
  BaseballRunRule,
} from './types'
import { BASEBALL_RULES_SCHEMA_VERSION } from './types'

const RULE_KEYS: readonly (keyof BaseballMatchRules)[] = [
  'rulesSchemaVersion',
  'profileId',
  'profileVersion',
  'variant',
  'scheduledInnings',
  'ballsForWalk',
  'strikesForStrikeout',
  'startingBalls',
  'startingStrikes',
  'twoStrikeFoulIsOut',
  'twoStrikeFoulBuntIsStrikeout',
  'droppedThirdStrike',
  'battingOrderFormat',
  'maxExtraHitters',
  'defensivePlayers',
  'reentry',
  'courtesyRunners',
  'stealing',
  'leadingOff',
  'balks',
  'extraInningsAllowed',
  'placedRunnerBase',
  'placedRunnerFromInning',
  'runRules',
  'maxRunsPerHalfInning',
  'tiesAllowed',
  'pitchCountWarnings',
  'pitchCountLimit',
]

const VARIANTS: readonly BaseballRulesVariant[] = ['baseball', 'softball_fastpitch', 'softball_slowpitch']
const FORMATS: readonly BaseballBattingOrderFormat[] = [
  'standard',
  'designated_hitter',
  'extra_hitter',
  'continuous',
]
const REENTRY: readonly BaseballReentryRule[] = ['none', 'starters_once', 'unlimited']
const BASES: readonly BaseballBase[] = ['first', 'second', 'third']

/** Exact parser: unknown keys, missing keys, or out-of-range values fail closed. */
export function normalizeBaseballMatchRules(value: unknown): BaseballMatchRules | null {
  if (!isPlainObject(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== RULE_KEYS.length || !RULE_KEYS.every(key => key in value)) return null
  const rules = value as Record<string, unknown>
  if (rules.rulesSchemaVersion !== BASEBALL_RULES_SCHEMA_VERSION) return null
  if (typeof rules.profileId !== 'string' || !findBaseballRulesProfile(rules.profileId)) return null
  if (!isInt(rules.profileVersion, 1, 1000)) return null
  if (!VARIANTS.includes(rules.variant as BaseballRulesVariant)) return null
  if (!isInt(rules.scheduledInnings, 1, 15)) return null
  if (!isInt(rules.ballsForWalk, 1, 4) || !isInt(rules.strikesForStrikeout, 1, 3)) return null
  if (!isInt(rules.startingBalls, 0, Number(rules.ballsForWalk) - 1)) return null
  if (!isInt(rules.startingStrikes, 0, Number(rules.strikesForStrikeout) - 1)) return null
  for (const key of [
    'twoStrikeFoulIsOut',
    'twoStrikeFoulBuntIsStrikeout',
    'droppedThirdStrike',
    'courtesyRunners',
    'stealing',
    'leadingOff',
    'balks',
    'extraInningsAllowed',
    'tiesAllowed',
  ]) {
    if (typeof rules[key] !== 'boolean') return null
  }
  if (!FORMATS.includes(rules.battingOrderFormat as BaseballBattingOrderFormat)) return null
  if (!isInt(rules.maxExtraHitters, 0, 5)) return null
  if (rules.defensivePlayers !== 9 && rules.defensivePlayers !== 10) return null
  if (!REENTRY.includes(rules.reentry as BaseballReentryRule)) return null
  if (rules.placedRunnerBase === null) {
    if (rules.placedRunnerFromInning !== null) return null
  } else {
    if (!BASES.includes(rules.placedRunnerBase as BaseballBase)) return null
    if (!isInt(rules.placedRunnerFromInning, Number(rules.scheduledInnings) + 1, 30)) return null
  }
  if (!Array.isArray(rules.runRules) || rules.runRules.length > 5) return null
  if (!rules.runRules.every(isRunRule)) return null
  if (rules.maxRunsPerHalfInning !== null && !isInt(rules.maxRunsPerHalfInning, 1, 50)) return null
  if (
    !Array.isArray(rules.pitchCountWarnings) ||
    rules.pitchCountWarnings.length > 10 ||
    !rules.pitchCountWarnings.every(entry => isInt(entry, 1, 500))
  ) return null
  if (rules.pitchCountLimit !== null && !isInt(rules.pitchCountLimit, 1, 500)) return null
  return structuredClone(value) as unknown as BaseballMatchRules
}

function isRunRule(value: unknown): value is BaseballRunRule {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 2 &&
    isInt(value.afterInning, 1, 15) &&
    isInt(value.lead, 1, 100)
  )
}

function isInt(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

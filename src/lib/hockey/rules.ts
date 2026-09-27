import { isPlainObject } from '../gameEvents/envelope'
import { findHockeyRulesProfile } from './profiles'
import type {
  HockeyClockDisplay,
  HockeyClockMode,
  HockeyCoincidentalMinors,
  HockeyMatchRules,
  HockeyOvertimeEndsPolicy,
  HockeyRulesField,
  HockeyShootoutRepeatShooters,
} from './types'
import { HOCKEY_RULES_SCHEMA_VERSION } from './types'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS

export const HOCKEY_RULES_FIELDS: readonly HockeyRulesField[] = [
  'regulation',
  'clockModel',
  'clock',
  'skatersPerSide',
  'minimumSkaters',
  'overtime',
  'shootout',
  'tiesAllowed',
  'penalties',
  'trapezoid',
]

const RULE_KEYS: readonly string[] = [
  'rulesSchemaVersion',
  'profileId',
  'profileVersion',
  ...HOCKEY_RULES_FIELDS,
]

const CLOCK_DISPLAYS: readonly HockeyClockDisplay[] = ['count_down', 'count_up']
const CLOCK_MODES: readonly HockeyClockMode[] = ['stop_time', 'running']
const ENDS_POLICIES: readonly HockeyOvertimeEndsPolicy[] = [
  'continue_alternation',
  'same_as_last_regulation',
]
const REPEAT_SHOOTERS: readonly HockeyShootoutRepeatShooters[] = ['after_all', 'never', 'any']
const COINCIDENTAL: readonly HockeyCoincidentalMinors[] = ['substitute', 'play_short']

/**
 * Exact parser: unknown or missing keys, out-of-range values, and inconsistent
 * combinations fail closed. Returns a mutable clone on success.
 */
export function normalizeHockeyMatchRules(value: unknown): HockeyMatchRules | null {
  return validateHockeyMatchRules(value) === null
    ? structuredClone(value) as HockeyMatchRules
    : null
}

/** Returns `null` when valid, otherwise a short reason. */
export function validateHockeyMatchRules(value: unknown): string | null {
  if (!isPlainObject(value)) return 'Rules must be an object.'
  if (!hasExactKeys(value, RULE_KEYS)) return 'Rules contain unknown or missing fields.'
  if (value.rulesSchemaVersion !== HOCKEY_RULES_SCHEMA_VERSION) {
    return 'Unsupported hockey rules version.'
  }
  if (typeof value.profileId !== 'string' || !findHockeyRulesProfile(value.profileId)) {
    return 'Unknown hockey rules profile.'
  }
  if (!isInt(value.profileVersion, 1, 1000)) return 'Invalid profile version.'

  const regulation = value.regulation
  if (
    !isPlainObject(regulation) ||
    !hasExactKeys(regulation, ['periods', 'periodLengthMs']) ||
    !isInt(regulation.periods, 1, 5) ||
    !isWholeSeconds(regulation.periodLengthMs, MINUTE_MS, 60 * MINUTE_MS)
  ) return 'Regulation must have 1-5 periods of 1-60 whole-second minutes.'

  if (value.clockModel === 'anchored') {
    const clock = value.clock
    if (
      !isPlainObject(clock) ||
      !hasExactKeys(clock, ['display', 'mode']) ||
      !CLOCK_DISPLAYS.includes(clock.display as HockeyClockDisplay) ||
      !CLOCK_MODES.includes(clock.mode as HockeyClockMode)
    ) return 'An anchored clock needs a display and a stop-time or running mode.'
  } else if (value.clockModel === 'none') {
    if (value.clock !== null) return 'A clockless game cannot have clock settings.'
  } else {
    return 'Clock model must be anchored or none.'
  }

  if (!isInt(value.skatersPerSide, 3, 6)) return 'Skaters per side must be 3-6.'
  if (!isInt(value.minimumSkaters, 3, Number(value.skatersPerSide))) {
    return 'Minimum skaters must be between 3 and skaters per side.'
  }

  const overtime = value.overtime
  if (overtime !== null) {
    if (
      !isPlainObject(overtime) ||
      !hasExactKeys(overtime, ['lengthMs', 'skaters', 'repeat', 'endsPolicy']) ||
      !isWholeSeconds(overtime.lengthMs, MINUTE_MS, 60 * MINUTE_MS) ||
      !isInt(overtime.skaters, 3, Number(value.skatersPerSide)) ||
      typeof overtime.repeat !== 'boolean' ||
      !ENDS_POLICIES.includes(overtime.endsPolicy as HockeyOvertimeEndsPolicy)
    ) return 'Overtime settings are invalid.'
  }

  const shootout = value.shootout
  if (shootout !== null) {
    if (
      !isPlainObject(shootout) ||
      !hasExactKeys(shootout, ['rounds', 'repeatShooters']) ||
      !isInt(shootout.rounds, 1, 10) ||
      !REPEAT_SHOOTERS.includes(shootout.repeatShooters as HockeyShootoutRepeatShooters)
    ) return 'Shootout settings are invalid.'
  }

  if (typeof value.tiesAllowed !== 'boolean') return 'Ties allowed must be true or false.'
  if (!value.tiesAllowed) {
    const repeatingOvertime = isPlainObject(overtime) && overtime.repeat === true
    if (shootout === null && !repeatingOvertime) {
      return 'A game without ties needs a shootout or repeating overtime.'
    }
  }

  const penalties = value.penalties
  if (
    !isPlainObject(penalties) ||
    !hasExactKeys(penalties, [
      'minorMs',
      'doubleMinorMs',
      'majorMs',
      'misconductMs',
      'releaseMinorOnPowerPlayGoal',
      'coincidentalMinors',
    ]) ||
    !isWholeSeconds(penalties.minorMs, 30 * SECOND_MS, 10 * MINUTE_MS) ||
    !isWholeSeconds(penalties.doubleMinorMs, Number(penalties.minorMs), 20 * MINUTE_MS) ||
    !isWholeSeconds(penalties.majorMs, Number(penalties.minorMs), 20 * MINUTE_MS) ||
    !isWholeSeconds(penalties.misconductMs, MINUTE_MS, 20 * MINUTE_MS) ||
    typeof penalties.releaseMinorOnPowerPlayGoal !== 'boolean' ||
    !COINCIDENTAL.includes(penalties.coincidentalMinors as HockeyCoincidentalMinors)
  ) return 'Penalty lengths are invalid.'

  if (typeof value.trapezoid !== 'boolean') return 'Trapezoid must be true or false.'
  return null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function isInt(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

function isWholeSeconds(value: unknown, min: number, max: number): value is number {
  return isInt(value, min, max) && Number(value) % SECOND_MS === 0
}

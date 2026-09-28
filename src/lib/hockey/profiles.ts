import type { HockeyMatchRules, HockeyProfileId, HockeyRuleOverrides, HockeyRulesField } from './types'
import { HOCKEY_RULES_SCHEMA_VERSION } from './types'

const MINUTE_MS = 60_000

export interface HockeyRulesProfile {
  id: HockeyProfileId
  version: number
  label: string
  description: string
  /** Rule family the profile tracks. Values are StatKeeper tracking defaults, not a rulebook. */
  governingFamily: string
  rules: HockeyMatchRules
}

type ProfileRules = Pick<HockeyMatchRules, HockeyRulesField>

const STANDARD_PENALTIES: ProfileRules['penalties'] = {
  minorMs: 2 * MINUTE_MS,
  doubleMinorMs: 4 * MINUTE_MS,
  majorMs: 5 * MINUTE_MS,
  misconductMs: 10 * MINUTE_MS,
  releaseMinorOnPowerPlayGoal: true,
  coincidentalMinors: 'substitute',
}

const USA_HOCKEY_YOUTH: ProfileRules = {
  regulation: { periods: 3, periodLengthMs: 15 * MINUTE_MS },
  clockModel: 'anchored',
  clock: { display: 'count_down', mode: 'stop_time' },
  skatersPerSide: 5,
  minimumSkaters: 3,
  overtime: null,
  shootout: null,
  tiesAllowed: true,
  penalties: STANDARD_PENALTIES,
  trapezoid: false,
}

const NHL_REGULAR: ProfileRules = {
  ...USA_HOCKEY_YOUTH,
  regulation: { periods: 3, periodLengthMs: 20 * MINUTE_MS },
  overtime: {
    lengthMs: 5 * MINUTE_MS,
    skaters: 3,
    repeat: false,
    endsPolicy: 'continue_alternation',
    suddenDeath: true,
  },
  shootout: { rounds: 3, repeatShooters: 'after_all' },
  tiesAllowed: false,
  penalties: { ...STANDARD_PENALTIES, coincidentalMinors: 'play_short' },
  trapezoid: true,
}

function profile(
  id: HockeyProfileId,
  label: string,
  description: string,
  governingFamily: string,
  rules: ProfileRules
): HockeyRulesProfile {
  return deepFreeze({
    id,
    version: 1,
    label,
    description,
    governingFamily,
    rules: structuredClone<HockeyMatchRules>({
      rulesSchemaVersion: HOCKEY_RULES_SCHEMA_VERSION,
      profileId: id,
      profileVersion: 1,
      ...rules,
    }),
  })
}

const PROFILES: readonly HockeyRulesProfile[] = Object.freeze([
  profile(
    'usa_hockey_youth',
    'Youth (USA Hockey)',
    '3 x 15 stop time, ties allowed, no overtime. Adjust period length for the age group.',
    'USA Hockey',
    USA_HOCKEY_YOUTH
  ),
  profile(
    'recreational',
    'Adult recreational',
    '3 x 15 running clock, ties allowed, no overtime.',
    'Adult recreational leagues',
    {
      ...USA_HOCKEY_YOUTH,
      clock: { display: 'count_down', mode: 'running' },
    }
  ),
  profile(
    'high_school_us',
    'High school (US)',
    '3 x 17 stop time, 8-minute sudden-death overtime, ties allowed.',
    'NFHS / state associations',
    {
      ...USA_HOCKEY_YOUTH,
      regulation: { periods: 3, periodLengthMs: 17 * MINUTE_MS },
      overtime: {
        lengthMs: 8 * MINUTE_MS,
        skaters: 5,
        repeat: false,
        endsPolicy: 'continue_alternation',
        suddenDeath: true,
      },
    }
  ),
  profile(
    'ncaa',
    'College (NCAA)',
    '3 x 20, 5-minute 3-on-3 overtime; a tie stands for the official result.',
    'NCAA',
    {
      ...NHL_REGULAR,
      shootout: null,
      tiesAllowed: true,
      penalties: STANDARD_PENALTIES,
      trapezoid: false,
    }
  ),
  profile(
    'nhl_regular',
    'NHL regular season',
    '3 x 20, 5-minute 3-on-3 overtime, then a 3-round shootout.',
    'NHL',
    NHL_REGULAR
  ),
  profile(
    'nhl_playoffs',
    'NHL playoffs',
    '3 x 20, then repeating 20-minute 5-on-5 sudden-death overtime.',
    'NHL',
    {
      ...NHL_REGULAR,
      overtime: {
        lengthMs: 20 * MINUTE_MS,
        skaters: 5,
        repeat: true,
        endsPolicy: 'continue_alternation',
        suddenDeath: true,
      },
      shootout: null,
    }
  ),
  profile(
    'custom',
    'Custom',
    'Start from youth rules and change anything.',
    'Custom',
    USA_HOCKEY_YOUTH
  ),
])

export const DEFAULT_HOCKEY_PROFILE_ID: HockeyProfileId = 'usa_hockey_youth'

export function hockeyRulesProfiles(): readonly HockeyRulesProfile[] {
  return PROFILES
}

export function findHockeyRulesProfile(id: string, version?: number): HockeyRulesProfile | null {
  return PROFILES.find(value => value.id === id && (version === undefined || value.version === version)) ?? null
}

/**
 * Returns rules with an explicit `suddenDeath`, for new writes only. Reads never call it,
 * so a stored HKY-1 snapshot keeps its exact shape and fingerprint.
 */
export function withExplicitHockeySuddenDeath(rules: HockeyMatchRules): HockeyMatchRules {
  if (!rules.overtime || 'suddenDeath' in rules.overtime) return rules
  return { ...rules, overtime: { ...rules.overtime, suddenDeath: true } }
}

/** Returns a mutable clone of a profile's rules, optionally layered with overrides. */
export function createHockeyMatchRules(
  profileId: HockeyProfileId = DEFAULT_HOCKEY_PROFILE_ID,
  overrides: HockeyRuleOverrides = {}
): HockeyMatchRules {
  const base = findHockeyRulesProfile(profileId) ?? findHockeyRulesProfile(DEFAULT_HOCKEY_PROFILE_ID)!
  return withExplicitHockeySuddenDeath(structuredClone({ ...base.rules, ...overrides }) as HockeyMatchRules)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

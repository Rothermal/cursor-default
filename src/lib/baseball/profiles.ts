import type { BaseballMatchRules, BaseballProfileId } from './types'
import { BASEBALL_RULES_SCHEMA_VERSION } from './types'

export interface BaseballRulesProfile {
  id: BaseballProfileId
  version: number
  label: string
  description: string
  rules: BaseballMatchRules
}

type ProfileRules = Omit<BaseballMatchRules, 'rulesSchemaVersion' | 'profileId' | 'profileVersion'>

const NFHS_BASEBALL: ProfileRules = {
  variant: 'baseball',
  scheduledInnings: 7,
  ballsForWalk: 4,
  strikesForStrikeout: 3,
  startingBalls: 0,
  startingStrikes: 0,
  twoStrikeFoulIsOut: false,
  twoStrikeFoulBuntIsStrikeout: true,
  droppedThirdStrike: true,
  battingOrderFormat: 'designated_hitter',
  maxExtraHitters: 0,
  defensivePlayers: 9,
  reentry: 'starters_once',
  courtesyRunners: true,
  stealing: true,
  leadingOff: true,
  balks: true,
  extraInningsAllowed: true,
  placedRunnerBase: null,
  placedRunnerFromInning: null,
  runRules: [
    { afterInning: 5, lead: 10 },
    { afterInning: 3, lead: 15 },
  ],
  maxRunsPerHalfInning: null,
  tiesAllowed: false,
  pitchCountWarnings: [75, 100],
  pitchCountLimit: 110,
}

function profile(
  id: BaseballProfileId,
  label: string,
  description: string,
  rules: ProfileRules
): BaseballRulesProfile {
  return {
    id,
    version: 1,
    label,
    description,
    rules: deepFreeze({
      rulesSchemaVersion: BASEBALL_RULES_SCHEMA_VERSION,
      profileId: id,
      profileVersion: 1,
      ...rules,
      runRules: rules.runRules.map(rule => ({ ...rule })),
      pitchCountWarnings: [...rules.pitchCountWarnings],
    }),
  }
}

const PROFILES: readonly BaseballRulesProfile[] = Object.freeze([
  profile('nfhs_baseball', 'High school (NFHS)', '7 innings, DH, starters may re-enter once, 10-run rule after 5.', NFHS_BASEBALL),
  profile('youth_baseball', 'Youth (Little League Majors style)', '6 innings, continuous batting order, pitch count limit 85, 10-run rule after 4.', {
    ...NFHS_BASEBALL,
    scheduledInnings: 6,
    battingOrderFormat: 'continuous',
    reentry: 'unlimited',
    courtesyRunners: false,
    leadingOff: false,
    runRules: [
      { afterInning: 4, lead: 10 },
      { afterInning: 3, lead: 15 },
    ],
    tiesAllowed: true,
    pitchCountWarnings: [20, 35, 50, 65],
    pitchCountLimit: 85,
  }),
  profile('mlb', 'MLB', '9 innings, DH, no re-entry, placed runner at second from the 10th.', {
    ...NFHS_BASEBALL,
    scheduledInnings: 9,
    twoStrikeFoulBuntIsStrikeout: true,
    reentry: 'none',
    courtesyRunners: false,
    placedRunnerBase: 'second',
    placedRunnerFromInning: 10,
    runRules: [],
    pitchCountWarnings: [100],
    pitchCountLimit: null,
  }),
  profile('ncaa_baseball', 'College (NCAA)', '9 innings, DH, no re-entry, optional run rule.', {
    ...NFHS_BASEBALL,
    scheduledInnings: 9,
    reentry: 'none',
    courtesyRunners: false,
    runRules: [{ afterInning: 7, lead: 10 }],
    pitchCountWarnings: [100],
    pitchCountLimit: null,
  }),
  profile('nfhs_softball_fastpitch', 'Softball fastpitch (NFHS)', '7 innings, DP/FLEX, no leading off, international tiebreaker from the 8th.', {
    ...NFHS_BASEBALL,
    variant: 'softball_fastpitch',
    leadingOff: false,
    placedRunnerBase: 'second',
    placedRunnerFromInning: 8,
    runRules: [
      { afterInning: 5, lead: 8 },
      { afterInning: 4, lead: 12 },
      { afterInning: 3, lead: 15 },
    ],
    pitchCountWarnings: [],
    pitchCountLimit: null,
  }),
  profile('softball_slowpitch', 'Softball slowpitch', '7 innings, 10 fielders, extra hitters, 1-1 count, no stealing, max 5 runs per half.', {
    ...NFHS_BASEBALL,
    variant: 'softball_slowpitch',
    startingBalls: 1,
    startingStrikes: 1,
    twoStrikeFoulIsOut: true,
    twoStrikeFoulBuntIsStrikeout: false,
    droppedThirdStrike: false,
    battingOrderFormat: 'extra_hitter',
    maxExtraHitters: 2,
    defensivePlayers: 10,
    courtesyRunners: false,
    stealing: false,
    leadingOff: false,
    balks: false,
    placedRunnerBase: null,
    placedRunnerFromInning: null,
    runRules: [{ afterInning: 5, lead: 15 }],
    maxRunsPerHalfInning: 5,
    pitchCountWarnings: [],
    pitchCountLimit: null,
  }),
  profile('custom', 'Custom', 'Start from high school rules and change anything.', NFHS_BASEBALL),
])

export const DEFAULT_BASEBALL_PROFILE_ID: BaseballProfileId = 'nfhs_baseball'

export function baseballRulesProfiles(): readonly BaseballRulesProfile[] {
  return PROFILES
}

export function findBaseballRulesProfile(id: string): BaseballRulesProfile | null {
  return PROFILES.find(value => value.id === id) ?? null
}

/** Returns a mutable clone of a profile's rules, optionally layered with overrides. */
export function createBaseballMatchRules(
  profileId: BaseballProfileId = DEFAULT_BASEBALL_PROFILE_ID,
  overrides: Partial<ProfileRules> = {}
): BaseballMatchRules {
  const base = findBaseballRulesProfile(profileId) ?? findBaseballRulesProfile(DEFAULT_BASEBALL_PROFILE_ID)!
  return structuredClone({ ...base.rules, ...overrides }) as BaseballMatchRules
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

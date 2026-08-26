import type {
  BasketballFoulWindowRule,
  BasketballMatchRules,
  BasketballMatchRulesV2,
  BasketballMatchRulesV3,
  BasketballMatchSegmentV2,
  BasketballOvertimeFoulPolicy,
  BasketballOvertimeTimeoutPolicy,
  BasketballRuleOverrides,
  BasketballRulesField,
  BasketballRulesSource,
  BasketballTimeoutPoolRule,
} from './types'
import {
  isBasketballStructuredMatchRules,
  validateBasketballMatchRules,
} from './rules'
import { BASKETBALL_RULE_FIELDS } from './profileDiffPresentation'

const MINUTE_MS = 60_000

export type BasketballRulesProfileId =
  | 'nfhs'
  | 'ncaa_men'
  | 'ncaa_women'
  | 'nba'
  | 'fiba'
  | 'youth_standard'
  | 'youth_equal_play'

export interface BasketballRulesProfileRef {
  profileId: BasketballRulesProfileId
  profileVersion: number
}

export interface BasketballRulesProfileCoverage {
  enforced: string[]
  deferred: string[]
}

export interface BasketballRulesProfile {
  profileId: BasketballRulesProfileId
  profileVersion: number
  label: string
  governingFamily: string
  effectiveRulesLabel: string
  sourceUrls: string[]
  reviewedAt: string
  coverage: BasketballRulesProfileCoverage
  rules: BasketballMatchRulesV2
}

export type BasketballRuleLayerId = 'personal' | 'team' | 'match'

export interface BasketballRuleLayer {
  id: BasketballRuleLayerId
  overrides: BasketballRuleOverrides
}

export interface BasketballResolvedRules {
  profile: BasketballRulesProfile
  rules: BasketballMatchRulesV2 | BasketballMatchRulesV3
  sourceByField: Partial<Record<BasketballRulesField, 'built_in' | BasketballRuleLayerId>>
  customized: boolean
}

export type BasketballRulesResolutionResult =
  | { ok: true; value: BasketballResolvedRules }
  | { ok: false; layer: 'built_in' | BasketballRuleLayerId; message: string }

export interface BasketballProfileUpgradeDiff {
  field: BasketballRulesField
  changedByProfile: boolean
  overridden: boolean
}

export type BasketballProfileUpgradeResult =
  | {
      ok: true
      current: BasketballResolvedRules
      candidate: BasketballResolvedRules
      currentBaseRules: BasketballMatchRulesV2
      targetBaseRules: BasketballMatchRulesV2
      differences: BasketballProfileUpgradeDiff[]
    }
  | { ok: false; message: string }

const ENFORCED = [
  'Regulation and overtime segment structure',
  'Team-foul reset windows and bonus thresholds',
  'Player disqualification threshold',
  'Charged-timeout inventory and period pools',
]

const DEFERRED = [
  'Game and shot clock operation',
  'Substitution, lineup, and playing-time enforcement',
  'Clock-dependent foul and timeout exceptions',
  'Officiating, equipment, and defensive restrictions',
]

const PROFILE_CATALOG: readonly BasketballRulesProfile[] = deepFreeze([
  profile({
    profileId: 'nfhs',
    label: 'NFHS',
    governingFamily: 'National Federation of State High School Associations',
    effectiveRulesLabel: '2026-27 tracking profile',
    sourceUrls: [
      'https://nfhs.org/sports/basketball/rules',
      'https://www.nfhs.org/stories/free-throw-procedures-and-foul-administration-amended-in-2023-24-high-school-basketball-rules-changes',
    ],
    rules: quarterRules({
      minutes: 8,
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeMinutes: 4,
      personalFoulLimit: 5,
      overtimeFoulPolicy: continueFouls('foul-q4'),
      regulationTimeoutPoolIds: ['timeouts-game', 'timeouts-game', 'timeouts-game', 'timeouts-game'],
      timeoutPools: [timeoutPool('timeouts-game', 'Game', ['regulation-1', 'regulation-2', 'regulation-3', 'regulation-4'], 5, 3, 2)],
      overtimeTimeoutPolicy: continueTimeouts('timeouts-game', 1, 1, 0),
    }),
  }),
  profile({
    profileId: 'ncaa_men',
    label: "NCAA Men's",
    governingFamily: "NCAA Men's Basketball",
    effectiveRulesLabel: '2025-26 tracking profile',
    sourceUrls: [
      'https://www.ncaa.org/championships/playing-rules/mens-basketball-playing-rules/',
      'https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/common/2025-26PRXBB_MajorRulesDifferences.pdf',
    ],
    rules: halfRules({
      minutes: 20,
      bonusThreshold: 7,
      doubleBonusThreshold: 10,
      hasOneAndOne: true,
      overtimeMinutes: 5,
      personalFoulLimit: 5,
      overtimeFoulPolicy: continueFouls('foul-h2'),
      regulationTimeoutPoolIds: ['timeouts-game', 'timeouts-game'],
      timeoutPools: [timeoutPool('timeouts-game', 'Game', ['regulation-1', 'regulation-2'], 6, 4, 2)],
      overtimeTimeoutPolicy: continueTimeouts('timeouts-game', 1, 1, 0),
    }),
  }),
  profile({
    profileId: 'ncaa_women',
    label: "NCAA Women's",
    governingFamily: "NCAA Women's Basketball",
    effectiveRulesLabel: '2025-26 tracking profile',
    sourceUrls: [
      'https://www.ncaa.org/championships/playing-rules/womens-basketball-playing-rules/',
      'https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/common/2025-26PRXBB_MajorRulesDifferences.pdf',
    ],
    rules: quarterRules({
      minutes: 10,
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeMinutes: 5,
      personalFoulLimit: 5,
      overtimeFoulPolicy: continueFouls('foul-q4'),
      regulationTimeoutPoolIds: ['timeouts-game', 'timeouts-game', 'timeouts-game', 'timeouts-game'],
      timeoutPools: [timeoutPool('timeouts-game', 'Game', ['regulation-1', 'regulation-2', 'regulation-3', 'regulation-4'], 5, 2, 3)],
      overtimeTimeoutPolicy: continueTimeouts('timeouts-game', 1, 0, 1),
    }),
  }),
  profile({
    profileId: 'nba',
    label: 'NBA',
    governingFamily: 'National Basketball Association',
    effectiveRulesLabel: '2025-26 tracking profile',
    sourceUrls: [
      'https://official.nba.com/rulebook/',
      'https://official.nba.com/rule-no-5-scoring-and-timing/',
      'https://official.nba.com/rule-no-12-fouls-and-penalties/',
    ],
    rules: quarterRules({
      minutes: 12,
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeMinutes: 5,
      personalFoulLimit: 6,
      overtimeFoulPolicy: newOvertimeFouls(4, 4, false),
      regulationTimeoutPoolIds: ['timeouts-game', 'timeouts-game', 'timeouts-game', 'timeouts-game'],
      timeoutPools: [timeoutPool('timeouts-game', 'Game', ['regulation-1', 'regulation-2', 'regulation-3', 'regulation-4'], 7, 7, 0)],
      overtimeTimeoutPolicy: newOvertimeTimeouts(2, 2, 0),
    }),
  }),
  profile({
    profileId: 'fiba',
    label: 'FIBA',
    governingFamily: 'International Basketball Federation',
    effectiveRulesLabel: 'Official Basketball Rules 2024',
    sourceUrls: [
      'https://refereeing.fiba.basketball/en/rule-zone/official-basketball-rules-2024',
    ],
    rules: quarterRules({
      minutes: 10,
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeMinutes: 5,
      personalFoulLimit: 5,
      overtimeFoulPolicy: continueFouls('foul-q4'),
      regulationTimeoutPoolIds: ['timeouts-h1', 'timeouts-h1', 'timeouts-h2', 'timeouts-h2'],
      timeoutPools: [
        timeoutPool('timeouts-h1', 'First half', ['regulation-1', 'regulation-2'], 2, 2, 0),
        timeoutPool('timeouts-h2', 'Second half', ['regulation-3', 'regulation-4'], 3, 3, 0),
      ],
      overtimeTimeoutPolicy: newOvertimeTimeouts(1, 1, 0),
    }),
  }),
  profile({
    profileId: 'youth_standard',
    label: 'Youth Standard',
    governingFamily: 'NBA and USA Basketball Youth Guidelines',
    effectiveRulesLabel: 'Ages 9-11 tracking baseline',
    sourceUrls: [
      'https://ak-static.cms.nba.com/wp-content/uploads/sites/79/2018/03/9-11_Rules_and_Standards.pdf',
      'https://nfhs.org/sports/basketball/rules',
    ],
    rules: quarterRules({
      minutes: 8,
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeMinutes: 2,
      personalFoulLimit: 5,
      overtimeFoulPolicy: continueFouls('foul-q4'),
      regulationTimeoutPoolIds: ['timeouts-h1', 'timeouts-h1', 'timeouts-h2', 'timeouts-h2'],
      timeoutPools: [
        timeoutPool('timeouts-h1', 'First half', ['regulation-1', 'regulation-2'], 2, 2, 0),
        timeoutPool('timeouts-h2', 'Second half', ['regulation-3', 'regulation-4'], 2, 2, 0),
      ],
      overtimeTimeoutPolicy: newOvertimeTimeouts(1, 1, 0),
    }),
  }),
  profile({
    profileId: 'youth_equal_play',
    label: 'Youth Equal-Play',
    governingFamily: 'StatKeeper configurable youth equal-play baseline',
    effectiveRulesLabel: 'Eight-period tracking profile v1',
    sourceUrls: [
      'https://ayblva.org/league-rules/',
      'https://nepeanbluedevilsbasketballassociation.msa4.rampinteractive.com/content/club-policies',
    ],
    rules: equalPlayRules(),
  }),
])

export function listBasketballRulesProfiles(): BasketballRulesProfile[] {
  return PROFILE_CATALOG.map(profileValue => structuredClone(profileValue))
}

export function getBasketballRulesProfile(
  profileId: string,
  profileVersion: number
): BasketballRulesProfile | null {
  const found = PROFILE_CATALOG.find(profile =>
    profile.profileId === profileId && profile.profileVersion === profileVersion
  )
  return found ? structuredClone(found) : null
}

const BASKETBALL_CLOCK_LINEUP_FIELDS = [
  'clockModel',
  'clockDisplayDirection',
  'clockExpiration',
  'stoppageMode',
  'equalPlayPolicy',
] as const satisfies readonly BasketballRulesField[]

export function normalizeBasketballRuleOverrides(
  value: unknown
): BasketballRuleOverrides | null {
  if (!isObject(value)) return null
  const keys = Object.keys(value)
  if (keys.some(key => !BASKETBALL_RULE_FIELDS.includes(key as BasketballRulesField))) return null
  const v3OnlyFields = BASKETBALL_CLOCK_LINEUP_FIELDS.filter(field => field !== 'clockModel')
  const v3OnlyCount = v3OnlyFields.filter(field => field in value).length
  if (v3OnlyCount !== 0 && (
    v3OnlyCount !== v3OnlyFields.length || !('clockModel' in value)
  )) return null
  return structuredClone(value as BasketballRuleOverrides)
}

export function upgradeBasketballRulesDraftToV3(
  rules: BasketballMatchRulesV2,
  profileId: BasketballRulesProfileId
): BasketballMatchRulesV3 {
  const equalPlay = profileId === 'youth_equal_play'
  const upgraded: BasketballMatchRulesV3 = {
    ...structuredClone(rules),
    rulesSchemaVersion: 3,
    clockModel: 'anchored',
    clockDisplayDirection: 'count_down',
    clockExpiration: 'stop_at_zero',
    stoppageMode: 'explicit',
    equalPlayPolicy: equalPlay
      ? {
          mode: 'enforced',
          minimumPeriods: null,
          maximumConsecutivePeriods: 2,
          maximumPeriodImbalance: 1,
        }
      : {
          mode: 'off',
          minimumPeriods: null,
          maximumConsecutivePeriods: null,
          maximumPeriodImbalance: null,
        },
  }
  const error = validateBasketballMatchRules(upgraded)
  if (error) throw new Error(error)
  return upgraded
}

export function resolveBasketballRules(
  baseProfile: BasketballRulesProfileRef,
  layers: BasketballRuleLayer[] = []
): BasketballRulesResolutionResult {
  const profileValue = getBasketballRulesProfile(
    baseProfile.profileId,
    baseProfile.profileVersion
  )
  if (!profileValue) {
    return { ok: false, layer: 'built_in', message: 'Basketball rules profile is unavailable.' }
  }
  let rules: BasketballMatchRulesV2 | BasketballMatchRulesV3 = structuredClone(profileValue.rules)
  const sourceByField = Object.fromEntries(
    BASKETBALL_RULE_FIELDS
      .filter(field => field in profileValue.rules)
      .map(field => [field, 'built_in'])
  ) as BasketballResolvedRules['sourceByField']
  for (const layer of layers) {
    const overrides = normalizeBasketballRuleOverrides(layer.overrides)
    if (!overrides) {
      return { ok: false, layer: layer.id, message: 'Basketball rule overrides are invalid.' }
    }
    const introducesV3 = BASKETBALL_CLOCK_LINEUP_FIELDS.every(field => field in overrides)
    const candidate = {
      ...rules,
      ...structuredClone(overrides),
      rulesSchemaVersion: rules.rulesSchemaVersion === 3 || introducesV3 ? 3 as const : 2 as const,
    } as BasketballMatchRulesV2 | BasketballMatchRulesV3
    const error = validateBasketballMatchRules(candidate)
    if (error) return { ok: false, layer: layer.id, message: error }
    rules = candidate
    for (const field of Object.keys(overrides) as BasketballRulesField[]) {
      sourceByField[field] = layer.id
    }
  }
  return {
    ok: true,
    value: {
      profile: profileValue,
      rules,
      sourceByField,
      customized: Object.values(sourceByField).some(source => source !== 'built_in'),
    },
  }
}

export function previewBasketballProfileUpgrade(
  current: BasketballRulesProfileRef,
  target: BasketballRulesProfileRef,
  overrides: BasketballRuleOverrides = {}
): BasketballProfileUpgradeResult {
  const currentResolved = resolveBasketballRules(current, [{ id: 'personal', overrides }])
  if (!currentResolved.ok) return { ok: false, message: currentResolved.message }
  const candidateResolved = resolveBasketballRules(target, [{ id: 'personal', overrides }])
  if (!candidateResolved.ok) return { ok: false, message: candidateResolved.message }
  const currentBase = getBasketballRulesProfile(current.profileId, current.profileVersion)!
  const targetBase = getBasketballRulesProfile(target.profileId, target.profileVersion)!
  return {
    ok: true,
    current: currentResolved.value,
    candidate: candidateResolved.value,
    currentBaseRules: structuredClone(currentBase.rules),
    targetBaseRules: structuredClone(targetBase.rules),
    differences: BASKETBALL_RULE_FIELDS
      .filter(field =>
        !sameJson(ruleFieldValue(currentResolved.value.rules, field), ruleFieldValue(candidateResolved.value.rules, field)) ||
        !sameJson(ruleFieldValue(currentBase.rules, field), ruleFieldValue(targetBase.rules, field))
      )
      .map(field => ({
        field,
        changedByProfile: !sameJson(ruleFieldValue(currentBase.rules, field), ruleFieldValue(targetBase.rules, field)),
        overridden: Object.prototype.hasOwnProperty.call(overrides, field),
      })),
  }
}

export function basketballRulesProfileLabel(
  rules: BasketballMatchRules | null | undefined,
  source: BasketballRulesSource | null | undefined
): string {
  if (!rules) return 'Not available'
  if (!isBasketballStructuredMatchRules(rules)) return 'Legacy configuration'
  if (!source || source.hasExplicitMatchOverrides) return 'Custom'
  const profile = getBasketballRulesProfile(source.profileId, source.profileVersion)
  return profile ? `${profile.label} v${profile.profileVersion}` : 'Custom'
}

type ProfileInput = Omit<
  BasketballRulesProfile,
  'profileVersion' | 'reviewedAt' | 'coverage'
>

function profile(input: ProfileInput): BasketballRulesProfile {
  const error = validateBasketballMatchRules(input.rules)
  if (error) throw new Error(`${input.profileId} Basketball profile is invalid: ${error}`)
  return {
    ...input,
    profileVersion: 1,
    reviewedAt: '2026-08-23',
    coverage: { enforced: [...ENFORCED], deferred: [...DEFERRED] },
  }
}

interface StandardRulesInput {
  minutes: number
  bonusThreshold: number
  doubleBonusThreshold: number
  hasOneAndOne: boolean
  overtimeMinutes: number
  personalFoulLimit: number
  overtimeFoulPolicy: BasketballOvertimeFoulPolicy
  regulationTimeoutPoolIds: string[]
  timeoutPools: BasketballTimeoutPoolRule[]
  overtimeTimeoutPolicy: BasketballOvertimeTimeoutPolicy
}

function quarterRules(input: StandardRulesInput): BasketballMatchRulesV2 {
  const segmentIds = ['regulation-1', 'regulation-2', 'regulation-3', 'regulation-4']
  const foulWindows = segmentIds.map((id, index) =>
    foulWindow(`foul-q${index + 1}`, `Quarter ${index + 1}`, [id], input)
  )
  return rules(
    ['Q1', 'Q2', 'Q3', 'Q4'],
    input.minutes,
    foulWindows.map(window => window.id),
    input.regulationTimeoutPoolIds,
    foulWindows,
    input
  )
}

function halfRules(input: StandardRulesInput): BasketballMatchRulesV2 {
  const segmentIds = ['regulation-1', 'regulation-2']
  const foulWindows = segmentIds.map((id, index) =>
    foulWindow(`foul-h${index + 1}`, `Half ${index + 1}`, [id], input)
  )
  return rules(
    ['H1', 'H2'],
    input.minutes,
    foulWindows.map(window => window.id),
    input.regulationTimeoutPoolIds,
    foulWindows,
    input
  )
}

function equalPlayRules(): BasketballMatchRulesV2 {
  const segmentIds = Array.from({ length: 8 }, (_, index) => `regulation-${index + 1}`)
  const firstHalf = segmentIds.slice(0, 4)
  const secondHalf = segmentIds.slice(4)
  const common = {
    bonusThreshold: 7,
    doubleBonusThreshold: 10,
    hasOneAndOne: true,
  }
  return rules(
    segmentIds.map((_, index) => `P${index + 1}`),
    4,
    segmentIds.map((_, index) => index < 4 ? 'foul-h1' : 'foul-h2'),
    segmentIds.map((_, index) => index < 4 ? 'timeouts-h1' : 'timeouts-h2'),
    [
      foulWindow('foul-h1', 'First half', firstHalf, common),
      foulWindow('foul-h2', 'Second half', secondHalf, common),
    ],
    {
      minutes: 4,
      ...common,
      overtimeMinutes: 2,
      personalFoulLimit: 5,
      overtimeFoulPolicy: continueFouls('foul-h2'),
      regulationTimeoutPoolIds: [],
      timeoutPools: [
        timeoutPool('timeouts-h1', 'First half', firstHalf, 2, 2, 0),
        timeoutPool('timeouts-h2', 'Second half', secondHalf, 2, 2, 0),
      ],
      overtimeTimeoutPolicy: newOvertimeTimeouts(1, 1, 0),
    }
  )
}

function rules(
  labels: string[],
  minutes: number,
  foulWindowIds: string[],
  timeoutPoolIds: string[],
  foulWindows: BasketballFoulWindowRule[],
  input: StandardRulesInput
): BasketballMatchRulesV2 {
  const regulationSegments: BasketballMatchSegmentV2[] = labels.map((label, index) => ({
    id: `regulation-${index + 1}`,
    label,
    kind: 'regulation',
    order: index + 1,
    durationMs: minutes * MINUTE_MS,
    foulWindowId: foulWindowIds[index],
    timeoutPoolId: timeoutPoolIds[index],
    lineupChangeBoundary: true,
  }))
  return {
    rulesSchemaVersion: 2,
    regulationSegments,
    overtimeTemplate: {
      idPrefix: 'overtime',
      label: 'OT',
      durationMs: input.overtimeMinutes * MINUTE_MS,
      foulPolicy: input.overtimeFoulPolicy,
      timeoutPolicy: input.overtimeTimeoutPolicy,
      lineupChangeBoundary: true,
    },
    foulWindows,
    timeoutPools: input.timeoutPools,
    personalFoulLimit: input.personalFoulLimit,
    clockModel: 'none',
  }
}

function foulWindow(
  id: string,
  label: string,
  segmentIds: string[],
  policy: Pick<StandardRulesInput, 'bonusThreshold' | 'doubleBonusThreshold' | 'hasOneAndOne'>
): BasketballFoulWindowRule {
  return {
    id,
    label,
    segmentIds,
    bonusThreshold: policy.bonusThreshold,
    doubleBonusThreshold: policy.doubleBonusThreshold,
    hasOneAndOne: policy.hasOneAndOne,
  }
}

function timeoutPool(
  id: string,
  label: string,
  segmentIds: string[],
  totalLimit: number,
  fullLimit: number,
  shortLimit: number
): BasketballTimeoutPoolRule {
  return {
    id,
    label,
    segmentIds,
    totalLimit,
    fullLimit,
    shortLimit,
    carryoverToPoolId: null,
  }
}

function continueFouls(regulationWindowId: string): BasketballOvertimeFoulPolicy {
  return { mode: 'continue', regulationWindowId, window: null }
}

function newOvertimeFouls(
  bonusThreshold: number,
  doubleBonusThreshold: number,
  hasOneAndOne: boolean
): BasketballOvertimeFoulPolicy {
  return {
    mode: 'new_each',
    regulationWindowId: null,
    window: { label: 'Overtime', bonusThreshold, doubleBonusThreshold, hasOneAndOne },
  }
}

function continueTimeouts(
  regulationPoolId: string,
  total: number,
  full: number,
  short: number
): BasketballOvertimeTimeoutPolicy {
  return {
    mode: 'continue',
    regulationPoolId,
    pool: null,
    additionsPerOvertime: { total, full, short },
  }
}

function newOvertimeTimeouts(
  totalLimit: number,
  fullLimit: number,
  shortLimit: number
): BasketballOvertimeTimeoutPolicy {
  return {
    mode: 'new_each',
    regulationPoolId: null,
    pool: { label: 'Overtime', totalLimit, fullLimit, shortLimit },
    additionsPerOvertime: { total: 0, full: 0, short: 0 },
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function ruleFieldValue(
  rules: BasketballMatchRulesV2 | BasketballMatchRulesV3,
  field: BasketballRulesField
): unknown {
  return (rules as unknown as Record<string, unknown>)[field]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

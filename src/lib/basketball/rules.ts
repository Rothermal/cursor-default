import type { BasketballTeamStatsConfig } from '../../types'
import { BASKETBALL_TEAM_STATS_DEFAULTS } from '../../config/teamStatsDefaults'
import { isPlainObject } from '../gameEvents/envelope'
import type {
  BasketballFoulWindowRule,
  BasketballMatchRules,
  BasketballMatchEvent,
  BasketballMatchRulesV1,
  BasketballMatchRulesV2,
  BasketballMatchRulesV3,
  BasketballMatchSegment,
  BasketballMatchSegmentV2,
  BasketballOvertimeFoulPolicy,
  BasketballOvertimeTemplateV2,
  BasketballOvertimeTimeoutPolicy,
  BasketballRulesSource,
  BasketballSegmentKind,
  BasketballTimeoutKind,
  BasketballTimeoutPoolRule,
  BasketballTeamSide,
} from './types'

const MINUTE_MS = 60_000
export const BASKETBALL_RULE_COLLECTION_LIMIT = 20
export const BASKETBALL_RULE_ID_MAX_LENGTH = 80
export const BASKETBALL_RULE_LABEL_MAX_LENGTH = 120
export const BASKETBALL_PERSONAL_FOUL_LIMIT_MAX = 20

export interface ResolvedBasketballFoulWindow {
  id: string
  label: string
  bonusThreshold: number | null
  doubleBonusThreshold: number | null
  hasOneAndOne: boolean
}

export interface ResolvedBasketballTimeoutPool {
  id: string
  label: string
  totalLimit: number | null
  fullLimit: number | null
  shortLimit: number | null
}

export interface BasketballTimeoutPoolUsage {
  total: number
  full: number
  short: number
}

export const DEFAULT_BASKETBALL_RULES_SOURCE: BasketballRulesSource = {
  profileId: 'nfhs',
  profileVersion: 1,
  personalRevision: null,
  teamRevision: null,
  hasExplicitMatchOverrides: false,
}

export function createBasketballMatchRules(
  config: BasketballTeamStatsConfig = BASKETBALL_TEAM_STATS_DEFAULTS
): BasketballMatchRulesV1 {
  const durationMs = config.periodsPerGame === 2 ? 20 * MINUTE_MS : 8 * MINUTE_MS
  const rules: BasketballMatchRulesV1 = {
    ...structuredClone(config),
    regulationSegments: config.periodLabels.map((label, index) => ({
      id: `regulation-${index + 1}`,
      label,
      kind: 'regulation',
      order: index + 1,
      durationMs,
    })),
    overtimeTemplate: {
      idPrefix: 'overtime',
      label: config.overtimeLabel,
      durationMs: 4 * MINUTE_MS,
    },
    personalFoulLimit: 5,
    clockModel: 'none',
  }
  const error = validateBasketballMatchRules(rules)
  if (error) throw new Error(error)
  return structuredClone(rules)
}

export function isBasketballMatchRulesV2(
  rules: BasketballMatchRules
): rules is BasketballMatchRulesV2 {
  return rules.rulesSchemaVersion === 2
}

export function isBasketballMatchRulesV3(
  rules: BasketballMatchRules
): rules is BasketballMatchRulesV3 {
  return rules.rulesSchemaVersion === 3
}

export function isBasketballStructuredMatchRules(
  rules: BasketballMatchRules
): rules is BasketballMatchRulesV2 | BasketballMatchRulesV3 {
  return isBasketballMatchRulesV2(rules) || isBasketballMatchRulesV3(rules)
}

export function normalizeBasketballMatchRules(value: unknown): BasketballMatchRules | null {
  if (validateBasketballMatchRules(value) !== null) return null
  return structuredClone(value as BasketballMatchRules)
}

export function normalizeBasketballRulesSource(value: unknown): BasketballRulesSource | null {
  if (!isPlainObject(value)) return null
  if (typeof value.profileId !== 'string' || value.profileId.trim().length === 0) return null
  if (!isPositiveInteger(value.profileVersion)) return null
  if (!isNullableNonNegativeInteger(value.personalRevision)) return null
  if (!isNullableNonNegativeInteger(value.teamRevision)) return null
  if (typeof value.hasExplicitMatchOverrides !== 'boolean') return null
  return structuredClone(value as unknown as BasketballRulesSource)
}

export function validateBasketballMatchRules(value: unknown): string | null {
  if (!isPlainObject(value)) return 'Basketball rules must be an object.'
  if (value.rulesSchemaVersion === 2) return validateBasketballMatchRulesV2(value)
  if (value.rulesSchemaVersion === 3) return validateBasketballMatchRulesV3(value)
  if ('rulesSchemaVersion' in value) return 'Basketball rules schema version is unsupported.'
  return validateBasketballMatchRulesV1(value)
}

function validateBasketballMatchRulesV3(value: Record<string, unknown>): string | null {
  if (!hasExactKeys(value, [
    'rulesSchemaVersion',
    'regulationSegments',
    'overtimeTemplate',
    'foulWindows',
    'timeoutPools',
    'personalFoulLimit',
    'clockModel',
    'clockDisplayDirection',
    'clockExpiration',
    'stoppageMode',
    'equalPlayPolicy',
  ])) return 'Version-3 Basketball rules contain unsupported fields.'

  const structuralError = validateBasketballMatchRulesV2({
    rulesSchemaVersion: 2,
    regulationSegments: value.regulationSegments,
    overtimeTemplate: value.overtimeTemplate,
    foulWindows: value.foulWindows,
    timeoutPools: value.timeoutPools,
    personalFoulLimit: value.personalFoulLimit,
    clockModel: 'none',
  })
  if (structuralError) return structuralError.split('Version-2').join('Version-3')
  if (value.clockModel !== 'none' && value.clockModel !== 'anchored') {
    return 'Version-3 Basketball clock model is invalid.'
  }
  if (value.clockDisplayDirection !== 'count_down' && value.clockDisplayDirection !== 'count_up') {
    return 'Version-3 Basketball clock display direction is invalid.'
  }
  if (value.clockExpiration !== 'stop_at_zero') {
    return 'Version-3 Basketball clock expiration is invalid.'
  }
  if (value.stoppageMode !== 'explicit') {
    return 'Version-3 Basketball stoppage mode is invalid.'
  }
  if (!isPlainObject(value.equalPlayPolicy) || !hasExactKeys(value.equalPlayPolicy, [
    'mode',
    'minimumPeriods',
    'maximumConsecutivePeriods',
    'maximumPeriodImbalance',
  ])) return 'Version-3 Basketball equal-play policy is invalid.'
  const policy = value.equalPlayPolicy
  if (policy.mode !== 'off' && policy.mode !== 'advisory' && policy.mode !== 'enforced') {
    return 'Version-3 Basketball equal-play mode is invalid.'
  }
  if (![policy.minimumPeriods, policy.maximumConsecutivePeriods, policy.maximumPeriodImbalance]
    .every(isNullablePositiveInteger)) {
    return 'Version-3 Basketball equal-play limits must be positive integers or null.'
  }
  if (value.clockModel === 'none' && policy.mode !== 'off') {
    return 'Clockless Version-3 Basketball rules require equal play to be off.'
  }
  return null
}

function validateBasketballMatchRulesV1(value: Record<string, unknown>): string | null {
  if (!isPositiveInteger(value.periodsPerGame)) return 'Regulation period count must be positive.'
  if (!Array.isArray(value.periodLabels) || value.periodLabels.length !== value.periodsPerGame) {
    return 'Regulation labels must match the period count.'
  }
  const periodLabels = value.periodLabels as unknown[]
  if (!periodLabels.every(isNonEmptyString)) return 'Regulation labels must be non-empty.'
  if (
    !Array.isArray(value.regulationSegments) ||
    value.regulationSegments.length !== value.periodsPerGame ||
    !value.regulationSegments.every(isBasketballSegment)
  ) {
    return 'Regulation segments must match the period count.'
  }
  const segments = value.regulationSegments as unknown as BasketballMatchSegment[]
  if (!segments.every(segment => segment.kind === 'regulation')) {
    return 'Regulation segments must use the regulation kind.'
  }
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) {
    return 'Regulation segment ids must be unique.'
  }
  if (new Set(segments.map(segment => segment.order)).size !== segments.length) {
    return 'Regulation segment orders must be unique.'
  }
  if (!segments.every((segment, index) => (
    segment.order === index + 1 && segment.label === periodLabels[index]
  ))) {
    return 'Regulation segment order and labels must match compatibility fields.'
  }
  if (!isPlainObject(value.overtimeTemplate)) return 'Overtime template is required.'
  if (!isNonEmptyString(value.overtimeTemplate.idPrefix)) return 'Overtime id prefix is required.'
  if (!isNonEmptyString(value.overtimeTemplate.label)) return 'Overtime label is required.'
  if (!isPositiveInteger(value.overtimeTemplate.durationMs)) return 'Overtime duration is invalid.'
  if (value.overtimeTemplate.label !== value.overtimeLabel) {
    return 'Overtime template label must match the compatibility label.'
  }
  if (!isPositiveInteger(value.bonusThreshold)) return 'Bonus threshold must be positive.'
  if (!isPositiveInteger(value.doubleBonusThreshold)) return 'Double-bonus threshold must be positive.'
  if (value.doubleBonusThreshold < value.bonusThreshold) {
    return 'Double-bonus threshold cannot precede the bonus threshold.'
  }
  if (typeof value.hasOneAndOne !== 'boolean') return 'One-and-one policy is invalid.'
  if (!isNonEmptyString(value.overtimeLabel)) return 'Overtime label is required.'
  if (typeof value.overtimeFoulsReset !== 'boolean') return 'Overtime foul reset policy is invalid.'
  if (!isNullableNonNegativeInteger(value.timeoutsPerPeriod)) {
    return 'Regulation timeout inventory is invalid.'
  }
  if (!isNullableNonNegativeInteger(value.timeoutsPerOvertime)) {
    return 'Overtime timeout inventory is invalid.'
  }
  if (!isPositiveInteger(value.personalFoulLimit)) {
    return 'Personal foul limit must be positive.'
  }
  if (value.clockModel !== 'none' && value.clockModel !== 'anchored') {
    return 'Basketball clock model is invalid.'
  }
  return null
}

function validateBasketballMatchRulesV2(value: Record<string, unknown>): string | null {
  if (!hasExactKeys(value, [
    'rulesSchemaVersion',
    'regulationSegments',
    'overtimeTemplate',
    'foulWindows',
    'timeoutPools',
    'personalFoulLimit',
    'clockModel',
  ])) return 'Version-2 Basketball rules contain unsupported fields.'
  if (!Array.isArray(value.regulationSegments) || value.regulationSegments.length === 0) {
    return 'Version-2 regulation segments are required.'
  }
  if (value.regulationSegments.length > BASKETBALL_RULE_COLLECTION_LIMIT) {
    return `Version-2 regulation segments cannot exceed ${BASKETBALL_RULE_COLLECTION_LIMIT}.`
  }
  if (!value.regulationSegments.every(isBasketballSegmentV2)) {
    return 'Version-2 regulation segments are invalid.'
  }
  const segments = value.regulationSegments as unknown as BasketballMatchSegmentV2[]
  if (!segments.every(segment => segment.kind === 'regulation')) {
    return 'Version-2 regulation segments must use the regulation kind.'
  }
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) {
    return 'Version-2 regulation segment ids must be unique.'
  }
  if (!segments.every((segment, index) => segment.order === index + 1)) {
    return 'Version-2 regulation segment order must be contiguous.'
  }
  if (!isBasketballOvertimeTemplateV2(value.overtimeTemplate)) {
    return 'Version-2 overtime template is invalid.'
  }
  if (!Array.isArray(value.foulWindows) || value.foulWindows.length === 0) {
    return 'Version-2 foul windows are required.'
  }
  if (value.foulWindows.length > BASKETBALL_RULE_COLLECTION_LIMIT) {
    return `Version-2 foul windows cannot exceed ${BASKETBALL_RULE_COLLECTION_LIMIT}.`
  }
  if (!value.foulWindows.every(isBasketballFoulWindowRule)) {
    return 'Version-2 foul windows are invalid.'
  }
  if (!Array.isArray(value.timeoutPools) || value.timeoutPools.length === 0) {
    return 'Version-2 timeout pools are required.'
  }
  if (value.timeoutPools.length > BASKETBALL_RULE_COLLECTION_LIMIT) {
    return `Version-2 timeout pools cannot exceed ${BASKETBALL_RULE_COLLECTION_LIMIT}.`
  }
  if (!value.timeoutPools.every(isBasketballTimeoutPoolRule)) {
    return 'Version-2 timeout pools are invalid.'
  }
  if (!isPositiveInteger(value.personalFoulLimit)) {
    return 'Version-2 personal foul limit must be positive.'
  }
  if (value.personalFoulLimit > BASKETBALL_PERSONAL_FOUL_LIMIT_MAX) {
    return `Version-2 personal foul limit cannot exceed ${BASKETBALL_PERSONAL_FOUL_LIMIT_MAX}.`
  }
  if (value.clockModel !== 'none') return 'Version-2 Basketball clocks remain deferred.'

  const foulWindows = value.foulWindows as unknown as BasketballFoulWindowRule[]
  const timeoutPools = value.timeoutPools as unknown as BasketballTimeoutPoolRule[]
  if (new Set(foulWindows.map(window => window.id)).size !== foulWindows.length) {
    return 'Version-2 foul window ids must be unique.'
  }
  if (new Set(timeoutPools.map(pool => pool.id)).size !== timeoutPools.length) {
    return 'Version-2 timeout pool ids must be unique.'
  }
  const segmentIds = new Set(segments.map(segment => segment.id))
  const foulWindowById = new Map(foulWindows.map(window => [window.id, window]))
  const timeoutPoolById = new Map(timeoutPools.map(pool => [pool.id, pool]))
  for (const segment of segments) {
    const foulWindow = foulWindowById.get(segment.foulWindowId)
    if (!foulWindow || !foulWindow.segmentIds.includes(segment.id)) {
      return `Segment ${segment.id} has an invalid foul window reference.`
    }
    const timeoutPool = timeoutPoolById.get(segment.timeoutPoolId)
    if (!timeoutPool || !timeoutPool.segmentIds.includes(segment.id)) {
      return `Segment ${segment.id} has an invalid timeout pool reference.`
    }
  }
  const foulAssignments = foulWindows.flatMap(window => window.segmentIds)
  const timeoutAssignments = timeoutPools.flatMap(pool => pool.segmentIds)
  if (!exactlyOnce(foulAssignments, segmentIds)) {
    return 'Every regulation segment must belong to exactly one foul window.'
  }
  if (!exactlyOnce(timeoutAssignments, segmentIds)) {
    return 'Every regulation segment must belong to exactly one timeout pool.'
  }

  const overtime = value.overtimeTemplate as unknown as BasketballOvertimeTemplateV2
  const foulPolicyError = validateOvertimeFoulPolicy(overtime.foulPolicy, foulWindowById)
  if (foulPolicyError) return foulPolicyError
  const timeoutPolicyError = validateOvertimeTimeoutPolicy(overtime.timeoutPolicy, timeoutPoolById)
  if (timeoutPolicyError) return timeoutPolicyError
  const carryoverError = validateTimeoutCarryover(timeoutPools, segments)
  if (carryoverError) return carryoverError
  return null
}

export function resolveBasketballPeriodSegment(
  rules: BasketballMatchRules,
  periodId: string
): BasketballMatchSegment | null {
  const regulation = rules.regulationSegments.find(segment => segment.id === periodId)
  if (regulation) return structuredClone(regulation)

  const overtimeNumber = basketballOvertimeNumber(rules, periodId)
  if (overtimeNumber === null) return null
  return {
    id: periodId,
    label: overtimeNumber === 1
      ? rules.overtimeTemplate.label
      : `${rules.overtimeTemplate.label} ${overtimeNumber}`,
    kind: 'overtime',
    order: rules.regulationSegments.length + overtimeNumber,
    durationMs: rules.overtimeTemplate.durationMs,
  }
}

export function resolveBasketballFoulWindow(
  rules: BasketballMatchRules,
  periodId: string
): ResolvedBasketballFoulWindow | null {
  const segment = resolveBasketballPeriodSegment(rules, periodId)
  if (!segment) return null
  if (!isBasketballStructuredMatchRules(rules)) {
    const sharedOvertime = segment.kind === 'overtime' && !rules.overtimeFoulsReset
    return {
      id: sharedOvertime ? `${rules.overtimeTemplate.idPrefix}-shared` : segment.id,
      label: sharedOvertime ? rules.overtimeTemplate.label : segment.label,
      bonusThreshold: rules.bonusThreshold,
      doubleBonusThreshold: rules.doubleBonusThreshold,
      hasOneAndOne: rules.hasOneAndOne,
    }
  }
  if (segment.kind === 'regulation') {
    const segmentRule = rules.regulationSegments.find(candidate => candidate.id === periodId)!
    const window = rules.foulWindows.find(candidate => candidate.id === segmentRule.foulWindowId)
    return window ? foulWindowResult(window) : null
  }
  const overtimeNumber = basketballOvertimeNumber(rules, periodId)!
  const policy = rules.overtimeTemplate.foulPolicy
  if (policy.mode === 'continue') {
    const window = rules.foulWindows.find(candidate => candidate.id === policy.regulationWindowId)
    return window ? foulWindowResult(window) : null
  }
  if (!policy.window) return null
  return {
    id: policy.mode === 'new_each'
      ? `${rules.overtimeTemplate.idPrefix}-foul-${overtimeNumber}`
      : `${rules.overtimeTemplate.idPrefix}-foul-shared`,
    ...structuredClone(policy.window),
  }
}

export function resolveBasketballTimeoutPool(
  rules: BasketballMatchRules,
  periodId: string
): ResolvedBasketballTimeoutPool | null {
  const segment = resolveBasketballPeriodSegment(rules, periodId)
  if (!segment) return null
  if (!isBasketballStructuredMatchRules(rules)) {
    const cap = basketballTimeoutCap(rules, segment.kind)
    return {
      id: segment.id,
      label: segment.label,
      totalLimit: cap,
      fullLimit: null,
      shortLimit: null,
    }
  }
  if (segment.kind === 'regulation') {
    const segmentRule = rules.regulationSegments.find(candidate => candidate.id === periodId)!
    const pool = rules.timeoutPools.find(candidate => candidate.id === segmentRule.timeoutPoolId)
    return pool ? timeoutPoolResult(pool) : null
  }
  const overtimeNumber = basketballOvertimeNumber(rules, periodId)!
  const policy = rules.overtimeTemplate.timeoutPolicy
  if (policy.mode === 'continue') {
    const pool = rules.timeoutPools.find(candidate => candidate.id === policy.regulationPoolId)
    if (!pool) return null
    return addTimeoutLimits(timeoutPoolResult(pool), policy, overtimeNumber)
  }
  if (!policy.pool) return null
  const resolved: ResolvedBasketballTimeoutPool = {
    id: policy.mode === 'new_each'
      ? `${rules.overtimeTemplate.idPrefix}-timeout-${overtimeNumber}`
      : `${rules.overtimeTemplate.idPrefix}-timeout-shared`,
    ...structuredClone(policy.pool),
  }
  return policy.mode === 'shared_overtimes'
    ? addTimeoutLimits(resolved, policy, overtimeNumber)
    : resolved
}

export function resolveBasketballTimeoutPoolWithCarryover(
  rules: BasketballMatchRules,
  periodId: string,
  usageByPoolId: ReadonlyMap<string, BasketballTimeoutPoolUsage>
): ResolvedBasketballTimeoutPool | null {
  const resolved = resolveBasketballTimeoutPool(rules, periodId)
  if (!resolved || !isBasketballStructuredMatchRules(rules)) return resolved
  const incomingByTarget = new Map<string, BasketballTimeoutPoolRule[]>()
  for (const pool of rules.timeoutPools) {
    if (!pool.carryoverToPoolId) continue
    incomingByTarget.set(pool.carryoverToPoolId, [
      ...(incomingByTarget.get(pool.carryoverToPoolId) ?? []),
      pool,
    ])
  }
  const memo = new Map<string, ResolvedBasketballTimeoutPool>()
  const effectiveRegulationPool = (poolId: string): ResolvedBasketballTimeoutPool | null => {
    const cached = memo.get(poolId)
    if (cached) return cached
    const pool = rules.timeoutPools.find(candidate => candidate.id === poolId)
    if (!pool) return null
    const effective = timeoutPoolResult(pool)
    memo.set(poolId, effective)
    for (const source of incomingByTarget.get(poolId) ?? []) {
      const sourceEffective = effectiveRegulationPool(source.id)
      if (!sourceEffective) continue
      const used = usageByPoolId.get(source.id) ?? { total: 0, full: 0, short: 0 }
      effective.totalLimit = addCarriedLimit(effective.totalLimit, sourceEffective.totalLimit, used.total)
      effective.fullLimit = addCarriedLimit(effective.fullLimit, sourceEffective.fullLimit, used.full)
      effective.shortLimit = addCarriedLimit(effective.shortLimit, sourceEffective.shortLimit, used.short)
    }
    return effective
  }
  const basePoolId = rules.regulationSegments.find(segment => segment.id === periodId)?.timeoutPoolId ??
    (rules.overtimeTemplate.timeoutPolicy.mode === 'continue'
      ? rules.overtimeTemplate.timeoutPolicy.regulationPoolId
      : null)
  if (!basePoolId) return resolved
  const regulationPool = effectiveRegulationPool(basePoolId)
  if (!regulationPool) return resolved
  return {
    ...resolved,
    totalLimit: addCarryDifference(resolved.totalLimit, regulationPool.totalLimit, rules, basePoolId, 'totalLimit'),
    fullLimit: addCarryDifference(resolved.fullLimit, regulationPool.fullLimit, rules, basePoolId, 'fullLimit'),
    shortLimit: addCarryDifference(resolved.shortLimit, regulationPool.shortLimit, rules, basePoolId, 'shortLimit'),
  }
}

export function basketballTimeoutKindLimit(
  pool: ResolvedBasketballTimeoutPool,
  kind: Extract<BasketballTimeoutKind, 'full' | 'thirty_second'>
): number | null {
  return kind === 'full' ? pool.fullLimit : pool.shortLimit
}

export function basketballTimeoutUsageByPool(
  events: readonly BasketballMatchEvent[],
  rules: BasketballMatchRules,
  side: BasketballTeamSide
): Map<string, BasketballTimeoutPoolUsage> {
  const usage = new Map<string, BasketballTimeoutPoolUsage>()
  for (const event of events) {
    if (
      event.eventType !== 'basketball.timeout' ||
      event.teamSide !== side ||
      (event.payload.kind !== 'full' && event.payload.kind !== 'thirty_second')
    ) continue
    const poolId = resolveBasketballTimeoutPool(rules, event.period.id)?.id
    if (!poolId) continue
    const counts = usage.get(poolId) ?? { total: 0, full: 0, short: 0 }
    counts.total += 1
    counts[event.payload.kind === 'full' ? 'full' : 'short'] += 1
    usage.set(poolId, counts)
  }
  return usage
}

export function basketballTimeoutCap(
  rules: BasketballMatchRules,
  segmentKind: BasketballSegmentKind
): number | null {
  if (isBasketballStructuredMatchRules(rules)) return null
  return segmentKind === 'overtime'
    ? rules.timeoutsPerOvertime ?? rules.timeoutsPerPeriod
    : rules.timeoutsPerPeriod
}

export function basketballRulesAllowOneAndOne(
  rules: BasketballMatchRules,
  periodId: string
): boolean {
  return resolveBasketballFoulWindow(rules, periodId)?.hasOneAndOne ?? false
}

export function basketballRulesToTeamStatsConfig(
  rules: BasketballMatchRules
): BasketballTeamStatsConfig | null {
  if (isBasketballStructuredMatchRules(rules)) return null
  return {
    periodsPerGame: rules.periodsPerGame,
    periodLabels: [...rules.periodLabels],
    bonusThreshold: rules.bonusThreshold,
    doubleBonusThreshold: rules.doubleBonusThreshold,
    hasOneAndOne: rules.hasOneAndOne,
    overtimeLabel: rules.overtimeLabel,
    overtimeFoulsReset: rules.overtimeFoulsReset,
    timeoutsPerPeriod: rules.timeoutsPerPeriod,
    timeoutsPerOvertime: rules.timeoutsPerOvertime,
  }
}

export function basketballRegulationPeriodCount(rules: BasketballMatchRules): number {
  return rules.regulationSegments.length
}

function basketballOvertimeNumber(
  rules: BasketballMatchRules,
  periodId: string
): number | null {
  const escapedPrefix = rules.overtimeTemplate.idPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escapedPrefix}-(\\d+)$`).exec(periodId)
  const overtimeNumber = match ? Number(match[1]) : 0
  return Number.isInteger(overtimeNumber) && overtimeNumber >= 1 ? overtimeNumber : null
}

function foulWindowResult(window: BasketballFoulWindowRule): ResolvedBasketballFoulWindow {
  return {
    id: window.id,
    label: window.label,
    bonusThreshold: window.bonusThreshold,
    doubleBonusThreshold: window.doubleBonusThreshold,
    hasOneAndOne: window.hasOneAndOne,
  }
}

function timeoutPoolResult(pool: BasketballTimeoutPoolRule): ResolvedBasketballTimeoutPool {
  return {
    id: pool.id,
    label: pool.label,
    totalLimit: pool.totalLimit,
    fullLimit: pool.fullLimit,
    shortLimit: pool.shortLimit,
  }
}

function addTimeoutLimits(
  pool: ResolvedBasketballTimeoutPool,
  policy: BasketballOvertimeTimeoutPolicy,
  overtimeNumber: number
): ResolvedBasketballTimeoutPool {
  const additions = policy.additionsPerOvertime
  return {
    ...pool,
    totalLimit: addNullableLimit(pool.totalLimit, additions.total * overtimeNumber),
    fullLimit: addNullableLimit(pool.fullLimit, additions.full * overtimeNumber),
    shortLimit: addNullableLimit(pool.shortLimit, additions.short * overtimeNumber),
  }
}

function addNullableLimit(limit: number | null, addition: number): number | null {
  return limit === null ? null : limit + addition
}

function addCarriedLimit(
  targetLimit: number | null,
  sourceLimit: number | null,
  sourceUsed: number
): number | null {
  if (targetLimit === null || sourceLimit === null) return null
  return targetLimit + Math.max(0, sourceLimit - sourceUsed)
}

function addCarryDifference(
  resolvedLimit: number | null,
  effectiveRegulationLimit: number | null,
  rules: BasketballMatchRulesV2 | BasketballMatchRulesV3,
  poolId: string,
  field: 'totalLimit' | 'fullLimit' | 'shortLimit'
): number | null {
  if (resolvedLimit === null || effectiveRegulationLimit === null) return null
  const baseLimit = rules.timeoutPools.find(pool => pool.id === poolId)?.[field]
  if (baseLimit === null || baseLimit === undefined) return resolvedLimit
  return resolvedLimit + Math.max(0, effectiveRegulationLimit - baseLimit)
}

function validateOvertimeFoulPolicy(
  policy: BasketballOvertimeFoulPolicy,
  regulationWindows: Map<string, BasketballFoulWindowRule>
): string | null {
  if (policy.mode === 'continue') {
    if (!policy.regulationWindowId || !regulationWindows.has(policy.regulationWindowId)) {
      return 'Overtime foul continuation must reference a regulation window.'
    }
    if (policy.window !== null) return 'Overtime foul continuation cannot define a new window.'
    return null
  }
  if (policy.regulationWindowId !== null || !policy.window) {
    return 'Overtime foul reset policy must define a new window template.'
  }
  return validateFoulWindowTemplate(policy.window)
}

function validateOvertimeTimeoutPolicy(
  policy: BasketballOvertimeTimeoutPolicy,
  regulationPools: Map<string, BasketballTimeoutPoolRule>
): string | null {
  if (policy.mode === 'continue') {
    if (!policy.regulationPoolId || !regulationPools.has(policy.regulationPoolId)) {
      return 'Overtime timeout continuation must reference a regulation pool.'
    }
    if (policy.pool !== null) return 'Overtime timeout continuation cannot define a new pool.'
  } else if (policy.regulationPoolId !== null || !policy.pool) {
    return 'Overtime timeout reset policy must define a new pool template.'
  } else {
    const poolError = validateTimeoutPoolTemplate(policy.pool)
    if (poolError) return poolError
  }
  if (!isTimeoutAddition(policy.additionsPerOvertime)) {
    return 'Overtime timeout additions are invalid.'
  }
  if (policy.mode === 'new_each' && (
    policy.additionsPerOvertime.total !== 0 ||
    policy.additionsPerOvertime.full !== 0 ||
    policy.additionsPerOvertime.short !== 0
  )) return 'Per-overtime timeout pools cannot also accumulate additions.'
  return null
}

function validateTimeoutCarryover(
  pools: BasketballTimeoutPoolRule[],
  segments: BasketballMatchSegmentV2[]
): string | null {
  const byId = new Map(pools.map(pool => [pool.id, pool]))
  const firstOrderByPool = new Map(pools.map(pool => [
    pool.id,
    Math.min(...pool.segmentIds.map(id => segments.find(segment => segment.id === id)!.order)),
  ]))
  for (const pool of pools) {
    if (!pool.carryoverToPoolId) continue
    if (!byId.has(pool.carryoverToPoolId) || pool.carryoverToPoolId === pool.id) {
      return `Timeout pool ${pool.id} has an invalid carryover target.`
    }
    if (firstOrderByPool.get(pool.carryoverToPoolId)! <= firstOrderByPool.get(pool.id)!) {
      return 'Timeout carryover must move forward through regulation.'
    }
  }
  for (const pool of pools) {
    const seen = new Set<string>()
    let current: BasketballTimeoutPoolRule | undefined = pool
    while (current?.carryoverToPoolId) {
      if (seen.has(current.id)) return 'Timeout carryover cannot contain a cycle.'
      seen.add(current.id)
      current = byId.get(current.carryoverToPoolId)
    }
  }
  return null
}

function isBasketballSegment(value: unknown): value is BasketballMatchSegment {
  return Boolean(
    isPlainObject(value) &&
      isNonEmptyString(value.id) &&
      isNonEmptyString(value.label) &&
      (value.kind === 'regulation' || value.kind === 'overtime') &&
      isPositiveInteger(value.order) &&
      isPositiveInteger(value.durationMs)
  )
}

function isBasketballSegmentV2(value: unknown): value is BasketballMatchSegmentV2 {
  return Boolean(
    isPlainObject(value) &&
      hasExactKeys(value, [
        'id',
        'label',
        'kind',
        'order',
        'durationMs',
        'foulWindowId',
        'timeoutPoolId',
        'lineupChangeBoundary',
      ]) &&
      isBasketballSegment(value) &&
      isBasketballRuleId(value.id) &&
      isBasketballRuleLabel(value.label) &&
      isBasketballRuleId(value.foulWindowId) &&
      isBasketballRuleId(value.timeoutPoolId) &&
      typeof value.lineupChangeBoundary === 'boolean'
  )
}

function isBasketballFoulWindowRule(value: unknown): value is BasketballFoulWindowRule {
  return Boolean(
    isPlainObject(value) &&
      hasExactKeys(value, [
        'id',
        'label',
        'segmentIds',
        'bonusThreshold',
        'doubleBonusThreshold',
        'hasOneAndOne',
      ]) &&
      isBasketballRuleId(value.id) &&
      isBasketballRuleLabel(value.label) &&
      Array.isArray(value.segmentIds) &&
      value.segmentIds.length > 0 &&
      value.segmentIds.every(isBasketballRuleId) &&
      new Set(value.segmentIds).size === value.segmentIds.length &&
      validateBonusPolicy(value) === null
  )
}

function isBasketballTimeoutPoolRule(value: unknown): value is BasketballTimeoutPoolRule {
  return Boolean(
    isPlainObject(value) &&
      hasExactKeys(value, [
        'id',
        'label',
        'segmentIds',
        'totalLimit',
        'fullLimit',
        'shortLimit',
        'carryoverToPoolId',
      ]) &&
      isBasketballRuleId(value.id) &&
      isBasketballRuleLabel(value.label) &&
      Array.isArray(value.segmentIds) &&
      value.segmentIds.length > 0 &&
      value.segmentIds.every(isBasketballRuleId) &&
      new Set(value.segmentIds).size === value.segmentIds.length &&
      validateTimeoutLimits(value) === null &&
      (value.carryoverToPoolId === null || isBasketballRuleId(value.carryoverToPoolId))
  )
}

function isBasketballOvertimeTemplateV2(value: unknown): value is BasketballOvertimeTemplateV2 {
  return Boolean(
    isPlainObject(value) &&
      hasExactKeys(value, [
        'idPrefix',
        'label',
        'durationMs',
        'foulPolicy',
        'timeoutPolicy',
        'lineupChangeBoundary',
      ]) &&
      isBasketballRuleId(value.idPrefix) &&
      isBasketballRuleLabel(value.label) &&
      isPositiveInteger(value.durationMs) &&
      isOvertimeFoulPolicyShape(value.foulPolicy) &&
      isOvertimeTimeoutPolicyShape(value.timeoutPolicy) &&
      typeof value.lineupChangeBoundary === 'boolean'
  )
}

function isOvertimeFoulPolicyShape(value: unknown): value is BasketballOvertimeFoulPolicy {
  return Boolean(
    isPlainObject(value) &&
      hasExactKeys(value, ['mode', 'regulationWindowId', 'window']) &&
      isOvertimeWindowMode(value.mode) &&
      (value.regulationWindowId === null || isBasketballRuleId(value.regulationWindowId)) &&
      (value.window === null || validateFoulWindowTemplate(value.window) === null)
  )
}

function isOvertimeTimeoutPolicyShape(value: unknown): value is BasketballOvertimeTimeoutPolicy {
  return Boolean(
    isPlainObject(value) &&
      hasExactKeys(value, ['mode', 'regulationPoolId', 'pool', 'additionsPerOvertime']) &&
      isOvertimeWindowMode(value.mode) &&
      (value.regulationPoolId === null || isBasketballRuleId(value.regulationPoolId)) &&
      (value.pool === null || validateTimeoutPoolTemplate(value.pool) === null) &&
      isTimeoutAddition(value.additionsPerOvertime)
  )
}

function validateFoulWindowTemplate(value: unknown): string | null {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'label',
    'bonusThreshold',
    'doubleBonusThreshold',
    'hasOneAndOne',
  ])) return 'Overtime foul window template is invalid.'
  if (!isBasketballRuleLabel(value.label)) return 'Overtime foul window label is invalid.'
  return validateBonusPolicy(value)
}

function validateBonusPolicy(value: Record<string, unknown>): string | null {
  if (!isNullablePositiveInteger(value.bonusThreshold)) return 'Bonus threshold is invalid.'
  if (!isNullablePositiveInteger(value.doubleBonusThreshold)) {
    return 'Double-bonus threshold is invalid.'
  }
  if (typeof value.hasOneAndOne !== 'boolean') return 'One-and-one policy is invalid.'
  if (value.bonusThreshold === null) {
    return value.doubleBonusThreshold === null && value.hasOneAndOne === false
      ? null
      : 'A disabled bonus cannot define later bonus behavior.'
  }
  if (value.doubleBonusThreshold === null || value.doubleBonusThreshold < value.bonusThreshold) {
    return 'Double-bonus threshold cannot precede the bonus threshold.'
  }
  if (!value.hasOneAndOne && value.doubleBonusThreshold !== value.bonusThreshold) {
    return 'Two-shot bonus profiles must use one threshold.'
  }
  return null
}

function validateTimeoutPoolTemplate(value: unknown): string | null {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'label',
    'totalLimit',
    'fullLimit',
    'shortLimit',
  ])) return 'Overtime timeout pool template is invalid.'
  if (!isBasketballRuleLabel(value.label)) return 'Overtime timeout pool label is invalid.'
  return validateTimeoutLimits(value)
}

function validateTimeoutLimits(value: Record<string, unknown>): string | null {
  if (
    !isNullableNonNegativeInteger(value.totalLimit) ||
    !isNullableNonNegativeInteger(value.fullLimit) ||
    !isNullableNonNegativeInteger(value.shortLimit)
  ) return 'Timeout limits must be non-negative or unlimited.'
  if (
    value.totalLimit !== null &&
    (
      (value.fullLimit !== null && value.fullLimit > value.totalLimit) ||
      (value.shortLimit !== null && value.shortLimit > value.totalLimit)
    )
  ) return 'Timeout kind limits cannot exceed the total limit.'
  return null
}

function isTimeoutAddition(value: unknown): value is BasketballOvertimeTimeoutPolicy['additionsPerOvertime'] {
  return Boolean(
    isPlainObject(value) &&
      hasExactKeys(value, ['total', 'full', 'short']) &&
      isNonNegativeInteger(value.total) &&
      isNonNegativeInteger(value.full) &&
      isNonNegativeInteger(value.short)
  )
}

function exactlyOnce(values: string[], expected: Set<string>): boolean {
  if (values.length !== expected.size) return false
  return values.every(value => expected.has(value)) && new Set(values).size === expected.size
}

function isOvertimeWindowMode(value: unknown): boolean {
  return value === 'continue' || value === 'new_each' || value === 'shared_overtimes'
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBasketballRuleId(value: unknown): value is string {
  return isNonEmptyString(value) &&
    Array.from(value).length <= BASKETBALL_RULE_ID_MAX_LENGTH
}

function isBasketballRuleLabel(value: unknown): value is string {
  return isNonEmptyString(value) &&
    Array.from(value).length <= BASKETBALL_RULE_LABEL_MAX_LENGTH
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value)
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value)
}

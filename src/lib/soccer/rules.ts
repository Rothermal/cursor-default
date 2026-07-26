import { isPlainObject } from '../gameEvents/envelope'
import type {
  SoccerMatchRules,
  SoccerMatchSegment,
  SoccerRole,
} from './types'

const MINUTE_MS = 60_000

export const DEFAULT_SOCCER_MATCH_RULES: SoccerMatchRules = {
  regulationSegments: [
    { id: 'regulation-1', label: 'First Half', kind: 'regulation', order: 1, durationMs: 45 * MINUTE_MS },
    { id: 'regulation-2', label: 'Second Half', kind: 'regulation', order: 2, durationMs: 45 * MINUTE_MS },
  ],
  extraTimeSegments: [
    { id: 'extra-time-1', label: 'Extra Time 1', kind: 'extra_time', order: 3, durationMs: 15 * MINUTE_MS },
    { id: 'extra-time-2', label: 'Extra Time 2', kind: 'extra_time', order: 4, durationMs: 15 * MINUTE_MS },
  ],
  extraTimeAvailable: false,
  shootoutAvailable: false,
  clockDirection: 'count_up',
  clockDisplay: 'continuous',
  maxOnFieldPlayers: 11,
  allowReturnSubstitutions: false,
  substitutionLimit: null,
  substitutionWindowLimit: null,
  maxAssistsPerGoal: 2,
  yellowCardExitPolicy: 'stay_on',
  redCardReplacementPolicy: 'play_short',
  tieResolution: 'draw_allowed',
  shootoutInitialKicksPerSide: 5,
  allowUnusedGoalkeeperShootoutReplacement: false,
}

export type SoccerConfigurableRules = Omit<
  SoccerMatchRules,
  'extraTimeAvailable' | 'shootoutAvailable'
>

export type SoccerMatchRulesOverride = Partial<SoccerConfigurableRules>

export interface SoccerRuleLayers {
  personalDefaults?: SoccerMatchRulesOverride | null
  teamDefaults?: SoccerMatchRulesOverride | null
  gameOverrides?: SoccerMatchRulesOverride | null
}

export function resolveSoccerMatchRules(layers: SoccerRuleLayers = {}): SoccerMatchRules {
  const orderedLayers = [
    layers.personalDefaults,
    layers.teamDefaults,
    layers.gameOverrides,
  ]
  const resolved = orderedLayers.reduce<SoccerMatchRules>((rules, layer) => ({
    ...rules,
    ...(layer ?? {}),
  } as SoccerMatchRules), {
    ...DEFAULT_SOCCER_MATCH_RULES,
    regulationSegments: DEFAULT_SOCCER_MATCH_RULES.regulationSegments.map(segment => ({ ...segment })),
    extraTimeSegments: DEFAULT_SOCCER_MATCH_RULES.extraTimeSegments.map(segment => ({ ...segment })),
  })

  synchronizeTieResolution(resolved, true)

  const error = validateSoccerMatchRules(resolved)
  if (error) throw new Error(error)
  return structuredClone(resolved)
}

export function configurableSoccerRulesFromMatchRules(
  rules: SoccerMatchRules
): SoccerConfigurableRules {
  const configurable = structuredClone(rules) as Partial<SoccerMatchRules>
  delete configurable.extraTimeAvailable
  delete configurable.shootoutAvailable
  return configurable as SoccerConfigurableRules
}

export function normalizeSoccerMatchRules(value: unknown): SoccerMatchRules | null {
  if (!isPlainObject(value)) return null
  const normalized = {
    ...value,
    yellowCardExitPolicy: value.yellowCardExitPolicy ?? 'stay_on',
    redCardReplacementPolicy: value.redCardReplacementPolicy ?? 'play_short',
    tieResolution: value.tieResolution ?? tieResolutionFromLegacy(
      value.extraTimeAvailable === true,
      value.shootoutAvailable === true
    ),
    shootoutInitialKicksPerSide: value.shootoutInitialKicksPerSide ?? 5,
    allowUnusedGoalkeeperShootoutReplacement:
      value.allowUnusedGoalkeeperShootoutReplacement ?? false,
  } as unknown as SoccerMatchRules
  synchronizeTieResolution(normalized, true)
  return validateSoccerMatchRules(normalized) === null ? structuredClone(normalized) : null
}

export function validateSoccerRole(value: unknown): value is SoccerRole {
  return Boolean(
    isPlainObject(value) &&
      ['goalkeeper', 'defender', 'midfielder', 'forward', 'custom'].includes(String(value.group)) &&
      (value.label === null || typeof value.label === 'string') &&
      (value.group !== 'custom' || (typeof value.label === 'string' && value.label.trim().length > 0))
  )
}

export function validateSoccerMatchRules(value: unknown): string | null {
  if (!isPlainObject(value)) return 'Soccer rules must be an object.'
  if (!Array.isArray(value.regulationSegments) || value.regulationSegments.length === 0) {
    return 'At least one regulation segment is required.'
  }
  if (!Array.isArray(value.extraTimeSegments)) return 'Extra-time segments must be an array.'
  const segments = [...value.regulationSegments, ...value.extraTimeSegments]
  if (!segments.every(isMatchSegment)) return 'Every match segment must be valid.'
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) {
    return 'Match segment ids must be unique.'
  }
  const orders = segments.map(segment => segment.order)
  if (new Set(orders).size !== orders.length) return 'Match segment order values must be unique.'
  if (!value.regulationSegments.every(segment => segment.kind === 'regulation')) {
    return 'Regulation segments must use the regulation kind.'
  }
  if (!value.extraTimeSegments.every(segment => segment.kind === 'extra_time')) {
    return 'Extra-time segments must use the extra-time kind.'
  }
  if (typeof value.extraTimeAvailable !== 'boolean' || typeof value.shootoutAvailable !== 'boolean') {
    return 'Extra-time and shootout availability must be boolean.'
  }
  if (value.clockDirection !== 'count_up' && value.clockDirection !== 'count_down') {
    return 'Clock direction is invalid.'
  }
  if (value.clockDisplay !== 'continuous' && value.clockDisplay !== 'per_period') {
    return 'Clock display mode is invalid.'
  }
  if (!isPositiveInteger(value.maxOnFieldPlayers)) return 'Maximum on-field players must be positive.'
  if (typeof value.allowReturnSubstitutions !== 'boolean') return 'Return substitution policy is invalid.'
  if (!isNullableNonNegativeInteger(value.substitutionLimit)) return 'Substitution limit is invalid.'
  if (!isNullableNonNegativeInteger(value.substitutionWindowLimit)) return 'Substitution window limit is invalid.'
  if (!isNonNegativeInteger(value.maxAssistsPerGoal) || Number(value.maxAssistsPerGoal) > 2) {
    return 'Maximum assists per goal must be 0, 1, or 2.'
  }
  if (value.yellowCardExitPolicy !== 'stay_on' && value.yellowCardExitPolicy !== 'must_leave_may_replace') {
    return 'Yellow-card exit policy is invalid.'
  }
  if (value.redCardReplacementPolicy !== 'play_short') return 'Red-card replacement policy is invalid.'
  if (!['draw_allowed', 'extra_time_then_shootout', 'direct_to_shootout'].includes(String(value.tieResolution))) {
    return 'Tie resolution is invalid.'
  }
  if (!isPositiveInteger(value.shootoutInitialKicksPerSide)) {
    return 'Initial shootout kick count must be positive.'
  }
  if (typeof value.allowUnusedGoalkeeperShootoutReplacement !== 'boolean') {
    return 'Shootout goalkeeper replacement policy is invalid.'
  }
  const expectedLegacy = legacyAvailabilityForTie(value.tieResolution as SoccerMatchRules['tieResolution'])
  if (
    value.extraTimeAvailable !== expectedLegacy.extraTimeAvailable ||
    value.shootoutAvailable !== expectedLegacy.shootoutAvailable
  ) {
    return 'Legacy extra-time and shootout availability must match tie resolution.'
  }
  return null
}

export function orderedSoccerSegments(rules: SoccerMatchRules): SoccerMatchSegment[] {
  return [...rules.regulationSegments, ...(rules.extraTimeAvailable ? rules.extraTimeSegments : [])]
    .sort((left, right) => left.order - right.order)
}

function isMatchSegment(value: unknown): value is SoccerMatchSegment {
  return Boolean(
    isPlainObject(value) &&
      typeof value.id === 'string' && value.id.trim().length > 0 &&
      typeof value.label === 'string' && value.label.trim().length > 0 &&
      (value.kind === 'regulation' || value.kind === 'extra_time') &&
      isNonNegativeInteger(value.order) &&
      isPositiveInteger(value.durationMs)
  )
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value)
}

export function withSoccerTieResolution(
  rules: SoccerMatchRules,
  tieResolution: SoccerMatchRules['tieResolution']
): SoccerMatchRules {
  const next = structuredClone(rules)
  next.tieResolution = tieResolution
  synchronizeTieResolution(next, true)
  return next
}

export function soccerTieResolutionFromAvailability(
  extraTimeAvailable: boolean,
  shootoutAvailable: boolean
): SoccerMatchRules['tieResolution'] {
  return tieResolutionFromLegacy(extraTimeAvailable, shootoutAvailable)
}

function tieResolutionFromLegacy(
  extraTimeAvailable: boolean,
  shootoutAvailable: boolean
): SoccerMatchRules['tieResolution'] {
  if (!shootoutAvailable) return 'draw_allowed'
  return extraTimeAvailable ? 'extra_time_then_shootout' : 'direct_to_shootout'
}

function legacyAvailabilityForTie(tieResolution: SoccerMatchRules['tieResolution']): {
  extraTimeAvailable: boolean
  shootoutAvailable: boolean
} {
  return {
    extraTimeAvailable: tieResolution === 'extra_time_then_shootout',
    shootoutAvailable: tieResolution !== 'draw_allowed',
  }
}

function synchronizeTieResolution(rules: SoccerMatchRules, tieResolutionIsAuthority: boolean): void {
  if (!tieResolutionIsAuthority) {
    rules.tieResolution = tieResolutionFromLegacy(rules.extraTimeAvailable, rules.shootoutAvailable)
  }
  const legacy = legacyAvailabilityForTie(rules.tieResolution)
  rules.extraTimeAvailable = legacy.extraTimeAvailable
  rules.shootoutAvailable = legacy.shootoutAvailable
}

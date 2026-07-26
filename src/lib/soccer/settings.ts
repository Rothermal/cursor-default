import { isPlainObject } from '../gameEvents/envelope'
import {
  DEFAULT_SOCCER_MATCH_RULES,
  configurableSoccerRulesFromMatchRules,
  resolveSoccerMatchRules,
  type SoccerConfigurableRules,
  type SoccerMatchRulesOverride,
} from './rules'
import type { SoccerMatchRules } from './types'

export const SOCCER_SETTINGS_SCHEMA_VERSION = 1
const MAX_STORED_INTEGER = 2_147_483_647

export type SoccerSettingsLayer = 'personal' | 'team' | 'match'
export type SoccerRuleSource = 'built_in' | SoccerSettingsLayer

export interface SoccerDisplayPreferences {
  fieldFlipped: boolean
}

export interface SoccerPersonalSettings {
  rules: SoccerConfigurableRules
  display: SoccerDisplayPreferences
}

export interface SoccerTeamSettings {
  rules: SoccerMatchRulesOverride
}

export interface SoccerSettingsDiagnostic {
  layer: SoccerSettingsLayer
  code: 'invalid_settings' | 'invalid_effective_rules'
  message: string
}

export type SoccerRuleSourceMap = {
  [Key in keyof SoccerMatchRules]: SoccerRuleSource
}

export interface SoccerSettingsHierarchy {
  rules: SoccerMatchRules
  sources: SoccerRuleSourceMap
  diagnostics: SoccerSettingsDiagnostic[]
}

export type SoccerSettingsParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export const CONFIGURABLE_SOCCER_RULE_KEYS = [
  'regulationSegments',
  'extraTimeSegments',
  'clockDirection',
  'clockDisplay',
  'maxOnFieldPlayers',
  'allowReturnSubstitutions',
  'substitutionLimit',
  'substitutionWindowLimit',
  'maxAssistsPerGoal',
  'yellowCardExitPolicy',
  'redCardReplacementPolicy',
  'tieResolution',
  'shootoutInitialKicksPerSide',
  'allowUnusedGoalkeeperShootoutReplacement',
] as const satisfies ReadonlyArray<keyof SoccerConfigurableRules>

const CONFIGURABLE_RULE_KEY_SET = new Set<string>(CONFIGURABLE_SOCCER_RULE_KEYS)
const DERIVED_LEGACY_KEYS = new Set(['extraTimeAvailable', 'shootoutAvailable'])

export const DEFAULT_SOCCER_PERSONAL_SETTINGS: SoccerPersonalSettings = {
  rules: configurableSoccerRulesFromMatchRules(DEFAULT_SOCCER_MATCH_RULES),
  display: {
    fieldFlipped: false,
  },
}

export function soccerRulesOverrideFromDifference(
  inherited: SoccerMatchRules,
  desired: SoccerMatchRules
): SoccerMatchRulesOverride {
  const inheritedRules = configurableSoccerRulesFromMatchRules(inherited)
  const desiredRules = configurableSoccerRulesFromMatchRules(desired)
  const override: SoccerMatchRulesOverride = {}
  for (const key of CONFIGURABLE_SOCCER_RULE_KEYS) {
    if (!sameStoredValue(inheritedRules[key], desiredRules[key])) {
      assignConfigurableRule(override, key, desiredRules[key])
    }
  }
  return override
}

export function soccerRulesOverrideFingerprint(
  override: SoccerMatchRulesOverride
): string {
  const ordered: Record<string, unknown> = {}
  for (const key of CONFIGURABLE_SOCCER_RULE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      ordered[key] = override[key]
    }
  }
  return JSON.stringify(ordered)
}

export function parseSoccerPersonalSettings(
  value: unknown
): SoccerSettingsParseResult<SoccerPersonalSettings> {
  if (!hasExactKeys(value, ['rules', 'display'])) {
    return invalid('Personal soccer settings must contain only rules and display.')
  }

  const rules = parseSoccerConfigurableRules(value.rules, true)
  if (!rules.ok) return rules

  if (!hasExactKeys(value.display, ['fieldFlipped'])) {
    return invalid('Soccer display settings must contain only fieldFlipped.')
  }
  if (typeof value.display.fieldFlipped !== 'boolean') {
    return invalid('Soccer fieldFlipped must be boolean.')
  }

  return {
    ok: true,
    value: {
      rules: rules.value as SoccerConfigurableRules,
      display: { fieldFlipped: value.display.fieldFlipped },
    },
  }
}

export function parseSoccerTeamSettings(
  value: unknown
): SoccerSettingsParseResult<SoccerTeamSettings> {
  if (!hasExactKeys(value, ['rules'])) {
    return invalid('Team soccer settings must contain only rules.')
  }
  const rules = parseSoccerConfigurableRules(value.rules, false)
  return rules.ok
    ? { ok: true, value: { rules: rules.value } }
    : rules
}

export function parseSoccerRulesOverride(
  value: unknown
): SoccerSettingsParseResult<SoccerMatchRulesOverride> {
  return parseSoccerConfigurableRules(value, false)
}

export function resolveSoccerSettingsHierarchy(layers: {
  personalDefaults?: unknown
  teamDefaults?: unknown
  gameOverrides?: unknown
} = {}): SoccerSettingsHierarchy {
  let rules = resolveSoccerMatchRules()
  const sources = defaultSourceMap()
  const diagnostics: SoccerSettingsDiagnostic[] = []

  const candidates: Array<{
    layer: SoccerSettingsLayer
    value: unknown
    complete: boolean
  }> = [
    { layer: 'personal', value: layers.personalDefaults, complete: true },
    { layer: 'team', value: layers.teamDefaults, complete: false },
    { layer: 'match', value: layers.gameOverrides, complete: false },
  ]

  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null) continue

    const parsed = parseSoccerConfigurableRules(candidate.value, candidate.complete)
    if (!parsed.ok) {
      diagnostics.push({
        layer: candidate.layer,
        code: 'invalid_settings',
        message: parsed.error,
      })
      continue
    }

    try {
      const next = resolveSoccerMatchRules({
        gameOverrides: {
          ...configurableSoccerRulesFromMatchRules(rules),
          ...parsed.value,
        },
      })
      rules = next
      for (const key of Object.keys(parsed.value) as Array<keyof SoccerConfigurableRules>) {
        sources[key] = candidate.layer
      }
      sources.extraTimeAvailable = sources.tieResolution
      sources.shootoutAvailable = sources.tieResolution
    } catch (error) {
      diagnostics.push({
        layer: candidate.layer,
        code: 'invalid_effective_rules',
        message: error instanceof Error ? error.message : 'Soccer rules are invalid.',
      })
    }
  }

  return {
    rules: structuredClone(rules),
    sources: { ...sources },
    diagnostics,
  }
}

function parseSoccerConfigurableRules(
  value: unknown,
  complete: boolean
): SoccerSettingsParseResult<SoccerMatchRulesOverride> {
  if (!isPlainObject(value)) return invalid('Soccer rules must be an object.')

  const keys = Object.keys(value)
  const derived = keys.find(key => DERIVED_LEGACY_KEYS.has(key))
  if (derived) {
    return invalid(`${derived} is derived from tieResolution and cannot be stored.`)
  }
  const unknown = keys.find(key => !CONFIGURABLE_RULE_KEY_SET.has(key))
  if (unknown) return invalid(`Unknown soccer rule: ${unknown}.`)
  if (complete) {
    const missing = CONFIGURABLE_SOCCER_RULE_KEYS.find(key => !(key in value))
    if (missing) return invalid(`Personal soccer rules are missing ${missing}.`)
  }

  const segmentError = validateStoredSegments(value)
  if (segmentError) return invalid(segmentError)
  const integerError = validateStoredIntegerBounds(value)
  if (integerError) return invalid(integerError)

  const candidate = value as SoccerMatchRulesOverride
  try {
    const resolved = resolveSoccerMatchRules({ gameOverrides: candidate })
    const parsed = configurableSoccerRulesFromMatchRules(resolved)
    const result: SoccerMatchRulesOverride = {}
    for (const key of keys as Array<keyof SoccerConfigurableRules>) {
      assignConfigurableRule(result, key, parsed[key])
    }
    return { ok: true, value: result }
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Soccer rules are invalid.')
  }
}

function validateStoredSegments(value: Record<string, unknown>): string | null {
  const groups = [
    {
      key: 'regulationSegments',
      kind: 'regulation',
      allowEmpty: false,
    },
    {
      key: 'extraTimeSegments',
      kind: 'extra_time',
      allowEmpty: true,
    },
  ] as const

  const combinedIds = new Set<string>()
  const combinedOrders = new Set<number>()
  for (const group of groups) {
    if (!(group.key in value)) continue
    const segments = value[group.key]
    if (!Array.isArray(segments)) return `${group.key} must be an array.`
    if (!group.allowEmpty && segments.length === 0) {
      return 'At least one regulation segment is required.'
    }
    if (segments.length > 20) return `${group.key} cannot contain more than 20 segments.`

    for (const segment of segments) {
      if (!hasExactKeys(segment, ['id', 'label', 'kind', 'order', 'durationMs'])) {
        return 'Every stored match segment must use the exact schema.'
      }
      if (
        typeof segment.id !== 'string' ||
        !segment.id.trim() ||
        segment.id.length > 80 ||
        typeof segment.label !== 'string' ||
        !segment.label.trim() ||
        segment.label.length > 120 ||
        segment.kind !== group.kind ||
        !Number.isInteger(segment.order) ||
        Number(segment.order) < 0 ||
        Number(segment.order) > MAX_STORED_INTEGER ||
        !Number.isInteger(segment.durationMs) ||
        Number(segment.durationMs) <= 0 ||
        Number(segment.durationMs) > MAX_STORED_INTEGER
      ) {
        return 'Stored match segment values are invalid.'
      }
      const order = Number(segment.order)
      if (combinedIds.has(segment.id)) return 'Match segment ids must be unique.'
      if (combinedOrders.has(order)) return 'Match segment orders must be unique.'
      combinedIds.add(segment.id)
      combinedOrders.add(order)
    }
  }
  return null
}

function validateStoredIntegerBounds(value: Record<string, unknown>): string | null {
  const keys = [
    'maxOnFieldPlayers',
    'substitutionLimit',
    'substitutionWindowLimit',
    'maxAssistsPerGoal',
    'shootoutInitialKicksPerSide',
  ] as const
  for (const key of keys) {
    const candidate = value[key]
    if (
      typeof candidate === 'number' &&
      Math.abs(candidate) > MAX_STORED_INTEGER
    ) {
      return `Stored soccer rule ${key} exceeds the supported integer range.`
    }
  }
  return null
}

function assignConfigurableRule<Key extends keyof SoccerConfigurableRules>(
  target: SoccerMatchRulesOverride,
  key: Key,
  value: SoccerConfigurableRules[Key]
): void {
  target[key] = structuredClone(value) as SoccerMatchRulesOverride[Key]
}

function sameStoredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function defaultSourceMap(): SoccerRuleSourceMap {
  return {
    regulationSegments: 'built_in',
    extraTimeSegments: 'built_in',
    extraTimeAvailable: 'built_in',
    shootoutAvailable: 'built_in',
    clockDirection: 'built_in',
    clockDisplay: 'built_in',
    maxOnFieldPlayers: 'built_in',
    allowReturnSubstitutions: 'built_in',
    substitutionLimit: 'built_in',
    substitutionWindowLimit: 'built_in',
    maxAssistsPerGoal: 'built_in',
    yellowCardExitPolicy: 'built_in',
    redCardReplacementPolicy: 'built_in',
    tieResolution: 'built_in',
    shootoutInitialKicksPerSide: 'built_in',
    allowUnusedGoalkeeperShootoutReplacement: 'built_in',
  }
}

function hasExactKeys<T extends string>(
  value: unknown,
  expectedKeys: readonly T[]
): value is Record<T, unknown> {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  return keys.length === expectedKeys.length &&
    keys.every(key => expectedKeys.includes(key as T))
}

function invalid(error: string): SoccerSettingsParseResult<never> {
  return { ok: false, error }
}

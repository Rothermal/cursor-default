import { isPlainObject } from '../gameEvents/envelope'
import { stableJson } from '../gameEvents/stream'
import { emptyHockeyLineupDefaults, parseHockeyLineupDefaults, type HockeyLineupDefaults } from './lineupDefaults'
import { DEFAULT_HOCKEY_PROFILE_ID, findHockeyRulesProfile, withExplicitHockeySuddenDeath } from './profiles'
import type { HockeyRulesProfile } from './profiles'
import { HOCKEY_RULES_FIELDS, validateHockeyMatchRules } from './rules'
import type {
  HockeyMatchRules,
  HockeyProfileId,
  HockeyRuleOverrides,
  HockeyRuleSource,
  HockeyRulesField,
  HockeySettingsAuthority,
  HockeySettingsV1,
} from './types'
import { HOCKEY_SETTINGS_SCHEMA_VERSION } from './types'

export type HockeySettingsParseResult =
  | { ok: true; value: HockeySettingsV1 }
  | { ok: false; error: string }

export interface HockeyResolvedRules {
  profile: HockeyRulesProfile
  rules: HockeyMatchRules
  sourceByField: Record<HockeyRulesField, HockeyRuleSource>
  customized: boolean
}

export type HockeyRulesResolutionResult =
  | { ok: true; value: HockeyResolvedRules }
  | { ok: false; layer: HockeyRuleSource; message: string }

/** Settings used when nothing has been saved: the default profile, unchanged. */
export function defaultHockeySettings(): HockeySettingsV1 {
  return {
    settingsSchemaVersion: HOCKEY_SETTINGS_SCHEMA_VERSION,
    baseProfile: { profileId: DEFAULT_HOCKEY_PROFILE_ID, profileVersion: 1 },
    ruleOverrides: {},
  }
}

/**
 * Exact parser for personal or team settings. `null`/`undefined` mean nothing is
 * saved and resolve to defaults; any malformed value fails closed.
 */
export function parseHockeySettings(value: unknown): HockeySettingsParseResult {
  if (value === null || value === undefined) return { ok: true, value: defaultHockeySettings() }
  if (!isPlainObject(value)) return { ok: false, error: 'settings must be an object' }
  const keys = Object.keys(value)
  if (
    keys.length !== 3 ||
    !['settingsSchemaVersion', 'baseProfile', 'ruleOverrides'].every(key => Object.prototype.hasOwnProperty.call(value, key))
  ) return { ok: false, error: 'settings contain unknown or missing fields' }
  if (value.settingsSchemaVersion !== HOCKEY_SETTINGS_SCHEMA_VERSION) {
    return { ok: false, error: 'unsupported settings version' }
  }
  const base = value.baseProfile
  if (
    !isPlainObject(base) ||
    Object.keys(base).length !== 2 ||
    typeof base.profileId !== 'string' ||
    typeof base.profileVersion !== 'number' ||
    !findHockeyRulesProfile(base.profileId, base.profileVersion)
  ) return { ok: false, error: 'unknown base profile' }
  if (!isPlainObject(value.ruleOverrides)) return { ok: false, error: 'rule overrides must be an object' }
  const overrides = normalizeHockeyRuleOverrides(value.ruleOverrides)
  if (!overrides) return { ok: false, error: 'rule overrides contain unsupported fields' }
  // Saved overrides must produce valid rules on their own base profile.
  const profile = findHockeyRulesProfile(base.profileId, base.profileVersion)!
  const error = validateHockeyMatchRules(applyHockeyRuleOverrides(profile.rules, overrides))
  if (error) return { ok: false, error: `rule overrides are invalid: ${error}` }
  return {
    ok: true,
    value: {
      settingsSchemaVersion: HOCKEY_SETTINGS_SCHEMA_VERSION,
      baseProfile: structuredClone(base) as unknown as HockeySettingsV1['baseProfile'],
      ruleOverrides: overrides,
    },
  }
}

/** Accepts only known rule fields; callers validate the values against a base (see above). */
export function normalizeHockeyRuleOverrides(value: unknown): HockeyRuleOverrides | null {
  if (value === null || value === undefined) return {}
  if (!isPlainObject(value)) return null
  if (!Object.keys(value).every(key => (HOCKEY_RULES_FIELDS as readonly string[]).includes(key))) {
    return null
  }
  return structuredClone(value) as HockeyRuleOverrides
}

/**
 * Personal-or-team authority (Basketball's model): a team game uses
 * built-in -> team -> match, a personal game uses built-in -> personal -> match.
 * A recorder's personal defaults never apply to a team game.
 */
export function resolveHockeySettingsHierarchy({
  authority,
  personalSettings,
  teamSettings,
  matchOverrides,
}: {
  authority: HockeySettingsAuthority
  personalSettings?: unknown
  teamSettings?: unknown
  matchOverrides?: unknown
}): HockeyRulesResolutionResult {
  const parsed = parseHockeySettings(authority === 'personal' ? personalSettings : teamSettings)
  if (!parsed.ok) {
    return {
      ok: false,
      layer: authority,
      message: `${authority === 'personal' ? 'Personal' : 'Team'} hockey settings are invalid: ${parsed.error}`,
    }
  }
  const match = normalizeHockeyRuleOverrides(matchOverrides)
  if (!match) {
    return { ok: false, layer: 'match', message: 'Hockey match rule overrides contain unsupported fields.' }
  }
  const profile = findHockeyRulesProfile(
    parsed.value.baseProfile.profileId,
    parsed.value.baseProfile.profileVersion
  )!

  let rules = structuredClone(profile.rules) as HockeyMatchRules
  const sourceByField = Object.fromEntries(
    HOCKEY_RULES_FIELDS.map(field => [field, 'built_in'])
  ) as Record<HockeyRulesField, HockeyRuleSource>

  const layers: { id: HockeyRuleSource; overrides: HockeyRuleOverrides }[] = [
    { id: authority, overrides: parsed.value.ruleOverrides },
    { id: 'match', overrides: match },
  ]
  for (const layer of layers) {
    rules = applyHockeyRuleOverrides(rules, layer.overrides)
    for (const field of HOCKEY_RULES_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(layer.overrides, field)) sourceByField[field] = layer.id
    }
    const error = validateHockeyMatchRules(rules)
    if (error) return { ok: false, layer: layer.id, message: error }
  }

  return {
    ok: true,
    value: {
      profile,
      // A stored HKY-1 overtime override resolves through the same reader; new setups write five keys.
      rules: withExplicitHockeySuddenDeath(rules),
      sourceByField,
      customized: HOCKEY_RULES_FIELDS.some(field => sourceByField[field] !== 'built_in'),
    },
  }
}

/** Returns a clone of `rules` with each overridden field replaced (nested objects are atomic). */
function applyHockeyRuleOverrides(rules: HockeyMatchRules, overrides: HockeyRuleOverrides): HockeyMatchRules {
  const next = structuredClone(rules) as HockeyMatchRules
  for (const field of HOCKEY_RULES_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) {
      ;(next as Record<string, unknown>)[field] = structuredClone(overrides[field])
    }
  }
  return next
}

/** Team settings (HKY-5C): the shared rules shape plus Starter/Bench and goalie defaults. */
export interface HockeyTeamSettingsV1 extends HockeySettingsV1 {
  lineupDefaults: HockeyLineupDefaults
}

export type HockeyTeamSettingsParseResult =
  | { ok: true; value: HockeyTeamSettingsV1 }
  | { ok: false; error: string }

export function defaultHockeyTeamSettings(): HockeyTeamSettingsV1 {
  return { ...defaultHockeySettings(), lineupDefaults: emptyHockeyLineupDefaults() }
}

/** Exact team parser; `null`/`undefined` mean nothing is saved. */
export function parseHockeyTeamSettings(value: unknown): HockeyTeamSettingsParseResult {
  if (value === null || value === undefined) return { ok: true, value: defaultHockeyTeamSettings() }
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, 'lineupDefaults')) {
    return { ok: false, error: 'team settings contain unknown or missing fields' }
  }
  const { lineupDefaults, ...rules } = value
  const parsed = parseHockeySettings(rules)
  if (!parsed.ok) return parsed
  const lineup = parseHockeyLineupDefaults(lineupDefaults)
  if (!lineup) return { ok: false, error: 'default lineup is invalid' }
  return { ok: true, value: { ...parsed.value, lineupDefaults: lineup } }
}

/** The rules part of team settings, for `resolveHockeySettingsHierarchy`. */
export function hockeyTeamRulesSettings(settings: HockeyTeamSettingsV1): HockeySettingsV1 {
  return {
    settingsSchemaVersion: settings.settingsSchemaVersion,
    baseProfile: structuredClone(settings.baseProfile),
    ruleOverrides: structuredClone(settings.ruleOverrides),
  }
}

/** Rules the settings describe on their own (no match layer). */
export function hockeySettingsRules(settings: HockeySettingsV1): HockeyMatchRules | null {
  const profile = findHockeyRulesProfile(settings.baseProfile.profileId, settings.baseProfile.profileVersion)
  if (!profile) return null
  const rules = applyHockeyRuleOverrides(profile.rules, settings.ruleOverrides)
  return validateHockeyMatchRules(rules) === null ? withExplicitHockeySuddenDeath(rules) : null
}

/**
 * Stores `rules` as overrides of the settings' profile: only fields that differ from the
 * profile are kept, so choosing a profile value again removes its override.
 */
export function hockeySettingsWithRules<T extends HockeySettingsV1>(settings: T, rules: HockeyMatchRules): T {
  const profile = findHockeyRulesProfile(settings.baseProfile.profileId, settings.baseProfile.profileVersion)
  if (!profile) return settings
  const base = withExplicitHockeySuddenDeath(structuredClone(profile.rules) as HockeyMatchRules)
  const ruleOverrides: HockeyRuleOverrides = {}
  for (const field of HOCKEY_RULES_FIELDS) {
    if (stableJson(rules[field]) !== stableJson(base[field])) {
      ;(ruleOverrides as Record<string, unknown>)[field] = structuredClone(rules[field])
    }
  }
  return { ...settings, ruleOverrides }
}

/** Choosing another profile starts from its rules; overrides of the old one are dropped. */
export function hockeySettingsWithProfile<T extends HockeySettingsV1>(settings: T, profileId: HockeyProfileId): T {
  const profile = findHockeyRulesProfile(profileId)
  if (!profile) return settings
  return { ...settings, baseProfile: { profileId, profileVersion: profile.version }, ruleOverrides: {} }
}

export function hockeySettingsFingerprint(settings: HockeySettingsV1 | HockeyTeamSettingsV1): string {
  return stableJson(settings)
}

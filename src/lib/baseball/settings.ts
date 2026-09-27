import { isPlainObject } from '../gameEvents/envelope'
import { stableJson } from '../gameEvents/stream'
import { createBaseballMatchRules, DEFAULT_BASEBALL_PROFILE_ID, findBaseballRulesProfile } from './profiles'
import { normalizeBaseballMatchRules } from './rules'
import type { BaseballBattingOrderFormat, BaseballMatchRules, BaseballProfileId, BaseballRunRule } from './types'

export const BASEBALL_SETTINGS_SCHEMA_VERSION = 1
export const BASEBALL_MAX_DEFAULT_BATTING_ORDER = 30

/** Rules a team may change without choosing the Custom profile; everything else is set per game. */
export const BASEBALL_TEAM_RULE_OVERRIDE_FIELDS = [
  'scheduledInnings',
  'battingOrderFormat',
  'maxExtraHitters',
  'runRules',
  'pitchCountLimit',
] as const

export type BaseballTeamRuleOverrideField = (typeof BASEBALL_TEAM_RULE_OVERRIDE_FIELDS)[number]

export type BaseballTeamRuleOverrides = Partial<{
  scheduledInnings: number
  battingOrderFormat: BaseballBattingOrderFormat
  maxExtraHitters: number
  runRules: BaseballRunRule[]
  pitchCountLimit: number | null
}>

/** Stable player ids (not match participants). Missing entries mean "not in the default lineup". */
export interface BaseballLineupDefaults {
  version: 1
  battingOrder: string[]
  /** Fielding number ('1'..'10') -> player id. */
  defense: Record<string, string>
}

export interface BaseballTeamSettingsV1 {
  settingsSchemaVersion: typeof BASEBALL_SETTINGS_SCHEMA_VERSION
  baseProfile: { profileId: BaseballProfileId; profileVersion: 1 }
  ruleOverrides: BaseballTeamRuleOverrides
  lineupDefaults: BaseballLineupDefaults
}

export type BaseballSettingsParseResult =
  | { ok: true; value: BaseballTeamSettingsV1 }
  | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELDING_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

export function emptyBaseballLineupDefaults(): BaseballLineupDefaults {
  return { version: 1, battingOrder: [], defense: {} }
}

export function defaultBaseballTeamSettings(): BaseballTeamSettingsV1 {
  return {
    settingsSchemaVersion: BASEBALL_SETTINGS_SCHEMA_VERSION,
    baseProfile: { profileId: DEFAULT_BASEBALL_PROFILE_ID, profileVersion: 1 },
    ruleOverrides: {},
    lineupDefaults: emptyBaseballLineupDefaults(),
  }
}

/**
 * Exact parser for team settings. `null`/`undefined` mean nothing is saved and resolve
 * to defaults; anything malformed fails closed. Ids are lower-cased so equal defaults
 * compare equal.
 */
export function parseBaseballTeamSettings(value: unknown): BaseballSettingsParseResult {
  if (value === null || value === undefined) return { ok: true, value: defaultBaseballTeamSettings() }
  if (!isPlainObject(value) || !exactKeys(value, ['settingsSchemaVersion', 'baseProfile', 'ruleOverrides', 'lineupDefaults'])) {
    return { ok: false, error: 'Baseball settings contain unknown or missing fields.' }
  }
  if (value.settingsSchemaVersion !== BASEBALL_SETTINGS_SCHEMA_VERSION) {
    return { ok: false, error: 'Baseball settings use an unsupported version.' }
  }
  const base = value.baseProfile
  if (
    !isPlainObject(base) ||
    !exactKeys(base, ['profileId', 'profileVersion']) ||
    typeof base.profileId !== 'string' ||
    !findBaseballRulesProfile(base.profileId) ||
    base.profileVersion !== 1
  ) return { ok: false, error: 'Baseball settings name an unknown rules profile.' }
  const overrides = parseRuleOverrides(value.ruleOverrides)
  if (!overrides) return { ok: false, error: 'Baseball rule overrides are invalid.' }
  const lineup = parseBaseballLineupDefaults(value.lineupDefaults)
  if (!lineup) return { ok: false, error: 'Baseball default lineup is invalid.' }
  const settings: BaseballTeamSettingsV1 = {
    settingsSchemaVersion: BASEBALL_SETTINGS_SCHEMA_VERSION,
    baseProfile: { profileId: base.profileId as BaseballProfileId, profileVersion: 1 },
    ruleOverrides: overrides,
    lineupDefaults: lineup,
  }
  const resolved = resolveBaseballTeamRules(settings)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  return { ok: true, value: settings }
}

export function parseBaseballLineupDefaults(value: unknown): BaseballLineupDefaults | null {
  if (!isPlainObject(value) || !exactKeys(value, ['version', 'battingOrder', 'defense']) || value.version !== 1) return null
  if (!Array.isArray(value.battingOrder) || value.battingOrder.length > BASEBALL_MAX_DEFAULT_BATTING_ORDER) return null
  const battingOrder: string[] = []
  for (const id of value.battingOrder) {
    const normalized = normalizeId(id)
    if (!normalized || battingOrder.includes(normalized)) return null
    battingOrder.push(normalized)
  }
  if (!isPlainObject(value.defense)) return null
  const defense: Record<string, string> = {}
  const fielders = new Set<string>()
  for (const [key, id] of Object.entries(value.defense)) {
    const normalized = normalizeId(id)
    if (!FIELDING_KEYS.includes(key) || !normalized || fielders.has(normalized)) return null
    fielders.add(normalized)
    defense[key] = normalized
  }
  return { version: 1, battingOrder, defense: sortDefense(defense) }
}

/** Effective team rules: the profile layered with the team overrides, checked exactly. */
export function resolveBaseballTeamRules(
  settings: Pick<BaseballTeamSettingsV1, 'baseProfile' | 'ruleOverrides'>
): { ok: true; rules: BaseballMatchRules } | { ok: false; error: string } {
  const rules = createBaseballMatchRules(settings.baseProfile.profileId, settings.ruleOverrides)
  // A placed extra-inning runner starts after regulation, so it follows a changed length.
  if (rules.placedRunnerBase !== null && rules.placedRunnerFromInning !== null &&
      rules.placedRunnerFromInning <= rules.scheduledInnings) {
    rules.placedRunnerFromInning = rules.scheduledInnings + 1
  }
  const normalized = normalizeBaseballMatchRules(rules)
  return normalized
    ? { ok: true, rules: normalized }
    : { ok: false, error: 'The team rule overrides do not form valid rules for this profile.' }
}

/** Player ids in the default lineup that are no longer active on the roster. */
export function staleBaseballLineupPlayerIds(
  lineup: BaseballLineupDefaults,
  activePlayerIds: ReadonlySet<string>
): string[] {
  const ids = [...lineup.battingOrder, ...Object.values(lineup.defense)]
  return [...new Set(ids)].filter(id => !activePlayerIds.has(id))
}

/** Removes players who are not active; used only by an explicit editor action. */
export function pruneBaseballLineupDefaults(
  lineup: BaseballLineupDefaults,
  activePlayerIds: ReadonlySet<string>
): BaseballLineupDefaults {
  return {
    version: 1,
    battingOrder: lineup.battingOrder.filter(id => activePlayerIds.has(id)),
    defense: Object.fromEntries(Object.entries(lineup.defense).filter(([, id]) => activePlayerIds.has(id))),
  }
}

export function baseballTeamSettingsFingerprint(settings: BaseballTeamSettingsV1): string {
  return stableJson(settings)
}

function parseRuleOverrides(value: unknown): BaseballTeamRuleOverrides | null {
  if (!isPlainObject(value)) return null
  const result: BaseballTeamRuleOverrides = {}
  for (const [key, entry] of Object.entries(value)) {
    switch (key as BaseballTeamRuleOverrideField) {
      case 'scheduledInnings':
        if (!isInt(entry, 1, 15)) return null
        result.scheduledInnings = entry
        break
      case 'battingOrderFormat':
        if (!['standard', 'designated_hitter', 'extra_hitter', 'continuous'].includes(entry as string)) return null
        result.battingOrderFormat = entry as BaseballBattingOrderFormat
        break
      case 'maxExtraHitters':
        if (!isInt(entry, 0, 5)) return null
        result.maxExtraHitters = entry
        break
      case 'runRules':
        if (!Array.isArray(entry) || entry.length > 5 || !entry.every(isRunRule)) return null
        result.runRules = entry.map(rule => ({ afterInning: rule.afterInning, lead: rule.lead }))
        break
      case 'pitchCountLimit':
        if (entry !== null && !isInt(entry, 1, 500)) return null
        result.pitchCountLimit = entry as number | null
        break
      default:
        return null
    }
  }
  return result
}

function isRunRule(value: unknown): value is BaseballRunRule {
  return isPlainObject(value) && exactKeys(value, ['afterInning', 'lead']) &&
    isInt(value.afterInning, 1, 15) && isInt(value.lead, 1, 100)
}

function sortDefense(defense: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(defense).sort(([left], [right]) => Number(left) - Number(right)))
}

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function isInt(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

import { isPlainObject } from '../gameEvents/envelope'
import {
  getBasketballRulesProfile,
  normalizeBasketballRuleOverrides,
  resolveBasketballRules,
  type BasketballRulesResolutionResult,
  type BasketballRulesProfileRef,
} from './profiles'
import { BASKETBALL_RULE_FIELDS } from './profileDiffPresentation'
import type { BasketballRuleOverrides, BasketballRulesField } from './types'

export const BASKETBALL_SETTINGS_SCHEMA_VERSION = 1

export interface BasketballCapturePreferences {
  reboundPromptAfterMiss: boolean
}

export interface BasketballDisplayPreferences {
  defaultCourtFlipped: boolean
}

export interface BasketballPersonalSettingsV1 {
  baseProfile: BasketballRulesProfileRef
  ruleOverrides: BasketballRuleOverrides
  capture: BasketballCapturePreferences
  display: BasketballDisplayPreferences
}

export interface BasketballTeamSettingsV1 {
  baseProfile: BasketballRulesProfileRef
  ruleOverrides: BasketballRuleOverrides
}

export type BasketballSettingsParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export const DEFAULT_BASKETBALL_PROFILE: BasketballRulesProfileRef = {
  profileId: 'nfhs',
  profileVersion: 1,
}

export const DEFAULT_BASKETBALL_PERSONAL_SETTINGS: BasketballPersonalSettingsV1 = {
  baseProfile: DEFAULT_BASKETBALL_PROFILE,
  ruleOverrides: {},
  capture: { reboundPromptAfterMiss: false },
  display: { defaultCourtFlipped: false },
}

export const DEFAULT_BASKETBALL_TEAM_SETTINGS: BasketballTeamSettingsV1 = {
  baseProfile: DEFAULT_BASKETBALL_PROFILE,
  ruleOverrides: {},
}

export type BasketballSettingsAuthority = 'personal' | 'team'

export function resolveBasketballSettingsHierarchy({
  authority,
  personalSettings,
  teamSettings,
  matchOverrides = {},
}: {
  authority: BasketballSettingsAuthority
  personalSettings?: unknown
  teamSettings?: unknown
  matchOverrides?: unknown
}): BasketballRulesResolutionResult {
  const authoritative = authority === 'personal'
    ? parseBasketballPersonalSettings(personalSettings)
    : parseBasketballTeamSettings(teamSettings)
  if (!authoritative.ok) {
    return {
      ok: false,
      layer: authority,
      message: `${authority === 'personal' ? 'Personal' : 'Team'} Basketball settings are invalid: ${authoritative.error}`,
    }
  }
  const normalizedMatchOverrides = normalizeBasketballRuleOverrides(matchOverrides)
  if (!normalizedMatchOverrides) {
    return {
      ok: false,
      layer: 'match',
      message: 'Basketball match rule overrides contain unsupported fields.',
    }
  }
  return resolveBasketballRules(authoritative.value.baseProfile, [
    { id: authority, overrides: authoritative.value.ruleOverrides },
    { id: 'match', overrides: normalizedMatchOverrides },
  ])
}

export function parseBasketballPersonalSettings(
  value: unknown
): BasketballSettingsParseResult<BasketballPersonalSettingsV1> {
  if (!hasExactKeys(value, ['baseProfile', 'ruleOverrides', 'capture', 'display'])) {
    return invalid(
      'Personal Basketball settings must contain only baseProfile, ruleOverrides, capture, and display.'
    )
  }
  const rules = parseRuleLayer(value.baseProfile, value.ruleOverrides, 'personal')
  if (!rules.ok) return rules
  if (!hasExactKeys(value.capture, ['reboundPromptAfterMiss'])) {
    return invalid('Basketball capture settings must contain only reboundPromptAfterMiss.')
  }
  if (typeof value.capture.reboundPromptAfterMiss !== 'boolean') {
    return invalid('Basketball reboundPromptAfterMiss must be boolean.')
  }
  if (!hasExactKeys(value.display, ['defaultCourtFlipped'])) {
    return invalid('Basketball display settings must contain only defaultCourtFlipped.')
  }
  if (typeof value.display.defaultCourtFlipped !== 'boolean') {
    return invalid('Basketball defaultCourtFlipped must be boolean.')
  }
  return {
    ok: true,
    value: {
      ...rules.value,
      capture: { reboundPromptAfterMiss: value.capture.reboundPromptAfterMiss },
      display: { defaultCourtFlipped: value.display.defaultCourtFlipped },
    },
  }
}

export function parseBasketballTeamSettings(
  value: unknown
): BasketballSettingsParseResult<BasketballTeamSettingsV1> {
  if (!hasExactKeys(value, ['baseProfile', 'ruleOverrides'])) {
    return invalid('Team Basketball settings must contain only baseProfile and ruleOverrides.')
  }
  return parseRuleLayer(value.baseProfile, value.ruleOverrides, 'team')
}

function parseRuleLayer(
  baseProfile: unknown,
  ruleOverrides: unknown,
  layer: 'personal' | 'team'
): BasketballSettingsParseResult<BasketballTeamSettingsV1> {
  if (!hasExactKeys(baseProfile, ['profileId', 'profileVersion'])) {
    return invalid('Basketball baseProfile must contain only profileId and profileVersion.')
  }
  if (typeof baseProfile.profileId !== 'string' || !Number.isInteger(baseProfile.profileVersion)) {
    return invalid('Basketball baseProfile is invalid.')
  }
  const profile = getBasketballRulesProfile(baseProfile.profileId, Number(baseProfile.profileVersion))
  if (!profile) return invalid('Basketball rules profile is unavailable.')

  if (hasIncompleteClockLineupBundle(ruleOverrides)) {
    return invalid('Basketball clock and lineup rule overrides must be saved together.')
  }
  const overrides = normalizeBasketballRuleOverrides(ruleOverrides)
  if (!overrides) return invalid('Basketball rule overrides contain unsupported fields.')
  const structuralFields = [
    'regulationSegments',
    'overtimeTemplate',
    'foulWindows',
    'timeoutPools',
  ] as const
  const structuralCount = structuralFields.filter(field => field in overrides).length
  if (structuralCount !== 0 && structuralCount !== structuralFields.length) {
    return invalid('Basketball structural rule overrides must be saved together.')
  }
  const resolution = resolveBasketballRules(
    { profileId: profile.profileId, profileVersion: profile.profileVersion },
    [{ id: layer, overrides }]
  )
  if (!resolution.ok) return invalid(resolution.message)

  return {
    ok: true,
    value: {
      baseProfile: {
        profileId: profile.profileId,
        profileVersion: profile.profileVersion,
      },
      ruleOverrides: structuredClone(overrides),
    },
  }
}

function hasIncompleteClockLineupBundle(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.some(key => !BASKETBALL_RULE_FIELDS.includes(key as BasketballRulesField))) return false
  const v3OnlyFields = [
    'clockDisplayDirection',
    'clockExpiration',
    'stoppageMode',
    'equalPlayPolicy',
  ] as const
  const v3OnlyCount = v3OnlyFields.filter(field => field in value).length
  return v3OnlyCount !== 0 && (v3OnlyCount !== v3OnlyFields.length || !('clockModel' in value))
}

function hasExactKeys<T extends string>(
  value: unknown,
  keys: readonly T[]
): value is Record<T, unknown> {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => key in value)
}

function invalid<T>(error: string): BasketballSettingsParseResult<T> {
  return { ok: false, error }
}

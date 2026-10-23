import { describe, expect, it } from 'vitest'
import { baseballRulesProfiles } from './profiles'
import { defaultBaseballPersonalSettings, defaultBaseballTeamSettings, parseBaseballPersonalSettings, resolveBaseballSettingsHierarchy } from './settings'

describe('Baseball personal settings contract', () => {
  it('defaults only missing local settings, with no lineup or capture preferences', () => {
    const defaults = defaultBaseballPersonalSettings()
    expect(Object.keys(defaults).sort()).toEqual(['baseProfile', 'ruleOverrides', 'settingsSchemaVersion'])
    expect(parseBaseballPersonalSettings(null)).toEqual({ ok: true, value: defaults })
    expect(parseBaseballPersonalSettings(undefined)).toEqual({ ok: true, value: defaults })
    defaults.ruleOverrides.scheduledInnings = 3
    expect(defaultBaseballPersonalSettings().ruleOverrides).toEqual({})
  })
  it.each(baseballRulesProfiles())('resolves immutable profile $id and all five permitted overrides', profile => {
    const value = { ...defaultBaseballPersonalSettings(), baseProfile: { profileId: profile.id, profileVersion: 1 },
      ruleOverrides: { scheduledInnings: 15, battingOrderFormat: 'extra_hitter', maxExtraHitters: 5, runRules: [{ afterInning: 15, lead: 100 }], pitchCountLimit: 500 } }
    expect(parseBaseballPersonalSettings(value).ok).toBe(true)
    const resolved = resolveBaseballSettingsHierarchy({ authority: 'personal', personalSettings: value })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.rules.variant).toBe(profile.rules.variant)
    expect(resolved.rules.scheduledInnings).toBe(15)
    if (resolved.rules.placedRunnerBase) expect(resolved.rules.placedRunnerFromInning).toBe(16)
    expect(profile.rules.scheduledInnings).not.toBe(15)
  })
  it.each([
    [], {}, { ...defaultBaseballPersonalSettings(), extra: true },
    { ...defaultBaseballPersonalSettings(), lineupDefaults: defaultBaseballTeamSettings().lineupDefaults },
    { ...defaultBaseballPersonalSettings(), settingsSchemaVersion: 2 },
    { ...defaultBaseballPersonalSettings(), baseProfile: { profileId: 'mlb', profileVersion: 2 } },
    { ...defaultBaseballPersonalSettings(), baseProfile: { profileId: 'unknown', profileVersion: 1 } },
    { ...defaultBaseballPersonalSettings(), baseProfile: { profileId: 'mlb', profileVersion: 1, extra: true } },
    ...[{ scheduledInnings: 0 }, { scheduledInnings: 16 }, { scheduledInnings: 1.5 }, { scheduledInnings: '7' },
      { battingOrderFormat: 'random' }, { maxExtraHitters: -1 }, { maxExtraHitters: 6 }, { pitchCountLimit: 0 },
      { pitchCountLimit: 501 }, { runRules: [{ afterInning: 0, lead: 10 }] },
      { runRules: [{ afterInning: 4, lead: 10, extra: true }] }, { stealing: false }, { trackPitchLocation: true },
    ].map(ruleOverrides => ({ ...defaultBaseballPersonalSettings(), ruleOverrides })),
  ])('fails closed for malformed or out-of-scope payload %j', value => {
    expect(parseBaseballPersonalSettings(value).ok).toBe(false)
  })
  it('keeps team missing/default authority separate and respects explicit match overrides', () => {
    const personalSettings = { ...defaultBaseballPersonalSettings(), ruleOverrides: { scheduledInnings: 3 } }
    const personal = resolveBaseballSettingsHierarchy({ authority: 'personal', personalSettings, matchOverrides: { scheduledInnings: 4 } })
    expect(personal.ok && personal.rules.scheduledInnings).toBe(4)
    const team = resolveBaseballSettingsHierarchy({ authority: 'team', personalSettings, teamSettings: null })
    expect(team.ok && team.rules.scheduledInnings).toBe(7)
    expect(resolveBaseballSettingsHierarchy({ authority: 'team', personalSettings, teamSettings: { unreadable: true } }).ok).toBe(false)
    expect(resolveBaseballSettingsHierarchy({ authority: 'personal', personalSettings, matchOverrides: { scheduledInnings: 0 } }).ok).toBe(false)
  })
  it('clone-isolates parsed nested overrides', () => {
    const value = { ...defaultBaseballPersonalSettings(), ruleOverrides: { runRules: [{ afterInning: 3, lead: 10 }] } }
    const parsed = parseBaseballPersonalSettings(value)
    if (!parsed.ok) throw Error(parsed.error)
    parsed.value.ruleOverrides.runRules![0].lead = 20
    expect(value.ruleOverrides.runRules[0].lead).toBe(10)
  })
})

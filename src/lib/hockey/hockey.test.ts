import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOCKEY_PROFILE_ID,
  createHockeyMatchRules,
  findHockeyRulesProfile,
  hockeyRulesProfiles,
} from './profiles'
import { HOCKEY_RULES_FIELDS, normalizeHockeyMatchRules, validateHockeyMatchRules } from './rules'
import {
  defaultHockeySettings,
  parseHockeySettings,
  resolveHockeySettingsHierarchy,
} from './settings'
import type { HockeyMatchRules, HockeySettingsV1 } from './types'

const MINUTE_MS = 60_000

function settings(overrides: HockeySettingsV1['ruleOverrides'] = {}, profileId = 'usa_hockey_youth'): HockeySettingsV1 {
  return {
    settingsSchemaVersion: 1,
    baseProfile: { profileId: profileId as HockeySettingsV1['baseProfile']['profileId'], profileVersion: 1 },
    ruleOverrides: overrides,
  }
}

describe('hockey rule profiles', () => {
  it('ships valid, frozen profiles with youth as the default', () => {
    const profiles = hockeyRulesProfiles()
    expect(profiles.map(profile => profile.id)).toEqual([
      'usa_hockey_youth',
      'recreational',
      'high_school_us',
      'ncaa',
      'nhl_regular',
      'nhl_playoffs',
      'custom',
    ])
    for (const profile of profiles) {
      expect(validateHockeyMatchRules(profile.rules)).toBeNull()
      expect(profile.rules.profileId).toBe(profile.id)
      expect(Object.isFrozen(profile.rules.regulation)).toBe(true)
    }
    expect(DEFAULT_HOCKEY_PROFILE_ID).toBe('usa_hockey_youth')
  })

  it('uses an anchored clock by default and distinct overtime policies', () => {
    const youth = findHockeyRulesProfile('usa_hockey_youth')!.rules
    expect(youth.clockModel).toBe('anchored')
    expect(youth.tiesAllowed).toBe(true)
    expect(youth.overtime).toBeNull()
    const nhl = findHockeyRulesProfile('nhl_regular')!.rules
    expect(nhl.overtime).toMatchObject({ skaters: 3, repeat: false })
    expect(nhl.shootout).toEqual({ rounds: 3, repeatShooters: 'after_all' })
    expect(findHockeyRulesProfile('nhl_playoffs')!.rules.overtime).toMatchObject({ repeat: true, skaters: 5 })
    expect(findHockeyRulesProfile('recreational')!.rules.clock).toEqual({ display: 'count_down', mode: 'running' })
  })

  it('returns mutable clones that never alias the catalog', () => {
    const rules = createHockeyMatchRules('nhl_regular', { trapezoid: false })
    rules.regulation.periods = 2
    expect(rules.trapezoid).toBe(false)
    expect(findHockeyRulesProfile('nhl_regular')!.rules.regulation.periods).toBe(3)
    expect(findHockeyRulesProfile('nhl_regular', 2)).toBeNull()
  })
})

describe('hockey rules parser', () => {
  const valid = (): HockeyMatchRules => createHockeyMatchRules()

  it('round-trips valid rules as a clone', () => {
    const rules = valid()
    const parsed = normalizeHockeyMatchRules(JSON.parse(JSON.stringify(rules)))
    expect(parsed).toEqual(rules)
    expect(parsed).not.toBe(rules)
  })

  it('rejects unknown, missing, and out-of-range fields', () => {
    expect(normalizeHockeyMatchRules({ ...valid(), extra: true })).toBeNull()
    const missing: Record<string, unknown> = { ...valid() }
    delete missing.trapezoid
    expect(normalizeHockeyMatchRules(missing)).toBeNull()
    expect(normalizeHockeyMatchRules({ ...valid(), rulesSchemaVersion: 2 })).toBeNull()
    expect(normalizeHockeyMatchRules({ ...valid(), profileId: 'khl' })).toBeNull()
    expect(normalizeHockeyMatchRules({ ...valid(), skatersPerSide: 7 })).toBeNull()
    expect(normalizeHockeyMatchRules({ ...valid(), minimumSkaters: 6 })).toBeNull()
    expect(normalizeHockeyMatchRules({
      ...valid(),
      regulation: { periods: 3, periodLengthMs: 15 * MINUTE_MS + 500 },
    })).toBeNull()
    expect(normalizeHockeyMatchRules({
      ...valid(),
      penalties: { ...valid().penalties, doubleMinorMs: 60_000 },
    })).toBeNull()
  })

  it('requires the clock model and clock settings to agree', () => {
    expect(normalizeHockeyMatchRules({ ...valid(), clockModel: 'none', clock: null })).not.toBeNull()
    expect(normalizeHockeyMatchRules({ ...valid(), clockModel: 'none' })).toBeNull()
    expect(normalizeHockeyMatchRules({ ...valid(), clockModel: 'anchored', clock: null })).toBeNull()
    expect(normalizeHockeyMatchRules({ ...valid(), clockModel: 'manual' })).toBeNull()
    expect(normalizeHockeyMatchRules({
      ...valid(),
      clock: { display: 'count_down', mode: 'stop_time', tenths: true },
    })).toBeNull()
  })

  it('requires a decider when ties are not allowed', () => {
    const nhl = createHockeyMatchRules('nhl_regular')
    expect(validateHockeyMatchRules({ ...nhl, shootout: null })).toMatch(/shootout or repeating overtime/)
    expect(validateHockeyMatchRules({ ...nhl, overtime: null })).toBeNull()
    expect(validateHockeyMatchRules(createHockeyMatchRules('nhl_playoffs'))).toBeNull()
  })

  it('bounds overtime skaters by skaters per side and checks the ends policy', () => {
    const nhl = createHockeyMatchRules('nhl_regular')
    expect(validateHockeyMatchRules({ ...nhl, overtime: { ...nhl.overtime!, skaters: 6 } })).not.toBeNull()
    expect(validateHockeyMatchRules({
      ...nhl,
      overtime: { ...nhl.overtime!, endsPolicy: 'same_as_last_regulation' },
    })).toBeNull()
    expect(validateHockeyMatchRules({ ...nhl, overtime: { ...nhl.overtime!, endsPolicy: 'swap' } })).not.toBeNull()
  })
})

describe('hockey settings', () => {
  it('treats missing settings as defaults and rejects malformed settings', () => {
    expect(parseHockeySettings(undefined)).toEqual({ ok: true, value: defaultHockeySettings() })
    expect(parseHockeySettings(settings({ trapezoid: true }, 'ncaa')).ok).toBe(true)
    expect(parseHockeySettings({ ...settings(), extra: 1 }).ok).toBe(false)
    expect(parseHockeySettings(settings({}, 'khl')).ok).toBe(false)
    expect(parseHockeySettings({ ...settings(), baseProfile: { profileId: 'ncaa', profileVersion: 9 } }).ok).toBe(false)
    expect(parseHockeySettings(settings({ profileId: 'ncaa' } as never)).ok).toBe(false)
  })

  it('validates saved override values against the base profile', () => {
    const invalid: unknown[] = [
      { skatersPerSide: 99 },
      { clockModel: 'none' },
      { clock: null },
      { regulation: { periods: 0, periodLengthMs: 'bad', unexpected: true } },
      { regulation: { periods: 3, periodLengthMs: 15 * MINUTE_MS, unexpected: true } },
      { penalties: { ...createHockeyMatchRules().penalties, minorMs: '2' } },
      { tiesAllowed: false },
      { overtime: { lengthMs: 5 * MINUTE_MS, skaters: 3, repeat: false } },
    ]
    for (const ruleOverrides of invalid) {
      const result = parseHockeySettings({ ...defaultHockeySettings(), ruleOverrides })
      expect(result.ok, JSON.stringify(ruleOverrides)).toBe(false)
    }
    expect(parseHockeySettings({ ...defaultHockeySettings(), ruleOverrides: null }).ok).toBe(false)
    // A ruleset only valid on another base fails on this one.
    expect(parseHockeySettings(settings({ shootout: null }, 'nhl_regular')).ok).toBe(false)
    expect(parseHockeySettings(settings({ shootout: null }, 'usa_hockey_youth')).ok).toBe(true)
  })

  it('accepts a consistent clockless override pair and returns a clone', () => {
    const input = settings({ clockModel: 'none', clock: null })
    const result = parseHockeySettings(input)
    expect(result).toEqual({ ok: true, value: input })
    if (result.ok) expect(result.value.ruleOverrides).not.toBe(input.ruleOverrides)
  })

  it('resolves a personal game as built-in -> personal -> match with sources', () => {
    const result = resolveHockeySettingsHierarchy({
      authority: 'personal',
      personalSettings: settings({ regulation: { periods: 3, periodLengthMs: 12 * MINUTE_MS } }),
      matchOverrides: { trapezoid: true },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.rules.regulation.periodLengthMs).toBe(12 * MINUTE_MS)
    expect(result.value.rules.trapezoid).toBe(true)
    expect(result.value.sourceByField.regulation).toBe('personal')
    expect(result.value.sourceByField.trapezoid).toBe('match')
    expect(result.value.sourceByField.penalties).toBe('built_in')
    expect(result.value.customized).toBe(true)
    expect(validateHockeyMatchRules(result.value.rules)).toBeNull()
  })

  it('never lets a recorder personal defaults reach a team game', () => {
    const team = settings({ regulation: { periods: 3, periodLengthMs: 13 * MINUTE_MS } }, 'high_school_us')
    const recorderA = settings({ clockModel: 'none', clock: null })
    const recorderB = settings({ regulation: { periods: 2, periodLengthMs: 25 * MINUTE_MS } }, 'recreational')
    const a = resolveHockeySettingsHierarchy({ authority: 'team', teamSettings: team, personalSettings: recorderA })
    const b = resolveHockeySettingsHierarchy({ authority: 'team', teamSettings: team, personalSettings: recorderB })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.value.rules).toEqual(b.value.rules)
    expect(a.value.rules.profileId).toBe('high_school_us')
    expect(a.value.rules.clockModel).toBe('anchored')
    expect(a.value.sourceByField.regulation).toBe('team')
    expect(Object.values(a.value.sourceByField)).not.toContain('personal')
  })

  it('reports the layer that produced an invalid combination', () => {
    const team = resolveHockeySettingsHierarchy({
      authority: 'team',
      teamSettings: settings({ clockModel: 'none' }),
    })
    expect(team).toMatchObject({ ok: false, layer: 'team' })
    const match = resolveHockeySettingsHierarchy({
      authority: 'personal',
      matchOverrides: { clockModel: 'none', clock: null, skatersPerSide: 2 },
    })
    expect(match).toMatchObject({ ok: false, layer: 'match' })
    expect(resolveHockeySettingsHierarchy({
      authority: 'personal',
      matchOverrides: { rulesSchemaVersion: 2 },
    })).toMatchObject({ ok: false, layer: 'match' })
    expect(resolveHockeySettingsHierarchy({ authority: 'team', teamSettings: 'bad' }))
      .toMatchObject({ ok: false, layer: 'team' })
  })

  it('selects a clockless game only through an explicit, consistent override', () => {
    const result = resolveHockeySettingsHierarchy({
      authority: 'personal',
      matchOverrides: { clockModel: 'none', clock: null },
    })
    expect(result.ok && result.value.rules.clockModel).toBe('none')
    expect(result.ok && result.value.rules.clock).toBeNull()
  })

  it('does not mutate inputs or the profile catalog', () => {
    const input = settings({ penalties: { ...createHockeyMatchRules().penalties, minorMs: 90_000 } })
    const snapshot = structuredClone(input)
    const result = resolveHockeySettingsHierarchy({ authority: 'personal', personalSettings: input })
    expect(result.ok).toBe(true)
    if (result.ok) result.value.rules.penalties.minorMs = 1
    expect(input).toEqual(snapshot)
    expect(findHockeyRulesProfile(DEFAULT_HOCKEY_PROFILE_ID)!.rules.penalties.minorMs).toBe(120_000)
  })

  it('lists every overridable rule field', () => {
    expect([...HOCKEY_RULES_FIELDS].sort()).toEqual(
      Object.keys(createHockeyMatchRules())
        .filter(key => !['rulesSchemaVersion', 'profileId', 'profileVersion'].includes(key))
        .sort()
    )
  })
})

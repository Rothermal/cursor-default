import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { baseballRulesProfiles } from './profiles'
import { defaultBaseballPersonalSettings, parseBaseballPersonalSettings } from './settings'

it('builds exact client-validated payloads for the disposable SQL parity harness', () => {
  const overrides: unknown[] = [{}, { scheduledInnings: 1 }, { scheduledInnings: 15 },
    { battingOrderFormat: 'standard' }, { battingOrderFormat: 'designated_hitter' }, { battingOrderFormat: 'continuous' },
    { battingOrderFormat: 'extra_hitter', maxExtraHitters: 5 }, { pitchCountLimit: null }, { pitchCountLimit: 1 },
    { pitchCountLimit: 500 }, { runRules: [] }, { runRules: [{ afterInning: 15, lead: 100 }] },
    { scheduledInnings: 0 }, { scheduledInnings: 16 }, { scheduledInnings: 1.5 }, { scheduledInnings: '7' },
    { maxExtraHitters: -1 }, { maxExtraHitters: 6 }, { pitchCountLimit: 0 }, { pitchCountLimit: 501 },
    { battingOrderFormat: 'unknown' }, { stealing: true }, { trackPitchLocation: false },
    { runRules: [{ afterInning: 0, lead: 10 }] }, { runRules: [{ afterInning: 3, lead: 0 }] },
    { runRules: [{ afterInning: 3, lead: 10, extra: true }] },
  ]
  const values: unknown[] = baseballRulesProfiles().flatMap(profile => overrides.map(ruleOverrides => ({
    settingsSchemaVersion: 1, baseProfile: { profileId: profile.id, profileVersion: 1 }, ruleOverrides,
  })))
  values.push(null, [], {}, { ...defaultBaseballPersonalSettings(), extra: true },
    { ...defaultBaseballPersonalSettings(), lineupDefaults: {} },
    { ...defaultBaseballPersonalSettings(), baseProfile: { profileId: 'mlb', profileVersion: 2 } },
    { ...defaultBaseballPersonalSettings(), baseProfile: { profileId: 'unknown', profileVersion: 1 } })
  const cases = values.map(value => ({ value, accepted: value !== null && parseBaseballPersonalSettings(value).ok }))
  expect(cases).toHaveLength(189)
  expect(cases.filter(value => value.accepted)).toHaveLength(84)
  if (process.env.BSB7C_CASES_OUT) writeFileSync(process.env.BSB7C_CASES_OUT, JSON.stringify(cases))
})

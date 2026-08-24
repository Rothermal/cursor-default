import { describe, expect, it } from 'vitest'
import {
  BASKETBALL_SETTINGS_SCHEMA_VERSION,
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  parseBasketballPersonalSettings,
  parseBasketballTeamSettings,
} from './settings'

describe('Basketball settings schema version 1', () => {
  it('accepts exact personal and team layers and clones their values', () => {
    expect(BASKETBALL_SETTINGS_SCHEMA_VERSION).toBe(1)
    const personal = parseBasketballPersonalSettings(DEFAULT_BASKETBALL_PERSONAL_SETTINGS)
    expect(personal).toEqual({ ok: true, value: DEFAULT_BASKETBALL_PERSONAL_SETTINGS })
    if (!personal.ok) throw new Error(personal.error)
    expect(personal.value).not.toBe(DEFAULT_BASKETBALL_PERSONAL_SETTINGS)

    expect(parseBasketballTeamSettings({
      baseProfile: { profileId: 'youth_equal_play', profileVersion: 1 },
      ruleOverrides: { personalFoulLimit: 6 },
    })).toMatchObject({
      ok: true,
      value: { baseProfile: { profileId: 'youth_equal_play', profileVersion: 1 } },
    })
  })

  it('rejects unknown, missing, or unsupported settings fields', () => {
    expect(parseBasketballPersonalSettings({
      ...DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
      extra: true,
    })).toMatchObject({ ok: false })
    expect(parseBasketballPersonalSettings({
      baseProfile: DEFAULT_BASKETBALL_PERSONAL_SETTINGS.baseProfile,
      ruleOverrides: {},
      capture: {},
      display: { defaultCourtFlipped: false },
    })).toMatchObject({ ok: false })
    expect(parseBasketballTeamSettings({
      baseProfile: { profileId: 'nfhs', profileVersion: 99 },
      ruleOverrides: {},
    })).toMatchObject({ ok: false })
    expect(parseBasketballTeamSettings({
      baseProfile: { profileId: 'nfhs', profileVersion: 1 },
      ruleOverrides: { mysteryRule: true },
    })).toMatchObject({ ok: false })
  })

  it('rejects overrides that do not resolve against the selected profile', () => {
    expect(parseBasketballTeamSettings({
      baseProfile: { profileId: 'nfhs', profileVersion: 1 },
      ruleOverrides: { personalFoulLimit: 0 },
    })).toMatchObject({ ok: false })
    expect(parseBasketballTeamSettings({
      baseProfile: { profileId: 'nfhs', profileVersion: 1 },
      ruleOverrides: { clockModel: 'anchored' },
    })).toMatchObject({ ok: false })
    expect(parseBasketballTeamSettings({
      baseProfile: { profileId: 'nfhs', profileVersion: 1 },
      ruleOverrides: {
        regulationSegments: [],
      },
    })).toMatchObject({
      ok: false,
      error: 'Basketball structural rule overrides must be saved together.',
    })
  })
})

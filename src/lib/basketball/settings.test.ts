import { describe, expect, it } from 'vitest'
import { getBasketballRulesProfile } from './profiles'
import {
  BASKETBALL_SETTINGS_SCHEMA_VERSION,
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  DEFAULT_BASKETBALL_TEAM_SETTINGS,
  parseBasketballPersonalSettings,
  parseBasketballTeamSettings,
} from './settings'

describe('Basketball settings schema version 1', () => {
  it('pins the versioned application team default', () => {
    expect(DEFAULT_BASKETBALL_TEAM_SETTINGS).toEqual({
      baseProfile: { profileId: 'nfhs', profileVersion: 1 },
      ruleOverrides: {},
    })
  })

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

  it('matches migration 062 bounds before attempting a cloud save', () => {
    expect(parseBasketballTeamSettings({
      baseProfile: { profileId: 'nfhs', profileVersion: 1 },
      ruleOverrides: { personalFoulLimit: 21 },
    })).toMatchObject({ ok: false })

    const longLabel = structuralOverrides()
    longLabel.regulationSegments[0].label = 'L'.repeat(121)
    expect(parseBasketballTeamSettings(teamLayer(longLabel))).toMatchObject({ ok: false })

    const longFoulWindowLabel = structuralOverrides()
    longFoulWindowLabel.foulWindows[0].label = 'F'.repeat(121)
    expect(parseBasketballTeamSettings(teamLayer(longFoulWindowLabel))).toMatchObject({ ok: false })

    const longTimeoutPoolLabel = structuralOverrides()
    longTimeoutPoolLabel.timeoutPools[0].label = 'T'.repeat(121)
    expect(parseBasketballTeamSettings(teamLayer(longTimeoutPoolLabel))).toMatchObject({ ok: false })

    const longOvertimeLabel = structuralOverrides()
    longOvertimeLabel.overtimeTemplate.label = 'O'.repeat(121)
    expect(parseBasketballTeamSettings(teamLayer(longOvertimeLabel))).toMatchObject({ ok: false })

    const longId = structuralOverrides()
    const oldId = longId.regulationSegments[0].id
    const nextId = `segment-${'x'.repeat(80)}`
    longId.regulationSegments[0].id = nextId
    for (const window of longId.foulWindows) {
      window.segmentIds = window.segmentIds.map(id => id === oldId ? nextId : id)
    }
    for (const pool of longId.timeoutPools) {
      pool.segmentIds = pool.segmentIds.map(id => id === oldId ? nextId : id)
    }
    expect(parseBasketballTeamSettings(teamLayer(longId))).toMatchObject({ ok: false })

    const tooManySegments = structuralOverrides()
    tooManySegments.regulationSegments = Array.from(
      { length: 21 },
      (_, index) => ({
        ...structuredClone(tooManySegments.regulationSegments[0]),
        id: `segment-${index + 1}`,
        order: index + 1,
      })
    )
    expect(parseBasketballTeamSettings(teamLayer(tooManySegments))).toMatchObject({ ok: false })
  })
})

function structuralOverrides() {
  const profile = getBasketballRulesProfile('nfhs', 1)
  if (!profile) throw new Error('NFHS profile fixture is unavailable.')
  return {
    regulationSegments: structuredClone(profile.rules.regulationSegments),
    overtimeTemplate: structuredClone(profile.rules.overtimeTemplate),
    foulWindows: structuredClone(profile.rules.foulWindows),
    timeoutPools: structuredClone(profile.rules.timeoutPools),
  }
}

function teamLayer(ruleOverrides: ReturnType<typeof structuralOverrides>) {
  return {
    baseProfile: { profileId: 'nfhs', profileVersion: 1 },
    ruleOverrides,
  }
}

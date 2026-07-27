import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  parseSoccerPersonalSettings,
  parseSoccerRulesOverride,
  parseSoccerTeamSettings,
  resolveSoccerSettingsHierarchy,
  soccerRulesOverrideFingerprint,
  soccerRulesOverrideFromDifference,
} from './settings'

describe('soccer settings schema', () => {
  it('stores only match fields that differ from inherited rules', () => {
    const inherited = resolveSoccerSettingsHierarchy().rules
    const desired = {
      ...structuredClone(inherited),
      maxOnFieldPlayers: 9,
      allowReturnSubstitutions: true,
    }
    const override = soccerRulesOverrideFromDifference(inherited, desired)

    expect(override).toEqual({
      maxOnFieldPlayers: 9,
      allowReturnSubstitutions: true,
    })
    expect(soccerRulesOverrideFingerprint({
      allowReturnSubstitutions: true,
      maxOnFieldPlayers: 9,
    })).toBe(soccerRulesOverrideFingerprint(override))
  })

  it('ignores json object key order in nested segment comparisons', () => {
    const inherited = resolveSoccerSettingsHierarchy().rules
    const desired = structuredClone(inherited)
    desired.regulationSegments = desired.regulationSegments.map(segment => ({
      durationMs: segment.durationMs,
      order: segment.order,
      kind: segment.kind,
      label: segment.label,
      id: segment.id,
    }))

    expect(soccerRulesOverrideFromDifference(inherited, desired)).toEqual({})
    expect(soccerRulesOverrideFingerprint({
      regulationSegments: inherited.regulationSegments,
    })).toBe(soccerRulesOverrideFingerprint({
      regulationSegments: desired.regulationSegments,
    }))
  })

  it('accepts the complete version-one personal settings profile', () => {
    expect(parseSoccerPersonalSettings(DEFAULT_SOCCER_PERSONAL_SETTINGS)).toEqual({
      ok: true,
      value: DEFAULT_SOCCER_PERSONAL_SETTINGS,
    })
  })

  it('rejects derived legacy availability keys in every configurable layer', () => {
    expect(parseSoccerRulesOverride({
      tieResolution: 'draw_allowed',
      extraTimeAvailable: false,
    })).toEqual({
      ok: false,
      error: 'extraTimeAvailable is derived from tieResolution and cannot be stored.',
    })
    expect(parseSoccerTeamSettings({
      rules: { shootoutAvailable: true },
    })).toEqual({
      ok: false,
      error: 'shootoutAvailable is derived from tieResolution and cannot be stored.',
    })
  })

  it('requires complete personal rules but permits sparse team rules', () => {
    expect(parseSoccerPersonalSettings({
      rules: { maxOnFieldPlayers: 7 },
      display: { fieldFlipped: false },
    })).toMatchObject({ ok: false })
    expect(parseSoccerTeamSettings({
      rules: { maxOnFieldPlayers: 7 },
    })).toEqual({
      ok: true,
      value: { rules: { maxOnFieldPlayers: 7 } },
    })
  })

  it('rejects unknown nested segment fields', () => {
    expect(parseSoccerRulesOverride({
      regulationSegments: [{
        id: 'regulation-1',
        label: 'First Half',
        kind: 'regulation',
        order: 1,
        durationMs: 45 * 60_000,
        hidden: true,
      }],
    })).toEqual({
      ok: false,
      error: 'Every stored match segment must use the exact schema.',
    })
  })

  it('rejects unknown keys at every persisted object boundary', () => {
    expect(parseSoccerPersonalSettings({
      ...DEFAULT_SOCCER_PERSONAL_SETTINGS,
      futureSetting: true,
    })).toMatchObject({ ok: false })
    expect(parseSoccerTeamSettings({
      rules: { unknownRule: true },
    })).toEqual({
      ok: false,
      error: 'Unknown soccer rule: unknownRule.',
    })
  })

  it('rejects duplicate segment identities and incorrect segment kinds', () => {
    const segment = {
      id: 'regulation-1',
      label: 'First Half',
      kind: 'regulation' as const,
      order: 1,
      durationMs: 45 * 60_000,
    }
    expect(parseSoccerRulesOverride({
      regulationSegments: [segment, { ...segment, label: 'Second Half', order: 2 }],
    })).toMatchObject({
      ok: false,
      error: 'Match segment ids must be unique.',
    })
    expect(parseSoccerRulesOverride({
      regulationSegments: [{ ...segment, kind: 'extra_time' }],
    })).toMatchObject({
      ok: false,
      error: 'Stored match segment values are invalid.',
    })
  })

  it('rejects blank or whitespace-only segment labels', () => {
    expect(parseSoccerRulesOverride({
      regulationSegments: [{
        id: 'regulation-1',
        label: '',
        kind: 'regulation',
        order: 1,
        durationMs: 45 * 60_000,
      }],
    })).toEqual({
      ok: false,
      error: 'Stored match segment values are invalid.',
    })
    expect(parseSoccerRulesOverride({
      regulationSegments: [{
        id: 'regulation-1',
        label: '   ',
        kind: 'regulation',
        order: 1,
        durationMs: 45 * 60_000,
      }],
    })).toEqual({
      ok: false,
      error: 'Stored match segment values are invalid.',
    })
  })

  it('rejects integers outside the shared persisted range', () => {
    expect(parseSoccerRulesOverride({
      maxOnFieldPlayers: Number.POSITIVE_INFINITY,
    })).toEqual({
      ok: false,
      error: 'Stored soccer rule maxOnFieldPlayers exceeds the supported integer range.',
    })
    expect(parseSoccerRulesOverride({
      regulationSegments: [{
        id: 'regulation-1',
        label: 'First Half',
        kind: 'regulation',
        order: 1,
        durationMs: 2_147_483_648,
      }],
    })).toMatchObject({ ok: false })
  })
})

describe('soccer settings hierarchy', () => {
  it('resolves personal, team, and match layers with per-field sources', () => {
    const personal = structuredClone(DEFAULT_SOCCER_PERSONAL_SETTINGS.rules)
    personal.clockDirection = 'count_down'
    personal.maxOnFieldPlayers = 9

    const resolved = resolveSoccerSettingsHierarchy({
      personalDefaults: personal,
      teamDefaults: {
        maxOnFieldPlayers: 7,
        tieResolution: 'direct_to_shootout',
      },
      gameOverrides: {
        maxOnFieldPlayers: 6,
      },
    })

    expect(resolved.diagnostics).toEqual([])
    expect(resolved.rules.clockDirection).toBe('count_down')
    expect(resolved.rules.maxOnFieldPlayers).toBe(6)
    expect(resolved.rules.tieResolution).toBe('direct_to_shootout')
    expect(resolved.rules.extraTimeAvailable).toBe(false)
    expect(resolved.rules.shootoutAvailable).toBe(true)
    expect(resolved.sources.clockDirection).toBe('personal')
    expect(resolved.sources.maxOnFieldPlayers).toBe('match')
    expect(resolved.sources.tieResolution).toBe('team')
    expect(resolved.sources.extraTimeAvailable).toBe('team')
    expect(resolved.sources.shootoutAvailable).toBe('team')
  })

  it('rejects an invalid whole layer and continues with later valid layers', () => {
    const resolved = resolveSoccerSettingsHierarchy({
      personalDefaults: {
        ...DEFAULT_SOCCER_PERSONAL_SETTINGS.rules,
        maxOnFieldPlayers: 0,
      },
      teamDefaults: {
        maxOnFieldPlayers: 7,
      },
    })

    expect(resolved.rules.clockDirection).toBe('count_up')
    expect(resolved.rules.maxOnFieldPlayers).toBe(7)
    expect(resolved.sources.clockDirection).toBe('built_in')
    expect(resolved.sources.maxOnFieldPlayers).toBe('team')
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        layer: 'personal',
        code: 'invalid_settings',
      }),
    ])
  })

  it('treats each segment array as one atomic override and source', () => {
    const personal = structuredClone(DEFAULT_SOCCER_PERSONAL_SETTINGS.rules)
    personal.regulationSegments = [
      {
        id: 'regulation-1',
        label: 'Personal Half',
        kind: 'regulation',
        order: 1,
        durationMs: 40 * 60_000,
      },
    ]
    const teamSegments = [
      {
        id: 'regulation-1',
        label: 'Team Quarter 1',
        kind: 'regulation' as const,
        order: 1,
        durationMs: 12 * 60_000,
      },
      {
        id: 'regulation-2',
        label: 'Team Quarter 2',
        kind: 'regulation' as const,
        order: 2,
        durationMs: 12 * 60_000,
      },
    ]

    const withTeam = resolveSoccerSettingsHierarchy({
      personalDefaults: personal,
      teamDefaults: { regulationSegments: teamSegments },
    })
    const inherited = resolveSoccerSettingsHierarchy({
      personalDefaults: personal,
      teamDefaults: {},
    })

    expect(withTeam.rules.regulationSegments).toEqual(teamSegments)
    expect(withTeam.sources.regulationSegments).toBe('team')
    expect(inherited.rules.regulationSegments).toEqual(personal.regulationSegments)
    expect(inherited.sources.regulationSegments).toBe('personal')
  })

  it('resumes inheritance when a sparse override is cleared', () => {
    const personal = structuredClone(DEFAULT_SOCCER_PERSONAL_SETTINGS.rules)
    personal.maxOnFieldPlayers = 9

    const withTeam = resolveSoccerSettingsHierarchy({
      personalDefaults: personal,
      teamDefaults: { maxOnFieldPlayers: 7 },
    })
    const cleared = resolveSoccerSettingsHierarchy({
      personalDefaults: personal,
      teamDefaults: {},
    })

    expect(withTeam.rules.maxOnFieldPlayers).toBe(7)
    expect(withTeam.sources.maxOnFieldPlayers).toBe('team')
    expect(cleared.rules.maxOnFieldPlayers).toBe(9)
    expect(cleared.sources.maxOnFieldPlayers).toBe('personal')
  })
})

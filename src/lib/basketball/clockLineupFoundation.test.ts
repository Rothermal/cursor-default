import { describe, expect, it } from 'vitest'
import {
  getBasketballRulesProfile,
  resolveBasketballRules,
  upgradeBasketballRulesDraftToV3,
} from './profiles'
import { normalizeBasketballMatchRules } from './rules'
import { normalizeBasketballSportGameState, validateBasketballMatchSetup } from './state'
import { parseBasketballTeamSettings } from './settings'
import type {
  BasketballMatchParticipant,
  BasketballMatchSetupV1,
  BasketballMatchSetupV2,
} from './types'

describe('BKE-6A1 clock and lineup foundation', () => {
  it('upgrades only cloned drafts and preserves immutable version-2 profiles', () => {
    const profile = getBasketballRulesProfile('nfhs', 1)!
    const upgraded = upgradeBasketballRulesDraftToV3(profile.rules, profile.profileId)

    expect(profile.rules.rulesSchemaVersion).toBe(2)
    expect(upgraded).toMatchObject({
      rulesSchemaVersion: 3,
      clockModel: 'anchored',
      clockDisplayDirection: 'count_down',
      clockExpiration: 'stop_at_zero',
      stoppageMode: 'explicit',
      equalPlayPolicy: { mode: 'off' },
    })
    upgraded.regulationSegments[0].label = 'Changed'
    expect(profile.rules.regulationSegments[0].label).toBe('Q1')

    const youth = getBasketballRulesProfile('youth_equal_play', 1)!
    expect(upgradeBasketballRulesDraftToV3(youth.rules, youth.profileId).equalPlayPolicy)
      .toEqual({
        mode: 'enforced',
        minimumPeriods: null,
        maximumConsecutivePeriods: 2,
        maximumPeriodImbalance: 1,
      })
  })

  it('normalizes version 2 and 3 without rewriting either shape', () => {
    const v2 = getBasketballRulesProfile('nfhs', 1)!.rules
    const v3 = upgradeBasketballRulesDraftToV3(v2, 'nfhs')
    expect(normalizeBasketballMatchRules(v2)).toEqual(v2)
    expect(normalizeBasketballMatchRules(v2)).not.toHaveProperty('equalPlayPolicy')
    expect(normalizeBasketballMatchRules(v3)).toEqual(v3)
    expect(normalizeBasketballMatchRules({ ...v3, extra: true })).toBeNull()
    expect(normalizeBasketballMatchRules({
      ...v3,
      clockModel: 'none',
      equalPlayPolicy: { ...v3.equalPlayPolicy, mode: 'advisory' },
    })).toBeNull()
  })

  it('preserves v2 settings and requires a complete v3 bundle', () => {
    expect(parseBasketballTeamSettings(teamSettings({ clockModel: 'none' })))
      .toMatchObject({ ok: true })
    expect(parseBasketballTeamSettings(teamSettings({ clockDisplayDirection: 'count_down' })))
      .toMatchObject({ ok: false })

    const bundle = clockBundle()
    expect(parseBasketballTeamSettings(teamSettings(bundle))).toMatchObject({ ok: true })
    const resolved = resolveBasketballRules(
      { profileId: 'nfhs', profileVersion: 1 },
      [{ id: 'team', overrides: bundle }]
    )
    expect(resolved).toMatchObject({
      ok: true,
      value: {
        rules: { rulesSchemaVersion: 3 },
        sourceByField: {
          regulationSegments: 'built_in',
          clockDisplayDirection: 'team',
        },
      },
    })
  })

  it('validates strict setup-v2 opening authority while retaining setup-v1 shape', () => {
    const participants = trackedParticipants(5)
    const rules = upgradeBasketballRulesDraftToV3(
      getBasketballRulesProfile('nfhs', 1)!.rules,
      'nfhs'
    )
    const setup: BasketballMatchSetupV2 = {
      version: 2,
      trackedTeamDesignation: 'home',
      sourceTeamId: null,
      sourceSeasonId: null,
      rulesSource: rulesSource(),
      rulesSnapshot: rules,
      participants,
      openingLineups: {
        tracked: { participantIds: participants.map(player => player.id), shortHandedReason: null },
        opponent: null,
      },
    }
    expect(validateBasketballMatchSetup(setup)).toBeNull()
    expect(validateBasketballMatchSetup({ ...setup, version: 1 })).toContain(
      'supports only version-1 or version-2 rules'
    )
    expect(validateBasketballMatchSetup({
      ...setup,
      openingLineups: {
        tracked: { participantIds: participants.slice(0, 4).map(player => player.id), shortHandedReason: null },
        opponent: null,
      },
    })).toContain('match Starter status')

    const v1: BasketballMatchSetupV1 = {
      version: 1,
      trackedTeamDesignation: 'home',
      sourceTeamId: null,
      sourceSeasonId: null,
      rulesSource: rulesSource(),
      rulesSnapshot: getBasketballRulesProfile('nfhs', 1)!.rules,
      participants,
    }
    const normalized = normalizeBasketballSportGameState({
      sportId: 'basketball',
      version: 1,
      setup: v1,
      capturePreferences: null,
    })
    expect(normalized?.setup).toEqual(v1)
    expect(normalized?.setup).not.toHaveProperty('openingLineups')
  })
})

function clockBundle() {
  return {
    clockModel: 'anchored' as const,
    clockDisplayDirection: 'count_down' as const,
    clockExpiration: 'stop_at_zero' as const,
    stoppageMode: 'explicit' as const,
    equalPlayPolicy: {
      mode: 'off' as const,
      minimumPeriods: null,
      maximumConsecutivePeriods: null,
      maximumPeriodImbalance: null,
    },
  }
}

function teamSettings(ruleOverrides: Record<string, unknown>) {
  return { baseProfile: { profileId: 'nfhs', profileVersion: 1 }, ruleOverrides }
}

function trackedParticipants(count: number): BasketballMatchParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tracked-${index + 1}`,
    playerId: `player-${index + 1}`,
    displayName: `Player ${index + 1}`,
    number: String(index + 1),
    teamSide: 'tracked',
    initialStatus: 'starter',
    position: null,
    captain: index === 0,
  }))
}

function rulesSource() {
  return {
    profileId: 'nfhs',
    profileVersion: 1,
    personalRevision: null,
    teamRevision: null,
    hasExplicitMatchOverrides: false,
  }
}

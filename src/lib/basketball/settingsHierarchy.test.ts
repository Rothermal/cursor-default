import { describe, expect, it } from 'vitest'
import {
  resolveBasketballSettingsHierarchy,
  type BasketballPersonalSettingsV1,
  type BasketballTeamSettingsV1,
} from './settings'

const personal: BasketballPersonalSettingsV1 = {
  baseProfile: { profileId: 'nfhs', profileVersion: 1 },
  ruleOverrides: { personalFoulLimit: 7 },
  capture: { reboundPromptAfterMiss: true },
  display: { defaultCourtFlipped: true },
}

const team: BasketballTeamSettingsV1 = {
  baseProfile: { profileId: 'nba', profileVersion: 1 },
  ruleOverrides: { personalFoulLimit: 8 },
}

describe('resolveBasketballSettingsHierarchy', () => {
  it('uses built-in, personal, then match rules for a personal-authority game', () => {
    const result = resolveBasketballSettingsHierarchy({
      authority: 'personal',
      personalSettings: personal,
      teamSettings: team,
      matchOverrides: { personalFoulLimit: 9 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.profile.profileId).toBe('nfhs')
    expect(result.value.rules.personalFoulLimit).toBe(9)
    expect(result.value.sourceByField.personalFoulLimit).toBe('match')
    expect(result.value.sourceByField.clockModel).toBe('built_in')
  })

  it('uses built-in, team, then match rules without personal leakage', () => {
    const result = resolveBasketballSettingsHierarchy({
      authority: 'team',
      personalSettings: personal,
      teamSettings: team,
      matchOverrides: {},
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.profile.profileId).toBe('nba')
    expect(result.value.rules.personalFoulLimit).toBe(8)
    expect(result.value.sourceByField.personalFoulLimit).toBe('team')
  })

  it('ignores a corrupt inactive branch', () => {
    const result = resolveBasketballSettingsHierarchy({
      authority: 'team',
      personalSettings: { unsafe: true },
      teamSettings: team,
    })

    expect(result.ok).toBe(true)
  })

  it('fails closed when the selected authority branch is corrupt', () => {
    const result = resolveBasketballSettingsHierarchy({
      authority: 'personal',
      personalSettings: { unsafe: true },
      teamSettings: team,
    })

    expect(result).toMatchObject({ ok: false, layer: 'personal' })
  })

  it('fails closed when match overrides contain unknown fields', () => {
    const result = resolveBasketballSettingsHierarchy({
      authority: 'team',
      teamSettings: team,
      matchOverrides: { mysteryRule: true },
    })

    expect(result).toMatchObject({ ok: false, layer: 'match' })
  })
})

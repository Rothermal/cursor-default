import { describe, expect, it } from 'vitest'
import {
  BASKETBALL_RULE_FIELDS,
  BASKETBALL_RULE_FIELD_LABELS,
  formatBasketballRuleField,
} from './profileDiffPresentation'
import {
  listBasketballRulesProfiles,
  previewBasketballProfileUpgrade,
} from './profiles'

describe('Basketball profile diff presentation', () => {
  it('keeps the exhaustive field catalog and labels coordinated', () => {
    expect(BASKETBALL_RULE_FIELDS).toEqual(Object.keys(BASKETBALL_RULE_FIELD_LABELS))
    expect(new Set(BASKETBALL_RULE_FIELDS).size).toBe(BASKETBALL_RULE_FIELDS.length)
  })

  it('distinguishes every changed base field across every catalog transition', () => {
    const profiles = listBasketballRulesProfiles()
    for (const current of profiles) {
      for (const target of profiles) {
        if (current.profileId === target.profileId) continue
        const preview = previewBasketballProfileUpgrade(current, target)
        expect(preview.ok).toBe(true)
        if (!preview.ok) continue
        for (const difference of preview.differences.filter(item => item.changedByProfile)) {
          expect(
            formatBasketballRuleField(
              difference.field,
              preview.currentBaseRules[difference.field]
            ),
            `${current.profileId} -> ${target.profileId}: ${difference.field}`
          ).not.toBe(formatBasketballRuleField(
            difference.field,
            preview.targetBaseRules[difference.field]
          ))
        }
      }
    }
  })

  it('exposes base movement while a compatible override keeps the effective value', () => {
    const preview = previewBasketballProfileUpgrade(
      { profileId: 'nfhs', profileVersion: 1 },
      { profileId: 'nba', profileVersion: 1 },
      { personalFoulLimit: 7 }
    )
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.currentBaseRules.personalFoulLimit).toBe(5)
    expect(preview.targetBaseRules.personalFoulLimit).toBe(6)
    expect(preview.current.rules.personalFoulLimit).toBe(7)
    expect(preview.candidate.rules.personalFoulLimit).toBe(7)
    expect(preview.differences).toContainEqual({
      field: 'personalFoulLimit',
      changedByProfile: true,
      overridden: true,
    })
  })

  it('shows the NBA and FIBA overtime policy difference explicitly', () => {
    const preview = previewBasketballProfileUpgrade(
      { profileId: 'nba', profileVersion: 1 },
      { profileId: 'fiba', profileVersion: 1 }
    )
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const current = formatBasketballRuleField(
      'overtimeTemplate',
      preview.currentBaseRules.overtimeTemplate
    )
    const target = formatBasketballRuleField(
      'overtimeTemplate',
      preview.targetBaseRules.overtimeTemplate
    )
    expect(current).toContain('fouls new_each')
    expect(target).toContain('fouls continue')
    expect(current).not.toBe(target)
  })
})

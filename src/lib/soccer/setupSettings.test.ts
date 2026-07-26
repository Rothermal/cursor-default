import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  soccerRulesOverrideFromDifference,
} from './settings'
import { resolveSoccerSetupRuleState } from './setupSettings'

describe('soccer setup settings hierarchy', () => {
  it('preserves explicit match overrides when the selected team changes', () => {
    const personal = DEFAULT_SOCCER_PERSONAL_SETTINGS.rules
    const matchOverrides = { maxAssistsPerGoal: 1 } as const
    const first = resolveSoccerSetupRuleState({
      personalDefaults: personal,
      teamDefaults: { maxOnFieldPlayers: 9 },
      matchOverrides,
    })
    const second = resolveSoccerSetupRuleState({
      personalDefaults: personal,
      teamDefaults: { maxOnFieldPlayers: 7 },
      matchOverrides,
    })

    expect(first.rules.maxOnFieldPlayers).toBe(9)
    expect(second.rules.maxOnFieldPlayers).toBe(7)
    expect(second.rules.maxAssistsPerGoal).toBe(1)
    expect(second.effective.sources.maxOnFieldPlayers).toBe('team')
    expect(second.effective.sources.maxAssistsPerGoal).toBe('match')
  })

  it('keeps an existing setup snapshot fixed until it is deliberately reset', () => {
    const initial = resolveSoccerSetupRuleState({
      personalDefaults: DEFAULT_SOCCER_PERSONAL_SETTINGS.rules,
      teamDefaults: { maxOnFieldPlayers: 9 },
    })
    const snapshot = {
      ...structuredClone(initial.rules),
      maxAssistsPerGoal: 1,
    }
    const reopened = resolveSoccerSetupRuleState({
      personalDefaults: DEFAULT_SOCCER_PERSONAL_SETTINGS.rules,
      teamDefaults: { maxOnFieldPlayers: 7 },
      preservedSnapshot: snapshot,
    })

    expect(reopened.rules).toEqual(snapshot)
    expect(reopened.displayedOverrides.maxOnFieldPlayers).toBe(9)
    expect(reopened.displayedOverrides.maxAssistsPerGoal).toBe(1)

    const reset = resolveSoccerSetupRuleState({
      personalDefaults: DEFAULT_SOCCER_PERSONAL_SETTINGS.rules,
      teamDefaults: { maxOnFieldPlayers: 7 },
      matchOverrides: {},
    })
    expect(reset.rules.maxOnFieldPlayers).toBe(7)
  })

  it('stores setup edits as sparse differences from inherited rules', () => {
    const base = resolveSoccerSetupRuleState({
      personalDefaults: DEFAULT_SOCCER_PERSONAL_SETTINGS.rules,
      teamDefaults: { maxOnFieldPlayers: 9 },
    })
    const edited = {
      ...structuredClone(base.rules),
      clockDirection: 'count_down' as const,
    }
    expect(soccerRulesOverrideFromDifference(base.inherited.rules, edited)).toEqual({
      clockDirection: 'count_down',
    })
  })
})

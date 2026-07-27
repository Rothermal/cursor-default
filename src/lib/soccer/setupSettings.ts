import type { SoccerMatchRulesOverride } from './rules'
import {
  resolveSoccerSettingsHierarchy,
  soccerRulesOverrideFromDifference,
  type SoccerSettingsHierarchy,
} from './settings'
import type { SoccerMatchRules } from './types'

export interface SoccerSetupRuleState {
  inherited: SoccerSettingsHierarchy
  effective: SoccerSettingsHierarchy
  displayedOverrides: SoccerMatchRulesOverride
  rules: SoccerMatchRules
}

export function resolveSoccerSetupRuleState(input: {
  personalDefaults: unknown
  teamDefaults?: unknown
  matchOverrides?: SoccerMatchRulesOverride
  preservedSnapshot?: SoccerMatchRules | null
}): SoccerSetupRuleState {
  const inherited = resolveSoccerSettingsHierarchy({
    personalDefaults: input.personalDefaults,
    teamDefaults: input.teamDefaults,
  })
  const displayedOverrides = input.preservedSnapshot
    ? soccerRulesOverrideFromDifference(inherited.rules, input.preservedSnapshot)
    : structuredClone(input.matchOverrides ?? {})
  const effective = resolveSoccerSettingsHierarchy({
    personalDefaults: input.personalDefaults,
    teamDefaults: input.teamDefaults,
    gameOverrides: displayedOverrides,
  })
  return {
    inherited,
    effective,
    displayedOverrides,
    rules: input.preservedSnapshot
      ? structuredClone(input.preservedSnapshot)
      : effective.rules,
  }
}

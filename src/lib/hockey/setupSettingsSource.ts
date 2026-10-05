import type { HockeyLineupDefaults } from './lineupDefaults'
import { hockeyTeamRulesSettings, type HockeyTeamSettingsV1 } from './settings'
import type { HockeySetupSettingsLayer } from './setupBuilder'
import type { HockeySettingsV1 } from './types'

/**
 * Which settings Hockey setup copies into the draft, and when (HKY-5C). A team game copies
 * the team's rules and lineup defaults once they have actually loaded for that team; a read
 * that fails falls back to built-in rules but stays eligible, so a later successful retry
 * still applies them once. An in-flight read is never treated as loaded. Recorder edits win
 * through `applyHockeySetupSettings` and `prefillHockeyDraftLineup`.
 */
export type HockeyTeamDefaultsState = 'none' | 'waiting' | 'loaded' | 'unavailable'

/** `useSportTeamSettings` statuses. */
export type HockeyTeamDefaultsReadStatus =
  | 'idle' | 'loading' | 'synced' | 'cached' | 'missing' | 'saving' | 'conflict' | 'backend_update_required' | 'error'

export interface HockeySetupSettingsInputs {
  /** The raw team selection ('' for none); a selection that has not resolved yet waits. */
  selectedTeamId: string
  resolvedTeamId: string | null
  personalChecking: boolean
  personalSettings: HockeySettingsV1
  teamStatus: HockeyTeamDefaultsReadStatus
  teamSettledTeamId: string | null
  teamSettings: HockeyTeamSettingsV1
  /** Identity of the loaded roster for the resolved team, or null while it is not ready. */
  rosterKey: string | null
}

export interface HockeySetupSettingsProgress {
  /** `personal`, `team:<id>` once team defaults applied, or `team-unavailable:<id>` for the fallback. */
  rulesKey: string | null
  /** The roster key the team lineup defaults were prefilled into. */
  lineupKey: string | null
}

export interface HockeySetupSettingsStep {
  progress: HockeySetupSettingsProgress
  /** Apply these rules to the draft (`layer: null` means built-in rules). */
  rules: { layer: HockeySetupSettingsLayer | null } | null
  /** Prefill the draft lineup from these defaults. */
  lineup: HockeyLineupDefaults | null
}

export const emptyHockeySetupSettingsProgress = (): HockeySetupSettingsProgress => ({ rulesKey: null, lineupKey: null })

export function hockeyTeamDefaultsState(inputs: Pick<HockeySetupSettingsInputs, 'resolvedTeamId' | 'teamSettledTeamId' | 'teamStatus'>): HockeyTeamDefaultsState {
  if (!inputs.resolvedTeamId) return 'none'
  if (inputs.teamSettledTeamId !== inputs.resolvedTeamId) return 'waiting'
  if (inputs.teamStatus === 'synced' || inputs.teamStatus === 'missing') return 'loaded'
  // A retry in flight without a device copy; a cached copy may be in flight or a failure.
  if (inputs.teamStatus === 'loading' || inputs.teamStatus === 'idle') return 'waiting'
  return 'unavailable'
}

export function nextHockeySetupSettingsStep(
  progress: HockeySetupSettingsProgress,
  inputs: HockeySetupSettingsInputs
): HockeySetupSettingsStep {
  const team = hockeyTeamDefaultsState(inputs)
  let rulesKey = progress.rulesKey
  let rules: HockeySetupSettingsStep['rules'] = null
  const teamId = inputs.resolvedTeamId
  if (teamId) {
    const applied = `team:${teamId}`
    const fallback = `team-unavailable:${teamId}`
    if (team === 'loaded' && rulesKey !== applied) {
      rulesKey = applied
      rules = { layer: { authority: 'team', settings: hockeyTeamRulesSettings(inputs.teamSettings) } }
    } else if (team === 'unavailable' && rulesKey !== applied && rulesKey !== fallback) {
      rulesKey = fallback
      rules = { layer: null }
    }
  } else if (!inputs.selectedTeamId && !inputs.personalChecking && rulesKey !== 'personal') {
    rulesKey = 'personal'
    rules = { layer: { authority: 'personal', settings: inputs.personalSettings } }
  }

  // A roster reload clears every pick, so each newly loaded roster is prefilled once, and
  // only from defaults that loaded for this team.
  let lineupKey = inputs.rosterKey === null ? null : progress.lineupKey
  let lineup: HockeyLineupDefaults | null = null
  if (team === 'loaded' && inputs.rosterKey !== null && lineupKey !== inputs.rosterKey) {
    lineupKey = inputs.rosterKey
    lineup = inputs.teamSettings.lineupDefaults
  }

  const unchanged = rulesKey === progress.rulesKey && lineupKey === progress.lineupKey
  return { progress: unchanged ? progress : { rulesKey, lineupKey }, rules, lineup }
}

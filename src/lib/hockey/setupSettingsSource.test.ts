import { describe, expect, it } from 'vitest'
import type { HockeyLineupDefaults } from './lineupDefaults'
import { defaultHockeySettings, defaultHockeyTeamSettings, type HockeyTeamSettingsV1 } from './settings'
import {
  applyHockeySetupSettings,
  createHockeySetupDraft,
  hockeyDraftRules,
  hockeyDraftRulesSource,
  prefillHockeyDraftLineup,
  setHockeyDraftProfile,
  type HockeySetupDraft,
  type HockeySetupRosterPlayer,
} from './setupBuilder'
import {
  emptyHockeySetupSettingsProgress,
  hockeyTeamDefaultsState,
  nextHockeySetupSettingsStep,
  type HockeySetupSettingsInputs,
  type HockeySetupSettingsProgress,
} from './setupSettingsSource'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const roster: HockeySetupRosterPlayer[] = [1, 2, 3, 4, 5, 6].map(n => ({ playerId: id(n), displayName: `Player ${n}`, number: String(n), position: n === 1 ? 'G' : 'C' }))
const lineup: HockeyLineupDefaults = { version: 1, starterPlayerIds: [id(3), id(4)], startingGoaliePlayerId: id(1), backupGoaliePlayerId: null }
const saved: HockeyTeamSettingsV1 = {
  settingsSchemaVersion: 1,
  baseProfile: { profileId: 'nhl_regular', profileVersion: 1 },
  ruleOverrides: { trapezoid: false },
  lineupDefaults: lineup,
}
const TEAM = 'team-1'
const inputs = (overrides: Partial<HockeySetupSettingsInputs>): HockeySetupSettingsInputs => ({
  selectedTeamId: TEAM,
  resolvedTeamId: TEAM,
  personalChecking: false,
  personalSettings: defaultHockeySettings(),
  teamStatus: 'loading',
  teamSettledTeamId: null,
  teamSettings: defaultHockeyTeamSettings(),
  rosterKey: `${TEAM}:0`,
  ...overrides,
})

/** What the setup page's effect does with each render's inputs. */
function run(draft: HockeySetupDraft, progress: HockeySetupSettingsProgress, next: HockeySetupSettingsInputs) {
  const step = nextHockeySetupSettingsStep(progress, next)
  let result = draft
  if (step.rules) result = applyHockeySetupSettings(result, step.rules.layer)
  if (step.lineup) result = prefillHockeyDraftLineup(result, step.lineup).draft
  return { draft: result, progress: step.progress, step }
}
const entryFor = (draft: HockeySetupDraft, n: number) => draft.entries.find(entry => entry.playerId === id(n))!

describe('Hockey setup settings source (HKY-5C review)', () => {
  it('applies team rules and lineup defaults after error, retry and a successful load', () => {
    let state = { draft: createHockeySetupDraft(roster), progress: emptyHockeySetupSettingsProgress() }
    // First read in flight: nothing applies, the roster is not consumed.
    state = run(state.draft, state.progress, inputs({}))
    expect(state.progress).toEqual({ rulesKey: null, lineupKey: null })

    // The read fails: built-in rules, no lineup, and the team source stays eligible.
    state = run(state.draft, state.progress, inputs({ teamStatus: 'error', teamSettledTeamId: TEAM }))
    expect(state.progress).toEqual({ rulesKey: `team-unavailable:${TEAM}`, lineupKey: null })
    expect(state.draft.settingsLayer).toBeNull()
    expect(state.draft.goalieId).toBeNull()

    // Retry in flight (the hook keeps the settled id and shows loading with defaults).
    const inFlight = run(state.draft, state.progress, inputs({ teamStatus: 'loading', teamSettledTeamId: TEAM }))
    expect(inFlight.step).toMatchObject({ rules: null, lineup: null })
    expect(inFlight.progress).toBe(state.progress)

    // Retry succeeds: the team rules and lineup apply once.
    state = run(state.draft, state.progress, inputs({ teamStatus: 'synced', teamSettledTeamId: TEAM, teamSettings: saved }))
    expect(state.progress).toEqual({ rulesKey: `team:${TEAM}`, lineupKey: `${TEAM}:0` })
    expect(state.draft.profileId).toBe('nhl_regular')
    expect(hockeyDraftRulesSource(state.draft).trapezoid).toBe('team')
    expect(hockeyDraftRules(state.draft).trapezoid).toBe(false)
    expect(state.draft.goalieId).toBe(entryFor(state.draft, 1).id)
    expect(state.draft.starterIds).toEqual([entryFor(state.draft, 3).id, entryFor(state.draft, 4).id])

    // A later focus refresh (cached while in flight) neither falls back nor re-applies.
    const again = run(state.draft, state.progress, inputs({ teamStatus: 'cached', teamSettledTeamId: TEAM, teamSettings: saved }))
    expect(again.step).toMatchObject({ rules: null, lineup: null })
  })

  it('never counts an in-flight read as loaded, even with the roster ready', () => {
    expect(hockeyTeamDefaultsState(inputs({ teamStatus: 'loading', teamSettledTeamId: TEAM }))).toBe('waiting')
    expect(hockeyTeamDefaultsState(inputs({ teamStatus: 'loading', teamSettledTeamId: 'other' }))).toBe('waiting')
    expect(hockeyTeamDefaultsState(inputs({ teamStatus: 'missing', teamSettledTeamId: TEAM }))).toBe('loaded')
    expect(hockeyTeamDefaultsState(inputs({ teamStatus: 'backend_update_required', teamSettledTeamId: TEAM }))).toBe('unavailable')
    const step = nextHockeySetupSettingsStep(emptyHockeySetupSettingsProgress(), inputs({ teamStatus: 'loading', teamSettledTeamId: TEAM }))
    expect(step.lineup).toBeNull()
  })

  it('keeps recorder edits made while the defaults were unavailable', () => {
    let state = run(createHockeySetupDraft(roster), emptyHockeySetupSettingsProgress(), inputs({ teamStatus: 'error', teamSettledTeamId: TEAM }))
    const edited = setHockeyDraftProfile(state.draft, 'ncaa')
    const goalie = { ...edited, goalieId: entryFor(edited, 2).id }
    state = run(goalie, state.progress, inputs({ teamStatus: 'synced', teamSettledTeamId: TEAM, teamSettings: saved }))
    expect(state.draft.profileId).toBe('ncaa')
    expect(state.draft.goalieId).toBe(entryFor(state.draft, 2).id)
    expect(state.draft.starterIds).toEqual([])
  })

  it('prefills each newly loaded roster once and uses personal settings without a team', () => {
    let state = run(createHockeySetupDraft(roster), emptyHockeySetupSettingsProgress(),
      inputs({ teamStatus: 'synced', teamSettledTeamId: TEAM, teamSettings: saved, rosterKey: null }))
    expect(state.progress.lineupKey).toBeNull()
    state = run(state.draft, state.progress, inputs({ teamStatus: 'synced', teamSettledTeamId: TEAM, teamSettings: saved, rosterKey: `${TEAM}:1` }))
    expect(state.step.lineup).toEqual(lineup)

    const personal = nextHockeySetupSettingsStep(emptyHockeySetupSettingsProgress(),
      inputs({ selectedTeamId: '', resolvedTeamId: null, rosterKey: null, teamStatus: 'idle' }))
    expect(personal.rules?.layer?.authority).toBe('personal')
    expect(nextHockeySetupSettingsStep(emptyHockeySetupSettingsProgress(),
      inputs({ selectedTeamId: '', resolvedTeamId: null, rosterKey: null, personalChecking: true })).rules).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  emptyHockeyLineupDefaults,
  hockeyDefaultRole,
  parseHockeyLineupDefaults,
  setHockeyDefaultRole,
  staleHockeyLineupPlayerIds,
  type HockeyLineupDefaults,
} from './lineupDefaults'
import { findHockeyRulesProfile } from './profiles'
import {
  defaultHockeySettings,
  defaultHockeyTeamSettings,
  hockeySettingsRules,
  hockeySettingsWithProfile,
  hockeySettingsWithRules,
  hockeyTeamRulesSettings,
  parseHockeySettings,
  parseHockeyTeamSettings,
} from './settings'
import {
  applyHockeySetupSettings,
  buildHockeyMatchSetup,
  createHockeySetupDraft,
  hockeyDraftRules,
  hockeyDraftRulesSource,
  prefillHockeyDraftLineup,
  setHockeyDraftClockModel,
  setHockeyDraftGoalie,
  setHockeyDraftPeriodLength,
  setHockeyDraftProfile,
  type HockeySetupDraft,
  type HockeySetupRosterPlayer,
} from './setupBuilder'
import type { HockeySettingsV1 } from './types'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const roster: HockeySetupRosterPlayer[] = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
  playerId: id(n),
  displayName: `Player ${n}`,
  number: String(n),
  position: n <= 2 ? 'G' : 'C',
}))
const entryFor = (draft: HockeySetupDraft, n: number) => draft.entries.find(entry => entry.playerId === id(n))!

function personal(overrides: HockeySettingsV1['ruleOverrides'] = {}, profileId: HockeySettingsV1['baseProfile']['profileId'] = 'usa_hockey_youth'): HockeySettingsV1 {
  return { settingsSchemaVersion: 1, baseProfile: { profileId, profileVersion: 1 }, ruleOverrides: overrides }
}

describe('HKY-5C team settings', () => {
  it('parses the exact team shape and keeps the rules part separate', () => {
    expect(parseHockeyTeamSettings(undefined)).toEqual({ ok: true, value: defaultHockeyTeamSettings() })
    const lineup: HockeyLineupDefaults = { version: 1, starterPlayerIds: [id(4), id(3)], startingGoaliePlayerId: id(1), backupGoaliePlayerId: null }
    const parsed = parseHockeyTeamSettings({ ...personal({ trapezoid: true }), lineupDefaults: lineup })
    expect(parsed.ok && parsed.value.lineupDefaults.starterPlayerIds).toEqual([id(3), id(4)])
    expect(parsed.ok && hockeyTeamRulesSettings(parsed.value)).toEqual(personal({ trapezoid: true }))
    expect(parseHockeyTeamSettings(personal()).ok).toBe(false)
    expect(parseHockeyTeamSettings({ ...personal(), lineupDefaults: lineup, extra: 1 }).ok).toBe(false)
    expect(parseHockeyTeamSettings({ ...personal(), lineupDefaults: { ...lineup, backupGoaliePlayerId: id(3) } }).ok).toBe(false)
    expect(parseHockeyTeamSettings({ ...personal({ shootout: null }, 'nhl_regular'), lineupDefaults: lineup }).ok).toBe(false)
    // Personal settings never carry a lineup.
    expect(parseHockeySettings({ ...personal(), lineupDefaults: lineup }).ok).toBe(false)
  })

  it('stores only the rules that differ from the profile', () => {
    const rules = hockeySettingsRules(defaultHockeySettings())!
    const longer = hockeySettingsWithRules(defaultHockeySettings(), {
      ...rules,
      regulation: { periods: 3, periodLengthMs: 12 * 60_000 },
      clockModel: 'none',
      clock: null,
    })
    expect(Object.keys(longer.ruleOverrides).sort()).toEqual(['clock', 'clockModel', 'regulation'])
    expect(parseHockeySettings(longer).ok).toBe(true)
    // Choosing the profile's values again removes the overrides.
    expect(hockeySettingsWithRules(longer, rules).ruleOverrides).toEqual({})
    // A new profile drops the old profile's overrides.
    const nhl = hockeySettingsWithProfile(longer, 'nhl_regular')
    expect(nhl).toEqual(personal({}, 'nhl_regular'))
    expect(hockeySettingsRules(nhl)).toEqual(findHockeyRulesProfile('nhl_regular')!.rules)
  })

  it('keeps one default role per player and at most six starters', () => {
    let lineup = emptyHockeyLineupDefaults()
    for (const n of [3, 4, 5, 6, 7, 8, 1]) lineup = setHockeyDefaultRole(lineup, id(n), 'starter')
    expect(lineup.starterPlayerIds).toHaveLength(6)
    expect(lineup.starterPlayerIds).not.toContain(id(1))
    lineup = setHockeyDefaultRole(lineup, id(1), 'starting_goalie')
    lineup = setHockeyDefaultRole(lineup, id(3), 'backup_goalie')
    expect(hockeyDefaultRole(lineup, id(3))).toBe('backup_goalie')
    expect(lineup.starterPlayerIds).not.toContain(id(3))
    lineup = setHockeyDefaultRole(lineup, id(2), 'starting_goalie')
    expect(hockeyDefaultRole(lineup, id(1))).toBe('bench')
    expect(parseHockeyLineupDefaults(lineup)).toEqual(lineup)
    expect(staleHockeyLineupPlayerIds(lineup, new Set([id(2), id(4)]))).toEqual([id(5), id(6), id(7), id(8), id(3)])
  })
})

describe('HKY-5C setup draft from settings', () => {
  it('starts from personal settings and records their source', () => {
    const settings = personal({ regulation: { periods: 2, periodLengthMs: 20 * 60_000 } }, 'recreational')
    const draft = applyHockeySetupSettings(createHockeySetupDraft(roster), { authority: 'personal', settings })
    expect(draft.profileId).toBe('recreational')
    expect(hockeyDraftRules(draft).regulation).toEqual({ periods: 2, periodLengthMs: 20 * 60_000 })
    expect(hockeyDraftRules(draft).clock).toEqual({ display: 'count_down', mode: 'running' })
    const source = hockeyDraftRulesSource(draft)
    expect(source.regulation).toBe('personal')
    expect(source.clock).toBe('built_in')
    // A match change on top of the settings is a match override of that field only.
    const shorter = setHockeyDraftPeriodLength(draft, 10)
    expect(hockeyDraftRules(shorter).regulation).toEqual({ periods: 2, periodLengthMs: 10 * 60_000 })
    expect(hockeyDraftRulesSource(shorter).regulation).toBe('match')
  })

  it('lets recorder edits win over settings that arrive later', () => {
    const edited = setHockeyDraftProfile(createHockeySetupDraft(roster), 'ncaa')
    const next = applyHockeySetupSettings(edited, { authority: 'team', settings: personal({ trapezoid: true }, 'nhl_regular') })
    expect(next.profileId).toBe('ncaa')
    expect(hockeyDraftRulesSource(next).trapezoid).toBe('built_in')
    // Switching to the settings' profile picks the settings up again.
    const nhl = setHockeyDraftProfile(next, 'nhl_regular')
    expect(hockeyDraftRules(nhl).trapezoid).toBe(true)
    expect(hockeyDraftRulesSource(nhl).trapezoid).toBe('team')
    const clockless = setHockeyDraftClockModel(applyHockeySetupSettings(createHockeySetupDraft(roster), null), 'none')
    expect(applyHockeySetupSettings(clockless, { authority: 'personal', settings: personal({}, 'ncaa') }).profileId).toBe('usa_hockey_youth')
  })

  it('freezes team settings into the setup with team sources', () => {
    let draft = applyHockeySetupSettings(createHockeySetupDraft(roster), {
      authority: 'team',
      settings: personal({ skatersPerSide: 4, minimumSkaters: 3 }),
    })
    draft = prefillHockeyDraftLineup(draft, {
      version: 1,
      starterPlayerIds: [id(3), id(4), id(5), id(6)],
      startingGoaliePlayerId: id(1),
      backupGoaliePlayerId: id(2),
    }).draft
    const built = buildHockeyMatchSetup(draft, { teamId: 'team-1', seasonId: 'season-1' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.setup.rulesSnapshot.skatersPerSide).toBe(4)
    expect(built.setup.rulesSource.skatersPerSide).toBe('team')
    expect(built.setup.rulesSource.regulation).toBe('built_in')
    expect(built.setup.openingLineup.skaterParticipantIds).toHaveLength(4)
  })

  it('prefills goalies and starters from team defaults only when nothing is picked', () => {
    const defaults: HockeyLineupDefaults = {
      version: 1,
      starterPlayerIds: [id(3), id(4), id(5), id(6), id(7), id(99)],
      startingGoaliePlayerId: id(2),
      backupGoaliePlayerId: id(8),
    }
    const { draft, missing } = prefillHockeyDraftLineup(createHockeySetupDraft(roster), defaults)
    expect(missing).toBe(1)
    expect(draft.goalieId).toBe(entryFor(draft, 2).id)
    // A backup goalie dresses as a goalie and is not a starter.
    expect(entryFor(draft, 8).dressedAs).toBe('goalie')
    expect(draft.starterIds).toEqual([3, 4, 5, 6, 7].map(n => entryFor(draft, n).id))
    // Player 1 is a goalie by position but has no default, so stays a dressed bench goalie.
    expect(draft.starterIds).not.toContain(entryFor(draft, 1).id)

    const fresh = createHockeySetupDraft(roster)
    const picked = setHockeyDraftGoalie(fresh, entryFor(fresh, 1).id)
    expect(prefillHockeyDraftLineup(picked, defaults)).toEqual({ draft: picked, missing: 0 })
  })

  it('trims starters when settings allow fewer skaters', () => {
    const defaults: HockeyLineupDefaults = { version: 1, starterPlayerIds: [id(3), id(4), id(5), id(6), id(7)], startingGoaliePlayerId: null, backupGoaliePlayerId: null }
    const draft = prefillHockeyDraftLineup(createHockeySetupDraft(roster), defaults).draft
    expect(draft.starterIds).toHaveLength(5)
    const three = applyHockeySetupSettings(draft, { authority: 'team', settings: personal({ skatersPerSide: 3, minimumSkaters: 3 }) })
    expect(three.starterIds).toHaveLength(3)
  })
})

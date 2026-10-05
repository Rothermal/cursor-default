import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hockeyRulesProfiles } from './profiles'
import { HOCKEY_RULES_FIELDS } from './rules'
import { parseHockeySettings, parseHockeyTeamSettings } from './settings'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/074_hockey_settings.sql'), 'utf8').replace(/\r\n/g, '\n')
const lower = sql.toLowerCase()

function definition(name: string): string {
  const start = lower.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  return lower.slice(start, lower.indexOf('\n$$;\n', start) + 5)
}

/** Ids `team_players` holds as active in the HKY-5C database check (supabase/tests/hky5c). */
export const ACTIVE = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007']
const INACTIVE = '00000000-0000-4000-8000-000000000099'
const base = (profileId = 'usa_hockey_youth', ruleOverrides: Record<string, unknown> = {}) =>
  ({ settingsSchemaVersion: 1, baseProfile: { profileId, profileVersion: 1 }, ruleOverrides })
const lineup = (starters: string[] = [], starting: string | null = null, backup: string | null = null) =>
  ({ version: 1, starterPlayerIds: starters, startingGoaliePlayerId: starting, backupGoaliePlayerId: backup })

/**
 * Settings the client parser accepts or refuses; the database check expects the server to agree.
 * `active` marks a team case that only fails because a player is not on the active roster,
 * which the client checks in the editor rather than the parser.
 */
export function hockeySettingsParityCases(): Array<{ name: string; scope: 'user' | 'team'; settings: unknown; ok: boolean }> {
  const user: Array<[string, unknown]> = [
    ['defaults', base()],
    ['every profile', null],
    ['clockless youth', base('usa_hockey_youth', { clockModel: 'none', clock: null })],
    ['running clock', base('ncaa', { clock: { display: 'count_down', mode: 'running' } })],
    ['two 25-minute periods', base('recreational', { regulation: { periods: 2, periodLengthMs: 1_500_000 } })],
    ['HKY-1 overtime shape', base('high_school_us', { overtime: { lengthMs: 300_000, skaters: 5, repeat: false, endsPolicy: 'continue_alternation' } })],
    ['four skaters', base('usa_hockey_youth', { skatersPerSide: 4, minimumSkaters: 3 })],
    ['no shootout but repeating overtime', base('nhl_regular', { shootout: null, overtime: { lengthMs: 1_200_000, skaters: 5, repeat: true, endsPolicy: 'same_as_last_regulation', suddenDeath: true } })],
    ['custom penalties', base('custom', { penalties: { minorMs: 90_000, doubleMinorMs: 180_000, majorMs: 300_000, misconductMs: 600_000, releaseMinorOnPowerPlayGoal: false, coincidentalMinors: 'play_short' } })],
    ['trapezoid', base('ncaa', { trapezoid: true })],
    ['ties off with a shootout', base('usa_hockey_youth', { tiesAllowed: false, shootout: { rounds: 5, repeatShooters: 'never' } })],
    // Refused
    ['ties off with nothing', base('usa_hockey_youth', { tiesAllowed: false })],
    ['nhl without its shootout', base('nhl_regular', { shootout: null })],
    ['clock on a clockless game', base('usa_hockey_youth', { clockModel: 'none' })],
    ['no clock on an anchored game', base('usa_hockey_youth', { clock: null })],
    ['unknown clock mode', base('usa_hockey_youth', { clock: { display: 'count_down', mode: 'fast' } })],
    ['six periods', base('usa_hockey_youth', { regulation: { periods: 6, periodLengthMs: 900_000 } })],
    ['partial second', base('usa_hockey_youth', { regulation: { periods: 3, periodLengthMs: 900_500 } })],
    ['61-minute period', base('usa_hockey_youth', { regulation: { periods: 3, periodLengthMs: 3_660_000 } })],
    ['seven skaters', base('usa_hockey_youth', { skatersPerSide: 7 })],
    ['minimum above skaters', base('usa_hockey_youth', { skatersPerSide: 4, minimumSkaters: 5 })],
    ['overtime skaters above skaters', base('usa_hockey_youth', { skatersPerSide: 4, minimumSkaters: 3, overtime: { lengthMs: 300_000, skaters: 5, repeat: false, endsPolicy: 'continue_alternation', suddenDeath: true } })],
    ['sudden death not boolean', base('high_school_us', { overtime: { lengthMs: 300_000, skaters: 5, repeat: false, endsPolicy: 'continue_alternation', suddenDeath: 'yes' } })],
    ['shootout of zero rounds', base('nhl_regular', { shootout: { rounds: 0, repeatShooters: 'after_all' } })],
    ['double minor shorter than minor', base('custom', { penalties: { minorMs: 120_000, doubleMinorMs: 60_000, majorMs: 300_000, misconductMs: 600_000, releaseMinorOnPowerPlayGoal: true, coincidentalMinors: 'substitute' } })],
    ['penalties missing a field', base('custom', { penalties: { minorMs: 120_000, doubleMinorMs: 240_000, majorMs: 300_000, misconductMs: 600_000, releaseMinorOnPowerPlayGoal: true } })],
    ['string trapezoid', base('ncaa', { trapezoid: 'true' })],
    ['unknown override', base('ncaa', { icing: true })],
    ['overrides not an object', base('ncaa', [] as never)],
    ['unknown profile', base('khl')],
    ['profile version 2', { ...base(), baseProfile: { profileId: 'ncaa', profileVersion: 2 } }],
    ['schema version 2', { ...base(), settingsSchemaVersion: 2 }],
    ['extra key', { ...base(), extra: 1 }],
    ['missing overrides', { settingsSchemaVersion: 1, baseProfile: { profileId: 'ncaa', profileVersion: 1 } }],
  ]
  const cases: Array<{ name: string; scope: 'user' | 'team'; settings: unknown; ok: boolean }> = []
  for (const [name, settings] of user) {
    if (settings === null) {
      for (const profile of hockeyRulesProfiles()) {
        cases.push({ name: `profile ${profile.id}`, scope: 'user', settings: base(profile.id), ok: parseHockeySettings(base(profile.id)).ok })
      }
      continue
    }
    cases.push({ name, scope: 'user', settings, ok: parseHockeySettings(settings).ok })
  }
  const team: Array<[string, unknown]> = [
    ['empty lineup', { ...base(), lineupDefaults: lineup() }],
    ['six starters and a goalie', { ...base(), lineupDefaults: lineup(ACTIVE.slice(0, 6), ACTIVE[6], null) }],
    ['upper-case ids', { ...base(), lineupDefaults: lineup([ACTIVE[0].toUpperCase()], ACTIVE[1], ACTIVE[2]) }],
    ['team rules override', { ...base('ncaa', { trapezoid: true }), lineupDefaults: lineup([ACTIVE[0]]) }],
    // Refused
    ['seven starters', { ...base(), lineupDefaults: lineup([...ACTIVE, INACTIVE]) }],
    ['duplicate starter', { ...base(), lineupDefaults: lineup([ACTIVE[0], ACTIVE[0]]) }],
    ['goalie also a starter', { ...base(), lineupDefaults: lineup([ACTIVE[0]], ACTIVE[0]) }],
    ['backup also a starter', { ...base(), lineupDefaults: lineup([ACTIVE[0]], null, ACTIVE[0]) }],
    ['same goalie twice', { ...base(), lineupDefaults: lineup([], ACTIVE[1], ACTIVE[1]) }],
    ['not a uuid', { ...base(), lineupDefaults: lineup(['player-1']) }],
    ['lineup version 2', { ...base(), lineupDefaults: { ...lineup(), version: 2 } }],
    ['lineup extra key', { ...base(), lineupDefaults: { ...lineup(), lines: [] } }],
    ['missing lineup', base()],
    ['invalid team rules', { ...base('nhl_regular', { shootout: null }), lineupDefaults: lineup() }],
  ]
  for (const [name, settings] of team) cases.push({ name, scope: 'team', settings, ok: parseHockeyTeamSettings(settings).ok })
  // The parser accepts these; the server refuses them because a player is not active on the team.
  cases.push({ name: 'inactive starter', scope: 'team', settings: { ...base(), lineupDefaults: lineup([INACTIVE]) }, ok: false })
  cases.push({ name: 'inactive backup goalie', scope: 'team', settings: { ...base(), lineupDefaults: lineup([], null, INACTIVE) }, ok: false })
  return cases
}

describe('migration 074 Hockey settings', () => {
  it('mirrors every client profile exactly', () => {
    const profiles = hockeyRulesProfiles()
    expect(profiles.every(profile => profile.version === 1)).toBe(true)
    for (const profile of profiles) {
      const match = sql.match(new RegExp(`when '${profile.id}' then '([^']+)'::jsonb`))
      expect(match, profile.id).not.toBeNull()
      const rules = Object.fromEntries(HOCKEY_RULES_FIELDS.map(field => [field, profile.rules[field]]))
      expect(JSON.parse(match![1])).toEqual(rules)
    }
    expect(sql.match(/when '[a-z_]+' then '\{/g)).toHaveLength(profiles.length)
  })

  it('validates the layered rules and the team lineup before the shared revisioned core', () => {
    const payload = definition('_validate_hockey_settings_payload')
    expect(payload).toContain('public._hockey_rules_error(v_profile || v_overrides)')
    expect(payload).toContain("roster.team_id = p_team_id and roster.player_id = lineup_player.id and roster.is_active")
    const team = definition('save_hockey_team_settings_revisioned')
    expect(team).toContain("not in ('owner', 'admin')")
    expect(team).toContain("v_sport is distinct from 'hockey'")
    expect(team.indexOf('pg_advisory_xact_lock')).toBeLessThan(team.indexOf('_validate_hockey_settings_payload'))
    expect(team).toContain("'hockey', 1, p_expected_revision, p_settings, 'hockey_settings_changed'")
    const user = definition('save_hockey_user_settings_revisioned')
    expect(user).toContain("_validate_hockey_settings_payload('user', null, p_settings)")
    expect(user).toContain("'hockey', 1, p_expected_revision, p_settings, null")
  })

  it('reports contract 2 only when the settings writes exist too', () => {
    const handshake = definition('get_hockey_release_capabilities')
    expect(handshake).toContain("'public.save_hockey_user_settings_revisioned(bigint,jsonb)'")
    expect(handshake).toContain("'public.save_hockey_team_settings_revisioned(uuid,bigint,jsonb)'")
    expect(handshake).toContain("'contractversion', 2,\n    'migration', 74,")
    expect(handshake).toContain("'settingscontractversion', 1")
  })

  it('keeps helpers private and grants only the fixed writes and the handshake', () => {
    for (const helper of ['_hockey_settings_int_between', '_hockey_settings_whole_seconds', '_hockey_profile_rules', '_hockey_rules_error', '_validate_hockey_settings_payload']) {
      expect(lower).toMatch(new RegExp(`revoke all on function public\\.${helper}\\([^)]*\\) from public, anon, authenticated;`))
      expect(lower).not.toMatch(new RegExp(`grant execute on function public\\.${helper}\\(`))
    }
    expect(lower.match(/grant execute on function/g)).toHaveLength(3)
    expect(lower).not.toMatch(/\b(drop|alter|delete|update|insert)\b/)
  })

  it('builds the parity cases (written out for the database check with HKY5C_CASES_OUT)', () => {
    const cases = hockeySettingsParityCases()
    expect(cases.filter(entry => entry.ok).length).toBeGreaterThan(10)
    expect(cases.filter(entry => !entry.ok).length).toBeGreaterThan(20)
    if (process.env.HKY5C_CASES_OUT) writeFileSync(process.env.HKY5C_CASES_OUT, JSON.stringify({ active: ACTIVE, cases }, null, 2))
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260921172605_basketball_roster_defaults.sql'), 'utf8').toLowerCase()

describe('Basketball roster-default migration contract', () => {
  it('retains authentication, app access, team role, sport and CAS checks', () => {
    for (const check of ['auth.uid()', 'has_active_app_access()', 'current_team_role(p_team_id)',
      "('owner', 'admin')", "v_sport is distinct from 'basketball'", 'p_expected_revision',
      '_save_sport_settings_revisioned_core', 'pg_advisory_xact_lock']) expect(sql).toContain(check)
    expect(sql).toContain('revoke all on function public.save_basketball_team_settings_revisioned')
    expect(sql).toContain('to authenticated')
  })
  it('validates exact starter identities and blocks old-client schema downgrade', () => {
    expect(sql).toContain("array['version', 'starterplayerids']")
    expect(sql).toContain("jsonb_array_length(v_defaults->'starterplayerids') > 5")
    expect(sql).toContain('duplicate starter identity')
    expect(sql).toContain('roster.team_id = p_team_id')
    expect(sql).toContain('roster.is_active')
    expect(sql).toContain('schema_version >= 2')
    expect(sql).toContain("_validate_basketball_settings_payload('team', p_settings - 'lineupdefaults')")
  })
  it('does not change personal settings, Soccer, match history or table policies', () => {
    for (const forbidden of ['update public.games', 'update public.game_events', 'create policy',
      'save_basketball_user_settings', 'save_team_sport_settings_revisioned']) expect(sql).not.toContain(forbidden)
    expect(sql).toContain("'basketball_settings_changed'")
  })
})

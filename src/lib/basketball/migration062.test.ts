import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBasketballRulesProfiles } from './profiles'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/062_basketball_settings_foundation.sql'),
  'utf8'
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration 062 Basketball settings foundation', () => {
  it('keeps the broad Soccer-only settings surfaces untouched', () => {
    expect(sql).not.toContain('soccer')
    expect(sql).not.toContain(
      'create or replace function public._validate_sport_settings_payload'
    )
    expect(sql).not.toContain(
      'create or replace function public.save_user_sport_settings_revisioned'
    )
    expect(sql).not.toContain(
      'create or replace function public.save_team_sport_settings_revisioned'
    )
    expect(sql).not.toContain('soccer_settings_changed')
  })

  it('exposes only fixed Basketball settings writes to authenticated users', () => {
    expect(sql).toContain(
      'create or replace function public.save_basketball_user_settings_revisioned'
    )
    expect(sql).toContain(
      'create or replace function public.save_basketball_team_settings_revisioned'
    )
    expect(sql).toContain("'user', v_user_id, null, 'basketball', 1")
    expect(sql).toContain("'team',\n    v_user_id,\n    p_team_id,\n    'basketball',\n    1")
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain("not in ('owner', 'admin')")
    expect(sql).toContain("v_team_sport is distinct from 'basketball'")
    expect(sql).toContain(
      'grant execute on function public.save_basketball_user_settings_revisioned(bigint, jsonb)\n  to authenticated'
    )
    expect(sql).toContain(
      'grant execute on function public.save_basketball_team_settings_revisioned(uuid, bigint, jsonb)\n  to authenticated'
    )
    expect(sql).not.toContain(
      'grant execute on function public.save_basketball_user_settings_revisioned(bigint, jsonb)\n  to anon'
    )
  })

  it('keeps validation and CAS internals private and fail closed', () => {
    expect(sql).toContain(
      'create or replace function public._validate_basketball_settings_payload'
    )
    expect(sql).toContain(
      'create or replace function public._validate_basketball_rule_overrides'
    )
    expect(sql).toContain('basketball structural overrides must be saved together')
    expect(sql).toContain('basketball foul-window assignment is invalid')
    expect(sql).toContain('basketball timeout-pool assignment is invalid')
    expect(sql).toContain(
      'create or replace function public._save_sport_settings_revisioned_core'
    )
    expect(sql).toContain(
      'revoke all on function public._save_sport_settings_revisioned_core'
    )
    expect(sql).not.toContain(
      'grant execute on function public._save_sport_settings_revisioned_core'
    )
    expect(sql).toContain("'status', 'conflict'")
  })

  it('does not use the reserved window keyword as a relation alias', () => {
    expect(sql).not.toMatch(/\)\s+window(?=\s|,)/)
    expect(sql).toContain("jsonb_array_elements(p_overrides->'foulwindows') foul_window")
  })

  it('emits metadata-only Basketball team audit events', () => {
    expect(sql).toContain("'basketball_settings_changed'")
    const metadata = sql.match(
      /p_metadata\s*=>\s*jsonb_build_object\(([\s\S]*?)\)\s*\n\s*\);/
    )?.[1]
    expect(metadata).toBeDefined()
    expect(Array.from(metadata?.matchAll(/'([^']+)'/g) ?? [], match => match[1])).toEqual([
      'sport_id',
      'revision',
      'changed_fields',
    ])
  })

  it('keeps SQL profile ids and versions aligned with the immutable catalog', () => {
    const profileIds = sql.match(/profileid' not in \(([\s\S]*?)\)/)?.[1]
    const profileVersion = sql.match(/profileversion'\)::integer <> (\d+)/)?.[1]
    expect(profileIds).toBeDefined()
    expect(profileVersion).toBeDefined()

    const sqlPairs = Array.from(
      profileIds?.matchAll(/'([^']+)'/g) ?? [],
      match => `${match[1]}@${profileVersion}`
    ).sort()
    const catalogPairs = listBasketballRulesProfiles()
      .map(profile => `${profile.profileId}@${profile.profileVersion}`)
      .sort()
    expect(sqlPairs).toEqual(catalogPairs)
  })

  it('advances the exact release capability contract to settings version 1', () => {
    expect(sql).toContain(
      'create or replace function public.get_basketball_release_capabilities()'
    )
    expect(sql).toContain("to_regclass('public.user_sport_settings')")
    expect(sql).toContain("to_regclass('public.team_sport_settings')")
    expect(sql).toContain(
      "to_regprocedure('public.save_basketball_user_settings_revisioned(bigint,jsonb)')"
    )
    expect(sql).toContain(
      "to_regprocedure('public.save_basketball_team_settings_revisioned(uuid,bigint,jsonb)')"
    )
    expect(sql).toContain("'contractversion', 2")
    expect(sql).toContain("'migration', 62")
    expect(sql).toContain("'settingscontractversion', 1")
    expect(sql).toContain("return jsonb_build_object('contractversion', 0)")
  })
})

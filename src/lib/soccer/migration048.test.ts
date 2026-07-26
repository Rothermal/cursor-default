import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/048_soccer_settings_foundation.sql'
  ),
  'utf8'
).toLowerCase()

describe('migration 048 sport settings contracts', () => {
  it('creates generic personal and team tables with read-only RLS access', () => {
    expect(sql).toContain('create table if not exists public.user_sport_settings')
    expect(sql).toContain('create table if not exists public.team_sport_settings')
    expect(sql).toContain('primary key (user_id, sport_id)')
    expect(sql).toContain('primary key (team_id, sport_id)')
    expect(sql).toContain('user_id = (select auth.uid())')
    expect(sql).toContain('public.current_team_role(team_id) is not null')
    expect(sql).toContain(
      'revoke all on table public.user_sport_settings from anon, authenticated'
    )
    expect(sql).toContain(
      'revoke all on table public.team_sport_settings from anon, authenticated'
    )
    expect(sql).not.toMatch(
      /grant (insert|update|delete|all) on table public\.(user|team)_sport_settings/
    )
  })

  it('validates soccer version one and rejects derived availability mirrors', () => {
    expect(sql).toContain("p_sport_id <> 'soccer'")
    expect(sql).toContain('p_schema_version <> 1')
    expect(sql).toContain("'extratimeavailable', 'shootoutavailable'")
    expect(sql).toContain('availability mirrors are derived from tieresolution')
    expect(sql).toContain('personal soccer rules must be complete')
    expect(sql).toContain('perform public._validate_soccer_segments')
  })

  it('uses revision-aware RPC-only writes and normalizes create collisions', () => {
    expect(sql).toContain(
      'create or replace function public.save_user_sport_settings_revisioned'
    )
    expect(sql).toContain(
      'create or replace function public.save_team_sport_settings_revisioned'
    )
    expect(sql).toContain('for update')
    expect(sql).toContain('on conflict (user_id, sport_id) do nothing')
    expect(sql).toContain('on conflict (team_id, sport_id) do nothing')
    expect(sql).toContain("'status', 'conflict'")
    expect(sql).toContain('revision = revision + 1')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
  })

  it('enforces active manager team writes and emits the existing audit event', () => {
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain(
      "coalesce(public.current_team_role(p_team_id), '') not in ('owner', 'admin')"
    )
    expect(sql).toContain('join public.seasons season on season.id = team.season_id')
    expect(sql).toContain("p_event_type => 'soccer_settings_changed'")
    expect(sql).toContain('public.record_access_audit_event')
    expect(sql).toContain("'changed_fields', v_changed_fields")
  })
})

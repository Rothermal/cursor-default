import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/049_soccer_release_capabilities.sql'),
  'utf8'
).toLowerCase()

describe('migration 049 Soccer release capability contract', () => {
  it('exposes one authenticated, active-access, read-only handshake', () => {
    expect(sql).toContain(
      'create or replace function public.get_soccer_release_capabilities()'
    )
    expect(sql).toContain('stable')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain(
      'grant execute on function public.get_soccer_release_capabilities() to authenticated'
    )
    expect(sql).not.toContain(
      'grant execute on function public.get_soccer_release_capabilities() to anon'
    )
  })

  it('fails closed unless the operational 043 through 048 boundary is present', () => {
    expect(sql).toContain("to_regclass('public.game_participants')")
    expect(sql).toContain("to_regclass('public.game_event_stream_checkpoints')")
    expect(sql).toContain("to_regclass('public.game_event_setup_snapshots')")
    expect(sql).toContain("to_regclass('public.game_event_conflicts')")
    expect(sql).toContain("to_regclass('public.game_event_primary_recorders')")
    expect(sql).toContain("to_regclass('public.game_event_primary_recorder_audit')")
    expect(sql).toContain("to_regclass('public.game_event_canonical_publications')")
    expect(sql).toContain("to_regclass('public.user_sport_settings')")
    expect(sql).toContain("to_regclass('public.team_sport_settings')")
    expect(sql).toContain(
      "'public.bind_soccer_event_game_v4(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)'"
    )
    expect(sql).toContain(
      "'public.get_soccer_scope_aggregate_publications(text,uuid,timestamptz,uuid,integer)'"
    )
    expect(sql).toContain(
      "'public.get_soccer_player_aggregate_publications(uuid,uuid,uuid,timestamptz,uuid,integer)'"
    )
    expect(sql).toContain(
      "'public.save_user_sport_settings_revisioned(text,integer,bigint,jsonb)'"
    )
    expect(sql).toContain(
      "'public.save_team_sport_settings_revisioned(uuid,text,integer,bigint,jsonb)'"
    )
    expect(sql).toContain("return jsonb_build_object('contractversion', 0)")
  })

  it('returns the exact current contract without product data writes', () => {
    expect(sql).toContain("'contractversion', 1")
    expect(sql).toContain("'migration', 49")
    expect(sql).toContain("'eventtransportversion', 4")
    expect(sql).toContain("'recoveryversion', 1")
    expect(sql).toContain("'recorderresolutionversion', 1")
    expect(sql).toContain("'canonicalfinalizationversion', 1")
    expect(sql).toContain("'aggregatesourceversion', 1")
    expect(sql).toContain("'settingsschemaversion', 1")
    expect(sql).not.toMatch(/\b(insert|update|delete|create table|alter table)\b/)
  })
})

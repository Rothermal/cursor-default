import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/061_basketball_release_capabilities.sql'),
  'utf8'
).toLowerCase()

describe('migration 061 Basketball release capability contract', () => {
  it('exposes one authenticated, active-access, read-only handshake', () => {
    expect(sql).toContain(
      'create or replace function public.get_basketball_release_capabilities()'
    )
    expect(sql).toContain('stable')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain(
      'grant execute on function public.get_basketball_release_capabilities() to authenticated'
    )
    expect(sql).not.toContain(
      'grant execute on function public.get_basketball_release_capabilities() to anon'
    )
  })

  it('fails closed unless the complete BKE-4 boundary is present', () => {
    for (const table of [
      'games',
      'game_participants',
      'game_events',
      'game_event_stream_checkpoints',
      'game_event_setup_snapshots',
      'game_event_conflicts',
      'game_event_primary_recorders',
      'game_event_primary_recorder_audit',
      'game_event_canonical_publications',
    ]) {
      expect(sql).toContain(`to_regclass('public.${table}')`)
    }
    for (const functionName of [
      'bind_basketball_event_game_v4',
      'upsert_game_event_revisioned',
      'record_game_event_conflict',
      'resolve_game_event_conflict',
      'confirm_game_event_stream_checkpoint',
      'get_basketball_game_recorders',
      'get_basketball_primary_recorder_history',
      'set_basketball_primary_recorder',
      'get_basketball_finalization_readiness',
      'get_basketball_canonical_publication',
      'get_basketball_primary_conflicts_for_finalization',
      'resolve_basketball_primary_conflict_for_finalization',
      'confirm_basketball_primary_checkpoint_for_finalization',
      'finalize_basketball_event_game',
      'get_basketball_canonical_publication_history',
      'reopen_basketball_event_game',
      'get_basketball_scope_aggregate_publications',
      'get_basketball_player_aggregate_publications',
      'get_basketball_scope_aggregate_legacy_games',
      'get_basketball_player_aggregate_legacy_games',
    ]) {
      expect(sql).toContain(`'public.${functionName}(`)
    }
    expect(sql).toContain("return jsonb_build_object('contractversion', 0)")
  })

  it('returns the exact current contract without product data writes', () => {
    expect(sql).toContain("'contractversion', 1")
    expect(sql).toContain("'migration', 61")
    expect(sql).toContain("'eventtransportversion', 4")
    expect(sql).toContain("'recoveryversion', 1")
    expect(sql).toContain("'recorderresolutionversion', 1")
    expect(sql).toContain("'canonicalfinalizationversion', 1")
    expect(sql).toContain("'summaryauthorityversion', 1")
    expect(sql).toContain("'aggregatesourceversion', 1")
    expect(sql).not.toMatch(/\b(insert|update|delete|create table|alter table)\b/)
  })

  it('does not alter the Soccer capability contract', () => {
    expect(sql).not.toContain('get_soccer_release_capabilities')
    expect(sql).not.toContain('bind_soccer_event_game_v4')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/055_event_platform_finalization_recovery.sql'
  ),
  'utf8'
).toLowerCase()

const expectPrivate = (functionName: string) => {
  expect(sql).toMatch(
    new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\s*\\(`
    )
  )
  expect(sql).not.toMatch(
    new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+to\\s+(?:authenticated|anon|public)`
    )
  )
}

describe('migration 055 event-platform finalization and recovery', () => {
  it('validates the staged publication check before replacing the old constraint', () => {
    const validateAt = sql.indexOf(
      'validate constraint game_event_canonical_publications_sport_id_event_platform_check'
    )
    const dropAt = sql.indexOf(
      'drop constraint game_event_canonical_publications_sport_id_check'
    )
    const renameAt = sql.indexOf(
      'rename constraint game_event_canonical_publications_sport_id_event_platform_check'
    )

    expect(validateAt).toBeGreaterThanOrEqual(0)
    expect(dropAt).toBeGreaterThan(validateAt)
    expect(renameAt).toBeGreaterThan(dropAt)
  })

  it('keeps Soccer terminal and score policy trusted on the server', () => {
    expect(sql).toContain(
      'create or replace function public.validate_soccer_finalization_policy'
    )
    expect(sql).toContain(
      "event.event_type in ('soccer.match_ended', 'soccer.match_reopened')"
    )
    expect(sql).toContain("v_terminal_event_type <> 'soccer.match_ended'")
    expect(sql).toContain("v_end_reason not in ('completed', 'abandoned')")
    expect(sql).toContain("event.payload->>'outcome' = 'goal'")
    expect(sql).toContain("then (event.payload->>'delta')::integer")
    expect(sql).toContain("if p_sport_id = 'soccer' then")
    expect(sql).toContain('public.validate_soccer_finalization_policy(')
    expect(sql).toContain(
      "raise exception 'trusted finalization policy is unavailable for %'"
    )
    expectPrivate('validate_soccer_finalization_policy')
    expectPrivate('finalize_event_game')
  })

  it('preserves permanent Soccer finalization and recovery wrappers', () => {
    expect(sql).toMatch(
      /select\s+public\.finalize_event_game\s*\(\s*'soccer'/
    )
    expect(sql).toMatch(
      /select\s+public\.reopen_event_game\s*\(\s*'soccer'/
    )
    expect(sql).toMatch(
      /select\s+\*\s+from\s+public\.get_event_finalization_readiness\s*\(\s*'soccer'/
    )
    expect(sql).toMatch(
      /select\s+\*\s+from\s+public\.get_event_canonical_publication\s*\(\s*'soccer'/
    )
    expect(sql).toMatch(
      /select\s+public\.bind_event_game_v4\s*\(\s*'soccer'/
    )
    expect(sql).not.toContain('finalize_basketball_event_game')
    expect(sql).not.toContain('bind_basketball_event_game_v4')
  })

  it('keeps publication history append-only through reasoned reopen', () => {
    expect(sql).toContain('select coalesce(max(publication.publication_number), 0) + 1')
    expect(sql).toContain('invalidation_reason = v_reason')
    expect(sql).toContain("if length(v_reason) < 3")
    expect(sql).toContain('locked_at = null')
    expect(sql).toContain("status = 'in_progress'")
    expect(sql).not.toContain(
      'delete from public.game_event_canonical_publications'
    )
  })

  it('requires canonical finalization only for Soccer and event-backed Basketball', () => {
    expect(sql).toContain(
      'create or replace function public.requires_canonical_event_finalization'
    )
    expect(sql).toContain("p_sport_id = 'soccer'")
    expect(sql).toContain('from public.game_event_setup_snapshots setup')
    expect(sql).toContain('and setup.sport_id = p_sport_id')
    expect(sql).toMatch(
      /public\.requires_canonical_event_finalization\s*\(\s*old\.sport_id\s*,\s*old\.id\s*\)/
    )
    expect(sql).toContain("status = 'final'")
    expect(sql).toContain("status = 'in_progress'")
    expectPrivate('requires_canonical_event_finalization')
  })

  it('neutralizes late non-primary audit upload and v4 finalized binding', () => {
    expect(sql).toContain(
      'create or replace function public.can_upload_final_event_audit'
    )
    expect(sql).toContain('p_recorded_by <> publication.primary_recorded_by')
    expect(sql).toContain('publication.sport_id = p_sport_id')
    expect(sql).toMatch(
      /public\.can_upload_final_event_audit\s*\(\s*v_game_sport_id/
    )
    expect(sql).toContain('only pre-finalization audit events may finish uploading')
    expect(sql).toContain("v_game.status = 'final'")
    expect(sql).toContain('and setup.sport_id = p_sport_id')
    expectPrivate('can_upload_final_event_audit')
    expectPrivate('bind_event_game_v4')
  })

  it('extracts sport-scoped manager conflict preparation and checkpoint confirmation', () => {
    expect(sql).toContain(
      'create or replace function public.get_event_primary_conflicts_for_finalization'
    )
    expect(sql).toContain(
      'create or replace function public.resolve_event_primary_conflict_for_finalization'
    )
    expect(sql).toContain(
      'create or replace function public.confirm_event_primary_checkpoint_for_finalization'
    )
    expect(sql).toContain("p_sport_id || '_primary_conflict_resolved'")
    expect(sql.match(/and event\.sport_id = p_sport_id/g)?.length).toBeGreaterThanOrEqual(5)
    expectPrivate('get_event_primary_conflicts_for_finalization')
    expectPrivate('resolve_event_primary_conflict_for_finalization')
    expectPrivate('confirm_event_primary_checkpoint_for_finalization')
  })

  it('hardens all functions and grants only existing public contracts', () => {
    const functionCount = sql.match(/create or replace function/g)?.length ?? 0
    expect(sql.match(/security definer/g)?.length).toBe(functionCount)
    expect(sql.match(/set search_path = public/g)?.length).toBe(functionCount)

    for (const functionName of [
      'can_manage_event_game',
      'can_manage_soccer_game',
      'can_upload_final_soccer_audit',
      'is_soccer_primary_stream_ended',
      'get_event_finalization_readiness',
      'get_event_canonical_publication',
      'reopen_event_game',
      'enforce_game_identity_and_final_state',
    ]) {
      expectPrivate(functionName)
    }

    for (const functionName of [
      'get_soccer_finalization_readiness',
      'get_soccer_canonical_publication',
      'finalize_soccer_event_game',
      'reopen_soccer_event_game',
      'bind_soccer_event_game_v4',
      'get_soccer_primary_conflicts_for_finalization',
      'resolve_soccer_primary_conflict_for_finalization',
      'confirm_soccer_primary_checkpoint_for_finalization',
      'upsert_game_event_revisioned',
      'record_game_event_conflict',
      'confirm_game_event_stream_checkpoint',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+to\\s+authenticated`
        )
      )
    }
  })
})

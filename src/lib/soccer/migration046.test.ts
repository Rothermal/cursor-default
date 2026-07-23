import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/046_soccer_finalization_recovery.sql'),
  'utf8'
).toLowerCase()

describe('migration 046 soccer finalization contracts', () => {
  it('stores append-only canonical publications behind game-scoped RLS', () => {
    expect(sql).toContain('create table public.game_event_canonical_publications')
    expect(sql).toContain('unique (game_id, publication_number)')
    expect(sql).toContain('idx_game_event_canonical_publication_active')
    expect(sql).toContain(
      'alter table public.game_event_canonical_publications enable row level security'
    )
    expect(sql).toContain('public.can_read_game(game_id)')
    expect(sql).toContain(
      'revoke all on table public.game_event_canonical_publications from anon, authenticated'
    )
  })

  it('locks one current primary and publishes final status transactionally', () => {
    expect(sql).toContain('create or replace function public.finalize_soccer_event_game')
    expect(sql).toContain('public.can_manage_soccer_game(p_game_id)')
    expect(sql).toContain('public.is_game_event_checkpoint_current')
    expect(sql).toContain(
      'v_checkpoint.event_revisions is distinct from p_event_revisions'
    )
    expect(sql).toContain(
      'canonical event content does not match the primary cloud stream'
    )
    expect(sql).toContain(
      'setup.setup_snapshot is not distinct from'
    )
    expect(sql).toContain('for share')
    expect(sql).toContain("projection,status}' <> 'ended'")
    expect(sql).toContain('snapshot_fingerprint')
    expect(sql).toContain("status = 'final'")
    expect(sql).toContain("'soccer_game_finalized'")
  })

  it('requires a reason and invalidates rather than deletes on reopen', () => {
    expect(sql).toContain('create or replace function public.reopen_soccer_event_game')
    expect(sql).toContain("if length(v_reason) < 3")
    expect(sql).toContain('invalidation_reason = v_reason')
    expect(sql).toContain('locked_at = null')
    expect(sql).toContain("update public.games set status = 'in_progress'")
    expect(sql).toContain("'soccer_game_reopened'")
    expect(sql).not.toContain('delete from public.game_event_canonical_publications')
  })

  it('permits only pre-finalization non-primary audit uploads', () => {
    expect(sql).toContain('create or replace function public.can_upload_final_soccer_audit')
    expect(sql).toContain('p_recorded_by <> publication.primary_recorded_by')
    expect(sql).toContain('create or replace function public.bind_soccer_event_game_v4')
    expect(sql).toContain("'game_status', v_game.status")
    expect(sql).toContain(
      'only pre-finalization audit events may finish uploading'
    )
    expect(sql).toContain(
      'and not public.can_upload_final_soccer_audit(p_game_id, v_user_id)'
    )
  })

  it('guards direct status changes and supports manager primary-conflict preparation', () => {
    expect(sql).toContain('soccer games must use canonical finalization')
    expect(sql).toContain(
      'create or replace function public.get_soccer_primary_conflicts_for_finalization'
    )
    expect(sql).toContain(
      'create or replace function public.resolve_soccer_primary_conflict_for_finalization'
    )
    expect(sql).toContain(
      'create or replace function public.confirm_soccer_primary_checkpoint_for_finalization'
    )
    expect(sql).toContain("'soccer_primary_conflict_resolved'")
  })
})

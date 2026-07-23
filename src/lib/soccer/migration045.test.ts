import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/045_soccer_recorder_resolution.sql'),
  'utf8'
).toLowerCase()

describe('migration 045 soccer recorder resolution contracts', () => {
  it('stores provisional primary selection and immutable history behind RLS', () => {
    expect(sql).toContain('create table public.game_event_primary_recorders')
    expect(sql).toContain('create table public.game_event_primary_recorder_audit')
    expect(sql).toContain('alter table public.game_event_primary_recorders enable row level security')
    expect(sql).toContain('alter table public.game_event_primary_recorder_audit enable row level security')
    expect(sql).toContain('public.can_read_game(game_id)')
    expect(sql).toContain(
      'revoke all on table public.game_event_primary_recorder_audit from anon, authenticated'
    )
  })

  it('selects only current conflict-free recorder checkpoints through a manager RPC', () => {
    expect(sql).toContain('create or replace function public.is_game_event_checkpoint_current')
    expect(sql).toContain('create or replace function public.effective_soccer_primary_recorder')
    expect(sql).toContain('create or replace function public.assign_default_soccer_primary_recorder')
    expect(sql).toContain('on_soccer_checkpoint_assign_primary')
    expect(sql).toContain("selection_source in ('default', 'selected')")
    expect(sql).toContain('create or replace function public.set_soccer_primary_recorder')
    expect(sql).toContain("public.current_team_role(v_game.team_id) in ('owner', 'admin')")
    expect(sql).toContain('primary recorder must have a current conflict-free checkpoint')
    expect(sql).toContain("'soccer_primary_recorder_changed'")
  })

  it('exposes read-only recorder presence and permits authorized independent binding', () => {
    expect(sql).toContain('create or replace function public.get_soccer_game_recorders')
    expect(sql).toContain('create or replace function public.get_soccer_primary_recorder_history')
    expect(sql).toContain('create or replace function public.bind_soccer_event_game_v3')
    expect(sql).toContain('if not public.can_track_game(v_game.id)')
    expect(sql).toContain('personal games cannot add another recorder')
  })
})

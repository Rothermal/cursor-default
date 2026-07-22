import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/043_soccer_event_cloud_transport.sql'),
  'utf8'
)

describe('migration 043 soccer event cloud contracts', () => {
  it('models personal games without silently creating a permanent team', () => {
    expect(sql).toContain('alter table public.games alter column team_id drop not null')
    expect(sql).toContain("cloud_scope in ('team', 'personal')")
    expect(sql).toContain("cloud_scope = 'personal' and team_id is null")
    expect(sql).toContain('create unique index if not exists idx_games_creator_local_game')
    expect(sql).not.toMatch(/insert into public\.teams/i)
    expect(sql).not.toMatch(/insert into public\.players/i)
  })

  it('keeps participant snapshots and checkpoints behind narrow RPCs', () => {
    expect(sql).toContain('create table public.game_participants')
    expect(sql).toContain('create table public.game_event_stream_checkpoints')
    expect(sql).toContain('revoke all on table public.game_participants from anon, authenticated')
    expect(sql).toContain('revoke all on table public.game_event_stream_checkpoints from anon, authenticated')
    expect(sql).toContain('public.bind_soccer_event_game')
    expect(sql).toContain('public.confirm_game_event_stream_checkpoint')
  })

  it('verifies the exact recorder revision set before confirming a checkpoint', () => {
    expect(sql).toContain('jsonb_array_length(p_event_revisions) <> p_event_count')
    expect(sql).toContain('v_cloud_count <> p_event_count')
    expect(sql).toContain('v_cloud_max_sequence <> p_max_sequence')
    expect(sql).toContain("(item->>'revision')::integer = ge.revision")
    expect(sql).toContain('recorded_by = v_user_id')
  })

  it('extends recorder writes to authorized personal and team games', () => {
    expect(sql).toContain('public.can_read_game')
    expect(sql).toContain('public.can_track_game')
    expect(sql).toContain("g.cloud_scope = 'personal' and g.created_by = (select auth.uid())")
    expect(sql).toContain('public.can_track_team_games(g.team_id)')
    expect(sql).toContain('create or replace function public.upsert_game_event_revisioned')
  })
})

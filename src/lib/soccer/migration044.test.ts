import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/044_soccer_event_recovery.sql'),
  'utf8'
).toLowerCase()

describe('migration 044 soccer recovery contracts', () => {
  it('stores setup snapshots and recorder conflicts behind RLS', () => {
    expect(sql).toContain('create table public.game_event_setup_snapshots')
    expect(sql).toContain('create table public.game_event_conflicts')
    expect(sql).toContain('alter table public.game_event_setup_snapshots enable row level security')
    expect(sql).toContain('alter table public.game_event_conflicts enable row level security')
    expect(sql).toContain('recorded_by = (select auth.uid())')
    expect(sql).toContain('revoke all on table public.game_event_conflicts from anon, authenticated')
  })

  it('binds immutable setup to an existing or new soccer cloud game', () => {
    expect(sql).toContain('create or replace function public.bind_soccer_event_game_v2')
    expect(sql).toContain('p_existing_game_id uuid')
    expect(sql).toContain('soccer setup snapshot cannot be replaced')
    expect(sql).toContain('public.bind_soccer_event_game(')
  })

  it('records and resolves only explicit same-recorder conflicts through RPCs', () => {
    expect(sql).toContain('create or replace function public.record_game_event_conflict')
    expect(sql).toContain('create or replace function public.resolve_game_event_conflict')
    expect(sql).toContain("status in ('open', 'resolved')")
    expect(sql).toContain("resolution in ('local', 'remote')")
    expect(sql).toContain('remote conflict revision is no longer current')
  })
})

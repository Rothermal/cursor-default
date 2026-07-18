import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/042_game_events.sql'),
  'utf8'
)

describe('migration 042 game event contracts', () => {
  it('creates recorder-owned event rows without a hard-delete policy', () => {
    expect(sql).toContain('create table if not exists public.game_events')
    expect(sql).toContain('recorded_by = (select auth.uid())')
    expect(sql).toContain('public.can_track_team_games(g.team_id)')
    expect(sql).toContain('public.current_team_role(g.team_id) is not null')
    expect(sql).not.toMatch(/create policy "game_events_delete/i)
  })

  it('implements applied, idempotent, stale, and conflict revision results', () => {
    expect(sql).toContain('upsert_game_event_revisioned')
    expect(sql).toContain('game_events.revision < excluded.revision')
    expect(sql).toContain('game_events.stream_sequence = excluded.stream_sequence')
    expect(sql).toContain('game_events.event_created_at = excluded.event_created_at')
    expect(sql).toContain("return 'idempotent'")
    expect(sql).toContain("return 'stale'")
    expect(sql).toContain("return 'conflict'")
  })
})

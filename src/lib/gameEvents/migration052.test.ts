import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/052_event_platform_recovery.sql'),
  'utf8'
).toLowerCase()
const privateV2Grant =
  /grant\s+execute\s+on\s+function\s+public\.bind_event_game_v2\s*\(\s*text\s*,\s*uuid\s*,\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*date\s*,\s*jsonb\s*,\s*jsonb\s*\)\s+to\s+(?:authenticated|anon|public)/
const soccerV2Grant =
  /grant\s+execute\s+on\s+function\s+public\.bind_soccer_event_game_v2\s*\(\s*uuid\s*,\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*date\s*,\s*jsonb\s*,\s*jsonb\s*\)\s+to\s+authenticated/
const recordConflictGrant =
  /grant\s+execute\s+on\s+function\s+public\.record_game_event_conflict\s*\(\s*uuid\s*,\s*uuid\s*,\s*jsonb\s*,\s*jsonb\s*\)\s+to\s+authenticated/
const resolveConflictGrant =
  /grant\s+execute\s+on\s+function\s+public\.resolve_game_event_conflict\s*\(\s*uuid\s*,\s*text\s*,\s*jsonb\s*\)\s+to\s+authenticated/

describe('migration 052 event-platform recovery', () => {
  it('extracts immutable setup recovery into a private sport-neutral core', () => {
    expect(sql).toContain('create or replace function public.bind_event_game_v2')
    expect(sql).toContain('if not public.is_event_platform_sport(p_sport_id)')
    expect(sql).toContain("p_setup_snapshot->>'version' <> '1'")
    expect(sql).toContain('and game.sport_id = p_sport_id')
    expect(sql).toContain('v_binding := public.bind_event_game(')
    expect(sql).toContain('game_event_setup_snapshots.sport_id = excluded.sport_id')
    expect(sql).toContain(
      'game_event_setup_snapshots.setup_snapshot is not distinct from'
    )
    expect(sql).toContain('if not coalesce(v_setup_written, false)')
    expect(sql).not.toMatch(privateV2Grant)
  })

  it('retains the authenticated Soccer v2 signature as a fixed wrapper', () => {
    expect(sql).toContain('create or replace function public.bind_soccer_event_game_v2')
    expect(sql).toMatch(/select\s+public\.bind_event_game_v2\s*\(\s*'soccer'/)
    expect(sql).toMatch(soccerV2Grant)
  })

  it('preserves latest conflict recording with a Soccer-only final audit exception', () => {
    expect(sql).toContain('create or replace function public.record_game_event_conflict')
    expect(sql).toContain('select game.sport_id into v_game_sport_id')
    expect(sql).toContain("v_game_sport_id = 'soccer'")
    expect(sql).toContain('public.can_upload_final_soccer_audit(p_game_id, v_user_id)')
    expect(sql).toContain('remote conflict revision is no longer current')
    expect(sql).toContain('and event.recorded_by = v_user_id')
    expect(sql).toContain('on conflict do nothing')
  })

  it('keeps conflict resolution recorder-owned, idempotent, and sport-bounded', () => {
    expect(sql).toContain('create or replace function public.resolve_game_event_conflict')
    expect(sql).toContain('and conflict.recorded_by = v_user_id')
    expect(sql).toContain('if found and not public.is_event_platform_sport')
    expect(sql).toContain("p_resolution not in ('local', 'remote')")
    expect(sql).toContain('conflict.resolved_event is not distinct from p_resolved_event')
    expect(sql).toMatch(resolveConflictGrant)
  })

  it('hardens every security-definer function and exposes only compatibility RPCs', () => {
    expect(sql.match(/security definer/g)?.length).toBe(4)
    expect(sql.match(/set search_path = public/g)?.length).toBe(4)
    expect(sql).toMatch(recordConflictGrant)
    expect(sql).toMatch(resolveConflictGrant)
    expect(sql).toMatch(soccerV2Grant)
    expect(sql).not.toMatch(privateV2Grant)
  })
})

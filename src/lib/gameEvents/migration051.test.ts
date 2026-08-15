import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/051_event_platform_cloud_transport.sql'),
  'utf8'
).toLowerCase()

describe('migration 051 event-platform cloud transport', () => {
  it('validates the staged side check before replacing the old constraint', () => {
    const validateAt = sql.indexOf(
      'validate constraint game_events_team_side_event_platform_check'
    )
    const dropAt = sql.indexOf('drop constraint game_events_team_side_check')
    const renameAt = sql.indexOf(
      'rename constraint game_events_team_side_event_platform_check'
    )

    expect(validateAt).toBeGreaterThan(-1)
    expect(dropAt).toBeGreaterThan(validateAt)
    expect(renameAt).toBeGreaterThan(dropAt)
    expect(sql).toContain('to game_events_team_side_check')
  })

  it('keeps one private explicit event-platform sport allow-list', () => {
    expect(sql).toContain('create or replace function public.is_event_platform_sport')
    expect(sql).toContain("p_sport_id in ('soccer', 'basketball')")
    expect(sql).toContain(
      'revoke all on function public.is_event_platform_sport(text) from public'
    )
    expect(sql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.is_event_platform_sport\s*\(\s*text\s*\)\s+to\s+(?:authenticated|anon|public)/
    )
  })

  it('extracts a private neutral binder behind the permanent Soccer signature', () => {
    expect(sql).toContain('create or replace function public.bind_event_game')
    expect(sql).toContain('if not public.is_event_platform_sport(p_sport_id)')
    expect(sql).toContain('and game.sport_id = p_sport_id')
    expect(sql).toContain('trim(p_client_local_game_id), p_sport_id, trim(p_team_name)')
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.bind_event_game\s*\(\s*text\s*,\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*date\s*,\s*jsonb\s*\)\s+from\s+public/
    )
    expect(sql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.bind_event_game\s*\(\s*text\s*,\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*date\s*,\s*jsonb\s*\)\s+to\s+(?:authenticated|anon|public)/
    )
    expect(sql).toContain('create or replace function public.bind_soccer_event_game')
    expect(sql).toMatch(/select\s+public\.bind_event_game\s*\(\s*'soccer'/)
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.bind_soccer_event_game\s*\(\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*date\s*,\s*jsonb\s*\)\s+to\s+authenticated/
    )
  })

  it('preserves the final Soccer audit exception in the current revision writer', () => {
    expect(sql).toContain('create or replace function public.upsert_game_event_revisioned')
    expect(sql).toContain('for share')
    expect(sql).toContain('p_sport_id is distinct from v_game_sport_id')
    expect(sql).toContain("v_game_sport_id <> 'soccer'")
    expect(sql).toContain('public.can_upload_final_soccer_audit(p_game_id, v_user_id)')
    expect(sql).toContain('publication.invalidated_at is null')
    expect(sql).toContain('only pre-finalization audit events may finish uploading')
    expect(sql).toContain('game_events.revision < excluded.revision')
    expect(sql).toContain("then return 'idempotent'")
  })

  it('preserves exact checkpoint verification and finalized Soccer audit uploads', () => {
    expect(sql).toContain(
      'create or replace function public.confirm_game_event_stream_checkpoint'
    )
    expect(sql).toContain('jsonb_array_length(p_event_revisions) <> p_event_count')
    expect(sql).toContain("group by item->>'id'")
    expect(sql).toContain('v_cloud_count <> p_event_count')
    expect(sql).toContain('v_cloud_max_sequence <> p_max_sequence')
    expect(sql).toContain("(item->>'revision')::integer = event.revision")
    expect(sql).toContain("v_game_sport_id = 'soccer'")
    expect(sql).toContain('public.can_upload_final_soccer_audit(p_game_id, v_user_id)')
  })

  it('retains hardened function ownership and authenticated entry-point grants', () => {
    expect(sql.match(/security definer/g)?.length).toBeGreaterThanOrEqual(4)
    expect(sql.match(/set search_path = public/g)?.length).toBeGreaterThanOrEqual(5)
    expect(sql).toContain(
      'grant execute on function public.upsert_game_event_revisioned('
    )
    expect(sql).toContain(
      'grant execute on function public.confirm_game_event_stream_checkpoint('
    )
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/053_event_platform_recorder_resolution.sql'
  ),
  'utf8'
).toLowerCase()

const expectPrivate = (functionName: string) => {
  const revoke = new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\s*\\(`
  )
  const grant = new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+to\\s+(?:authenticated|anon|public)`
  )
  expect(sql).toMatch(revoke)
  expect(sql).not.toMatch(grant)
}

describe('migration 053 event-platform recorder resolution', () => {
  it('extracts exact checkpoint health behind the existing generic helper', () => {
    expect(sql).toContain('create or replace function public.is_event_checkpoint_current')
    expect(sql).toContain('and game.sport_id = p_sport_id')
    expect(sql).toContain('checkpoint.event_count = (')
    expect(sql).toContain('checkpoint.max_sequence = (')
    expect(sql).toContain("item->>'id' = event.id::text")
    expect(sql).toContain("conflict.status = 'open'")
    expect(sql).toContain(
      'create or replace function public.is_game_event_checkpoint_current'
    )
    expect(sql).toMatch(
      /select\s+public\.is_event_checkpoint_current\s*\(\s*game\.sport_id/
    )
    expectPrivate('is_event_checkpoint_current')
  })

  it('preserves selected, creator, and deterministic healthy primary ordering', () => {
    expect(sql).toContain(
      'create or replace function public.effective_event_primary_recorder'
    )
    expect(sql).toContain('if found then return v_primary; end if')
    expect(sql).toContain(
      'public.is_event_checkpoint_current(p_sport_id, p_game_id, v_creator)'
    )
    expect(sql).toContain(
      'order by checkpoint.synced_at, checkpoint.recorded_by'
    )
    expect(sql).toContain(
      'create or replace function public.effective_soccer_primary_recorder'
    )
    expect(sql).toContain(
      "public.effective_event_primary_recorder('soccer', p_game_id)"
    )
    expectPrivate('effective_event_primary_recorder')
  })

  it('retains recorder presence columns and owner/admin selection authority', () => {
    expect(sql).toContain('create or replace function public.get_event_game_recorders')
    expect(sql).toContain('checkpoint_event_count integer')
    expect(sql).toContain('unresolved_conflict_count integer')
    expect(sql).toContain('can_select_primary boolean')
    expect(sql).toContain(
      "public.current_team_role(v_game.team_id) in ('owner', 'admin')"
    )
    expect(sql).toContain(
      'create or replace function public.set_event_primary_recorder'
    )
    expect(sql).toContain(
      'primary recorder must have a current conflict-free checkpoint'
    )
    expect(sql).toContain("p_sport_id || '_primary_recorder_changed'")
    expect(sql).toContain(
      'insert into public.game_event_primary_recorder_audit'
    )
    expectPrivate('get_event_game_recorders')
    expectPrivate('set_event_primary_recorder')
  })

  it('keeps history immutable and exposed through fixed Soccer wrappers', () => {
    expect(sql).toContain(
      'create or replace function public.get_event_primary_recorder_history'
    )
    expect(sql).toContain('order by audit.changed_at desc, audit.id desc')
    expect(sql).toContain(
      "public.get_event_primary_recorder_history('soccer', p_game_id)"
    )
    expect(sql).toContain(
      "public.get_event_game_recorders('soccer', p_game_id)"
    )
    expect(sql).toContain(
      "public.set_event_primary_recorder('soccer', p_game_id, p_recorded_by)"
    )
    expectPrivate('get_event_primary_recorder_history')
  })

  it('extracts v3 binding without blending streams or surrendering creator metadata', () => {
    expect(sql).toContain('create or replace function public.bind_event_game_v3')
    expect(sql).toContain('return public.bind_event_game_v2(')
    expect(sql).toContain('and game.sport_id = p_sport_id')
    expect(sql).toContain('and setup.sport_id = p_sport_id')
    expect(sql).toContain('if not public.can_track_game(v_game.id)')
    expect(sql).toContain('personal games cannot add another recorder')
    expect(sql).toContain('if v_game.created_by = v_user_id then')
    expect(sql).toContain(
      'snapshot = public.game_participants.snapshot'
    )
    expect(sql).toContain('create or replace function public.bind_soccer_event_game_v3')
    expect(sql).toMatch(/select\s+public\.bind_event_game_v3\s*\(\s*'soccer'/)
    expectPrivate('bind_event_game_v3')
  })

  it('hardens every function and grants only the shipped Soccer entry points', () => {
    expect(sql.match(/security definer/g)?.length).toBe(12)
    expect(sql.match(/set search_path = public/g)?.length).toBe(12)

    for (const functionName of [
      'is_event_checkpoint_current',
      'is_game_event_checkpoint_current',
      'effective_event_primary_recorder',
      'effective_soccer_primary_recorder',
      'get_event_game_recorders',
      'get_event_primary_recorder_history',
      'set_event_primary_recorder',
      'bind_event_game_v3',
    ]) {
      expectPrivate(functionName)
    }

    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.get_soccer_game_recorders\s*\(\s*uuid\s*\)\s+to\s+authenticated/
    )
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.get_soccer_primary_recorder_history\s*\(\s*uuid\s*\)\s+to\s+authenticated/
    )
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.set_soccer_primary_recorder\s*\(\s*uuid\s*,\s*uuid\s*\)\s+to\s+authenticated/
    )
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.bind_soccer_event_game_v3\s*\(\s*uuid\s*,\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*date\s*,\s*jsonb\s*,\s*jsonb\s*\)\s+to\s+authenticated/
    )
  })
})

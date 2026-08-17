import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/057_basketball_recorder_finalization_contracts.sql'
  ),
  'utf8'
).replace(/\r\n/g, '\n').toLowerCase()

const expectAuthenticated = (functionName: string) => {
  expect(sql).toMatch(new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+from\\s+public`
  ))
  expect(sql).toMatch(new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+to\\s+authenticated`
  ))
}

const expectPrivate = (functionName: string) => {
  expect(sql).toMatch(new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+from\\s+public`
  ))
  expect(sql).not.toMatch(new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+to\\s+(?:authenticated|anon|public)`
  ))
}

describe('migration 057 Basketball recorder and finalization contracts', () => {
  it('adds fixed Basketball recorder and primary-selection wrappers', () => {
    expect(sql).toContain('create or replace function public.get_basketball_game_recorders')
    expect(sql).toContain("public.get_event_game_recorders('basketball', p_game_id)")
    expect(sql).toContain('case when v_can_manage then recorder.event_count')
    expect(sql).toContain('case when v_can_manage then recorder.checkpoint_synced_at')
    expect(sql).toContain('case when v_can_manage then recorder.unresolved_conflict_count')
    expect(sql).toContain(
      "if not public.can_manage_event_game('basketball', p_game_id) then"
    )
    expect(sql).toContain(
      "public.get_event_primary_recorder_history(\n    'basketball'"
    )
    expect(sql).toContain("public.set_event_primary_recorder(\n    'basketball'")
  })

  it('keeps Soccer readiness intact and installs Basketball terminal dispatch', () => {
    expect(sql).toContain('create or replace function public.get_event_finalization_readiness')
    expect(sql).toContain("if p_sport_id = 'soccer' then")
    expect(sql).toContain('public.is_soccer_primary_stream_ended')
    expect(sql).toContain("elsif p_sport_id = 'basketball' then")
    expect(sql).toContain('public.is_basketball_primary_stream_ended')
    expect(sql).toContain("event.event_type = 'basketball.match_ended'")
    expect(sql).toContain("event.payload->>'reason' in ('completed', 'abandoned')")
    expect(sql).toContain("public.get_event_finalization_readiness(\n    'basketball'")
  })

  it('adds every manager preparation wrapper without enabling finalization early', () => {
    expect(sql).toContain("public.get_event_canonical_publication(\n    'basketball'")
    expect(sql).toContain(
      "public.get_event_primary_conflicts_for_finalization(\n    'basketball'"
    )
    expect(sql).toContain(
      "public.resolve_event_primary_conflict_for_finalization(\n    'basketball'"
    )
    expect(sql).toContain(
      "public.confirm_event_primary_checkpoint_for_finalization(\n    'basketball'"
    )
    expect(sql).not.toContain('create or replace function public.finalize_basketball_event_game')
    expect(sql).not.toContain('create or replace function public.reopen_basketball_event_game')
    expect(sql).not.toContain('create or replace function public.finalize_event_game')
  })

  it('validates trusted Basketball terminal and scoring semantics', () => {
    expect(sql).toContain(
      'create or replace function public.validate_basketball_finalization_policy'
    )
    expect(sql).toContain("event.event_type in (\n      'basketball.match_ended'")
    expect(sql).toContain('v_end_reason is null')
    expect(sql).toContain("v_end_reason not in ('completed', 'abandoned')")
    expect(sql).toContain("event.event_type = 'basketball.shot'")
    expect(sql).toContain("event.event_type = 'basketball.score_adjustment'")
    expect(sql).toContain("event.team_side not in ('tracked', 'opponent')")
    expect(sql).toContain("event.payload->>'attempt' = 'free_throw'")
    expect(sql).toContain("event.payload->>'attempt' = 'field_goal'")
    expect(sql).toContain("event.payload->>'valuesource' is null")
    expect(sql).toContain("and (event.payload->>'made')::boolean")
    expect(sql).toContain('v_tracked_score < 0')
    expect(sql).toContain("v_end_reason = 'completed' and v_tracked_score = v_opponent_score")
    expect(sql).toContain('a tied basketball game requires another overtime')
  })

  it('hardens private policy and grants only fixed Basketball preparation functions', () => {
    for (const functionName of [
      'is_basketball_primary_stream_ended',
      'get_event_finalization_readiness',
      'validate_basketball_finalization_policy',
    ]) expectPrivate(functionName)

    for (const functionName of [
      'get_basketball_game_recorders',
      'get_basketball_primary_recorder_history',
      'set_basketball_primary_recorder',
      'get_basketball_finalization_readiness',
      'get_basketball_canonical_publication',
      'get_basketball_primary_conflicts_for_finalization',
      'resolve_basketball_primary_conflict_for_finalization',
      'confirm_basketball_primary_checkpoint_for_finalization',
    ]) expectAuthenticated(functionName)

    const functionCount = sql.match(/create or replace function/g)?.length ?? 0
    expect(sql.match(/security definer/g)?.length).toBe(functionCount)
    expect(sql.match(/set search_path = public/g)?.length).toBe(functionCount)
  })
})

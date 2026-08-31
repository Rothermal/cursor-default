import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASKETBALL_ANCHORED_FINALIZATION_BLOCKER_ORDER } from './anchoredFinalization'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/064_basketball_anchored_finalization_reopen.sql'),
  'utf8'
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration 064 Basketball anchored finalization and reopen', () => {
  it('adds fixed anchored contracts without replacing old public Basketball wrappers', () => {
    expect(sql).toContain('get_basketball_anchored_finalization_readiness_v1')
    expect(sql).toContain('finalize_basketball_anchored_event_game_v1')
    expect(sql).toContain('reopen_basketball_anchored_event_game_v1')
    expect(sql).toContain('get_basketball_reopen_handoff_v1')
    expect(sql).not.toContain('create or replace function public.reopen_basketball_event_game(')
    expect(sql).not.toContain('create or replace function public.finalize_basketball_event_game(')
  })

  it('keeps private cores private and grants only fixed authenticated wrappers', () => {
    expect(sql).toContain(
      'revoke all on function public._basketball_anchored_finalization_blockers_v1(uuid, uuid) from public'
    )
    expect(sql).not.toContain(
      'grant execute on function public._basketball_anchored_finalization_blockers_v1'
    )
    expect(sql).not.toContain(' to anon')
    for (const name of [
      'get_basketball_anchored_finalization_readiness_v1(uuid, uuid)',
      'finalize_basketball_anchored_event_game_v1(uuid, uuid, jsonb, text, jsonb)',
      'reopen_basketball_anchored_event_game_v1(uuid, text, text)',
      'get_basketball_canonical_publication_history_v1(uuid)',
      'get_basketball_reopen_handoff_v1(uuid)',
    ]) {
      expect(sql).toContain(`grant execute on function public.${name} to authenticated`)
    }
  })

  it('stores exact reopen modes and preserves mode-less legacy semantics', () => {
    expect(sql).toContain("invalidation_mode in ('correct_records', 'resume_game')")
    expect(sql).toContain("event.payload->>'mode' = 'correct_records'")
    expect(sql).toContain("p_mode not in ('correct_records', 'resume_game')")
    expect(sql).toContain("'mode', p_mode")
  })

  it('requires both existing Basketball capabilities for anchored mutations', () => {
    expect(sql.match(/perform public\.get_basketball_release_capabilities\(\);/g)).toHaveLength(2)
    expect(sql.match(/perform public\.get_basketball_clock_lineup_capabilities_v1\(\);/g)).toHaveLength(2)
    expect(sql).not.toContain('soccer')
  })

  it('keeps the server blocker catalog in the client presentation order', () => {
    const positions = BASKETBALL_ANCHORED_FINALIZATION_BLOCKER_ORDER.map(code => {
      const position = sql.indexOf(`array_append(v_blockers, '${code}')`)
      expect(position, `missing server blocker ${code}`).toBeGreaterThanOrEqual(0)
      return position
    })
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('validates persisted clock payload anchors independently of paused state', () => {
    expect(sql).toContain("event.event_type = 'basketball.clock_started'")
    expect(sql).toContain("(event.payload->>'anchorelapsedms')::numeric <> event.elapsed_ms")
    expect(sql).toContain("(event.payload->>'elapsedms')::numeric <> event.elapsed_ms")
    expect(sql).toContain("(event.payload->>'toelapsedms')::numeric <> event.elapsed_ms")
  })
})

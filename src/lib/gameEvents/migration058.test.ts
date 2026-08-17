import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/058_basketball_canonical_finalization.sql'),
  'utf8'
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration 058 Basketball canonical finalization', () => {
  it('adds only the fixed authenticated Basketball finalization surface', () => {
    expect(sql).toContain('create or replace function public.finalize_basketball_event_game')
    expect(sql).toMatch(
      /return\s+public\.finalize_event_game\s*\(\s*'basketball'/
    )
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.finalize_basketball_event_game\s*\(\s*uuid\s*,\s*uuid\s*,\s*jsonb\s*,\s*text\s*,\s*jsonb\s*\)\s+from\s+public/
    )
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.finalize_basketball_event_game\s*\(\s*uuid\s*,\s*uuid\s*,\s*jsonb\s*,\s*text\s*,\s*jsonb\s*\)\s+to\s+authenticated/
    )
    expect(sql).not.toContain('create or replace function public.reopen_basketball_event_game')
  })

  it('rejects missing or unsupported Basketball canonical payload schemas before delegation', () => {
    const wrapperStart = sql.indexOf(
      'create or replace function public.finalize_basketball_event_game'
    )
    const wrapper = sql.slice(wrapperStart)
    const schemaCheck = wrapper.indexOf(
      "p_canonical_snapshot->>'canonicalschemaversion' is distinct from '1'"
    )
    const delegation = wrapper.indexOf("public.finalize_event_game(\n    'basketball'")

    expect(schemaCheck).toBeGreaterThanOrEqual(0)
    expect(delegation).toBeGreaterThan(schemaCheck)
    expect(wrapper).toContain(
      "jsonb_typeof(p_canonical_snapshot) is distinct from 'object'"
    )
    expect(wrapper).toContain('unsupported basketball canonical payload schema version')
  })

  it('preserves Soccer policy and adds trusted Basketball policy dispatch', () => {
    expect(sql).toContain("if p_sport_id = 'soccer' then")
    expect(sql).toContain('public.validate_soccer_finalization_policy(')
    expect(sql).toContain("elsif p_sport_id = 'basketball' then")
    expect(sql).toContain('public.validate_basketball_finalization_policy(')
    expect(sql).toContain("raise exception 'trusted finalization policy is unavailable for %'")
  })

  it('retains the shared locking, stale rejection, idempotency, score, and audit transaction', () => {
    expect(sql).toContain('from public.games game')
    expect(sql).toContain('for update;')
    expect(sql).toContain('primary recorder changed; refresh finalization readiness')
    expect(sql).toContain('primary recorder changed; reload before finalizing')
    expect(sql).toContain('canonical event content does not match the primary cloud stream')
    expect(sql).toContain("status = 'final'")
    expect(sql).toContain('home_team_score = v_tracked_score')
    expect(sql).toContain("p_sport_id || '_game_finalized'")
    expect(sql).toContain('select coalesce(max(publication.publication_number), 0) + 1')
    expect(sql).toContain('v_publication.canonical_snapshot is not distinct from p_canonical_snapshot')
    expect(sql).not.toContain('delete from public.game_event_canonical_publications')
  })

  it('keeps the shared mutation core private and hardens both replaced functions', () => {
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.finalize_event_game\s*\(\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*jsonb\s*,\s*text\s*,\s*jsonb\s*\)\s+from\s+public/
    )
    expect(sql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.finalize_event_game/
    )
    expect(sql.match(/create or replace function/g)).toHaveLength(2)
    expect(sql.match(/security definer/g)).toHaveLength(2)
    expect(sql.match(/set search_path = public/g)).toHaveLength(2)
  })
})

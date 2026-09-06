import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/069_soccer_setup_v2_compatibility.sql'),
  'utf8'
).toLowerCase()

describe('migration 069 setup compatibility', () => {
  it('allows only reviewed Soccer and Basketball setup versions', () => {
    expect(sql).toContain("p_sport_id = 'soccer' and p_setup_snapshot->>'version' in ('1', '2')")
    expect(sql).toContain("p_sport_id = 'basketball' and p_setup_snapshot->>'version' in ('1', '2')")
    expect(sql).toContain("or not (")
    expect(sql).toContain("raise exception '% setup snapshot is invalid'")
  })

  it('keeps the generic binder private and immutable', () => {
    expect(sql).toContain('create or replace function public.bind_event_game_v2')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
    expect(sql).toContain('setup_snapshot is not distinct from')
    expect(sql).toContain('setup snapshot cannot be replaced')
    expect(sql).toContain('revoke all on function public.bind_event_game_v2')
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.bind_event_game_v2/)
  })

  it('publishes an exact authenticated setup-v2 capability', () => {
    expect(sql).toContain('create or replace function public.get_soccer_release_capabilities()')
    expect(sql).toContain("'contractversion', 2")
    expect(sql).toContain("'migration', 69")
    expect(sql).toContain("'setupsnapshotversion', 2")
    expect(sql).toContain('grant execute on function public.get_soccer_release_capabilities() to authenticated')
    expect(sql).not.toContain('grant execute on function public.get_soccer_release_capabilities() to anon')
  })
})

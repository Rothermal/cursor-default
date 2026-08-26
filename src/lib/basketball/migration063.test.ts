import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/063_basketball_clock_lineup_foundation.sql'),
  'utf8'
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration 063 Basketball clock and lineup foundation', () => {
  it('extends the private settings validator without altering the base release contract', () => {
    expect(sql).toContain('rename to _validate_basketball_rule_overrides_v2')
    expect(sql).toContain('basketball clock and lineup overrides must be saved together')
    expect(sql).toContain("'clockdisplaydirection'")
    expect(sql).toContain("'equalplaypolicy'")
    expect(sql).not.toContain(
      'create or replace function public.get_basketball_release_capabilities()'
    )
  })

  it('exposes only the fixed authenticated feature capability', () => {
    expect(sql).toContain(
      'create or replace function public.get_basketball_clock_lineup_capabilities_v1()'
    )
    expect(sql).toContain("jsonb_build_object('clockandlineupsversion', 1)")
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain(
      'grant execute on function public.get_basketball_clock_lineup_capabilities_v1() to authenticated'
    )
    expect(sql).not.toContain(
      'grant execute on function public.get_basketball_clock_lineup_capabilities_v1() to anon'
    )
    expect(sql).not.toContain('soccer')
  })
})

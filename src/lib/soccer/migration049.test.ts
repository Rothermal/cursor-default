import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/049_soccer_release_capabilities.sql'),
  'utf8'
).toLowerCase()

describe('migration 049 Soccer release capability contract', () => {
  it('exposes one authenticated, active-access, read-only handshake', () => {
    expect(sql).toContain(
      'create or replace function public.get_soccer_release_capabilities()'
    )
    expect(sql).toContain('stable')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain(
      'grant execute on function public.get_soccer_release_capabilities() to authenticated'
    )
    expect(sql).not.toContain(
      'grant execute on function public.get_soccer_release_capabilities() to anon'
    )
  })

  it('returns the exact versioned 043 through 049 boundary without product data writes', () => {
    expect(sql).toContain("'contractversion', 1")
    expect(sql).toContain("'migration', 49")
    expect(sql).toContain("'eventtransportversion', 4")
    expect(sql).toContain("'recoveryversion', 1")
    expect(sql).toContain("'recorderresolutionversion', 1")
    expect(sql).toContain("'canonicalfinalizationversion', 1")
    expect(sql).toContain("'aggregatesourceversion', 1")
    expect(sql).toContain("'settingsschemaversion', 1")
    expect(sql).not.toMatch(/\b(insert|update|delete|create table|alter table)\b/)
  })
})

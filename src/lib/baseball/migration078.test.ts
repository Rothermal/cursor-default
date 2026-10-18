import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8').replace(/\r\n/g, '\n')
}
function definition(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('\n$$;', start) + 4)
}
const source055 = migration('055_event_platform_finalization_recovery.sql')
const source077 = migration('077_baseball_event_cloud_lifecycle.sql')
const sql = migration('078_baseball_initial_event_revisions.sql')
const originalGate = `  if p_revision <> 1 and not exists (
    select 1 from public.game_events event where event.id = p_id
  ) then return 'conflict'; end if;`
const repairedGate = `  if p_revision <> 1 and not exists (
    select 1 from public.game_events event where event.id = p_id
  ) and not (
    p_revision > 1
    and v_game_sport_id = 'baseball'
    and exists (
      select 1
      from public.game_event_setup_snapshots setup
      where setup.game_id = p_game_id
        and setup.sport_id = 'baseball'
        and setup.setup_snapshot->'version' = '1'::jsonb
    )
  ) then return 'conflict'; end if;`

describe('migration 078 actual first-upload Baseball revisions', () => {
  it('changes only the absent-row gate in the migration-055 writer', () => {
    const original = definition(source055, 'upsert_game_event_revisioned')
    expect(original).toContain(originalGate)
    expect(definition(sql, 'upsert_game_event_revisioned')).toBe(original.replace(originalGate, repairedGate))
  })
  it('advances only the Baseball capability contract and migration', () => {
    expect(definition(sql, 'get_baseball_release_capabilities')).toBe(
      definition(source077, 'get_baseball_release_capabilities')
        .replace("'contractVersion', 1,", "'contractVersion', 2,")
        .replace("'migration', 77,", "'migration', 78,")
    )
    expect(sql.match(/create or replace function/g)).toHaveLength(2)
  })
  it('retains authenticated-only writer grants and does not mutate saved events', () => {
    const start = source055.indexOf('revoke all on function public.upsert_game_event_revisioned(')
    const end = source055.indexOf('revoke all on function public.record_game_event_conflict(', start)
    expect(sql).toContain(source055.slice(start, end).trim())
    expect(sql).toContain('revoke all on function public.get_baseball_release_capabilities() from public;')
    expect(sql).toContain('grant execute on function public.get_baseball_release_capabilities() to authenticated;')
    expect(sql).not.toMatch(/to anon|alter table|delete from public\.game_events|update public\.game_events/)
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true)
  })
})

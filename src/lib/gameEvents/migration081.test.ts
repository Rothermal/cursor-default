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
const oldWriter = migration('078_baseball_initial_event_revisions.sql')
const oldRecorders = migration('053_event_platform_recorder_resolution.sql')
const sql = migration('081_event_sync_revision_and_recorder_recovery.sql')
const oldGate = `  if p_revision <> 1 and not exists (
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
const newGate = `  if p_revision <> 1 and not exists (
    select 1 from public.game_events event where event.id = p_id
  ) and not (
    p_revision > 1
    and exists (
      select 1
      from public.game_event_setup_snapshots setup
      where setup.game_id = p_game_id
        and setup.sport_id = v_game_sport_id
        and (
          (v_game_sport_id in ('soccer', 'basketball')
            and setup.setup_snapshot->'version' in ('1'::jsonb, '2'::jsonb))
          or (v_game_sport_id in ('hockey', 'baseball')
            and setup.setup_snapshot->'version' = '1'::jsonb)
        )
    )
  ) then return 'conflict'; end if;`

describe('migration 081 event sync and pending recorder recovery', () => {
  it('changes only the absent-row gate in the current revisioned writer', () => {
    const previous = definition(oldWriter, 'upsert_game_event_revisioned')
    expect(previous).toContain(oldGate)
    expect(definition(sql, 'upsert_game_event_revisioned')).toBe(previous.replace(oldGate, newGate))
  })

  it('changes only nullable recorder presentation and fails closed for a missing role', () => {
    const previous = definition(oldRecorders, 'get_event_game_recorders')
    expect(definition(sql, 'get_event_game_recorders')).toBe(previous
      .replace('v_can_select := (', 'v_can_select := coalesce((')
      .replace(") and v_game.status <> 'final';", "), false) and v_game.status <> 'final';")
      .split('recorder.recorded_by = v_primary').join('coalesce(recorder.recorded_by = v_primary, false)')
      .replace('when recorder.recorded_by <> v_primary then null', 'when v_primary is null or recorder.recorded_by <> v_primary then null'))
  })

  it('keeps the writer authenticated-only and the recorder core private', () => {
    const start = oldWriter.indexOf('revoke all on function public.upsert_game_event_revisioned(')
    const end = oldWriter.indexOf('revoke all on function public.get_baseball_release_capabilities()', start)
    expect(sql.replace(/\n\n/g, '\n')).toContain(oldWriter.slice(start, end).trim().replace(/\n\n/g, '\n'))
    expect(sql).toContain('revoke all on function public.get_event_game_recorders(text, uuid)\n  from public, anon, authenticated;')
    expect(sql).not.toMatch(/grant .*get_event_game_recorders/)
  })

  it('does not rewrite history, publish results or alter release capabilities', () => {
    expect(sql.match(/create or replace function/g)).toHaveLength(2)
    expect(sql).not.toMatch(/alter table|delete from|update public\.|get_.*release_capabilities|set_event_primary_recorder/)
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true)
  })
})

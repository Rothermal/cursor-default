import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SOCCER_FORMATION_TEMPLATES } from './formation'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/065_soccer_team_formation.sql'),
  'utf8'
).toLowerCase()

describe('migration 065 soccer team formation contracts', () => {
  it('pins personal settings to v1 and accepts legacy v1 or current team v2', () => {
    expect(sql).toContain("if p_scope = 'user' then")
    expect(sql).toContain('if p_schema_version <> 1 then')
    expect(sql).toContain("if p_scope = 'team' then")
    expect(sql).toContain('if p_schema_version = 1 then')
    expect(sql).toContain('if p_schema_version = 2 then')
    expect(sql).toContain("array['rules', 'formation']")
    expect(sql).toContain('perform public._validate_soccer_team_formation')
  })

  it('strictly validates the approved immutable formation shape', () => {
    expect(sql).toContain("array['version', 'templateid', 'assignments']")
    expect(sql).toContain('(p_formation->>\'version\')::integer <> 1')
    expect(sql).toContain("when '11v11-4-3-3'")
    expect(sql).toContain("when '9v9-3-3-2'")
    expect(sql).toContain("when '7v7-2-3-1'")
    expect(sql.match(/when '\d+v\d+-/g)).toHaveLength(9)
    expect(sql).toContain('jsonb_each(v_assignments)')
    expect(sql).toContain('soccer formation player ids must be uuids')
    expect(sql).toContain('having count(*) > 1')
    expect(sql).toContain('soccer formation player may occupy only one slot')
  })

  it('keeps every SQL template slot list identical to the TypeScript catalog', () => {
    const pairs = [...sql.matchAll(/when '([^']+)' then array\[([^\]]+)\]/g)]
    const sqlSlots = Object.fromEntries(pairs.map(match => [
      match[1],
      match[2].split(',').map(value => value.trim().replace(/'/g, '')),
    ]))

    expect(Object.keys(sqlSlots)).toHaveLength(SOCCER_FORMATION_TEMPLATES.length)
    for (const template of SOCCER_FORMATION_TEMPLATES) {
      expect([template.id, sqlSlots[template.id]]).toEqual([
        template.id,
        template.slots.map(slot => slot.id),
      ])
    }
  })

  it('keeps revisioned manager authority and records only coarse formation audit metadata', () => {
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain(
      "coalesce(public.current_team_role(p_team_id), '') not in ('owner', 'admin')"
    )
    expect(sql).toContain('for update')
    expect(sql).toContain('revision = revision + 1')
    expect(sql).toContain("p_event_type => 'soccer_settings_changed'")
    expect(sql).toContain("select 'formation'")
    expect(sql).toContain("'changed_fields', v_changed_fields")
    const auditMetadata = sql.slice(
      sql.indexOf('p_metadata => jsonb_build_object'),
      sql.indexOf('return jsonb_build_object', sql.indexOf('p_metadata => jsonb_build_object'))
    )
    expect(auditMetadata).not.toContain('assignments')
    expect(auditMetadata).not.toContain('templateid')
  })

  it('keeps validation private and the fixed team save RPC authenticated', () => {
    expect(sql).toContain(
      'revoke all on function public._validate_soccer_team_formation(jsonb) from public'
    )
    expect(sql).toContain(
      'revoke all on function public._validate_sport_settings_payload(text, integer, text, jsonb) from public'
    )
    expect(sql).toContain(
      'grant execute on function public.save_team_sport_settings_revisioned('
    )
    expect(sql).toContain(') to authenticated')
  })
})

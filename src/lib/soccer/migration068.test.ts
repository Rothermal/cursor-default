import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS } from './lineupDefaults'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/068_soccer_lineup_status_defaults.sql'),
  'utf8'
).toLowerCase()

describe('migration 068 soccer lineup status defaults contracts', () => {
  it('preserves personal v1 and team v1/v2 while adding exact team v3', () => {
    expect(sql).toContain("if p_scope = 'user' then")
    expect(sql).toContain('if p_schema_version <> 1 then')
    expect(sql).toContain('if p_schema_version = 1 then')
    expect(sql).toContain('if p_schema_version = 2 then')
    expect(sql).toContain('if p_schema_version = 3 then')
    expect(sql).toContain("array['rules', 'formation', 'lineupdefaults']")
    expect(sql).toContain('perform public._validate_soccer_team_lineup_defaults')
  })

  it('strictly validates the sparse starter contract', () => {
    expect(sql).toContain("array['version', 'starterplayerids']")
    expect(sql).toContain("(p_lineup_defaults->>'version')::integer <> 1")
    expect(sql).toContain(
      `jsonb_array_length(p_lineup_defaults->'starterplayerids') > ${MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS}`
    )
    expect(sql).toContain("from jsonb_array_elements(p_lineup_defaults->'starterplayerids') as starter(value)")
    expect(sql).toContain('soccer lineup default player ids must be uuids')
    expect(sql).toContain('group by lower(starter.value #>>')
    expect(sql).toContain('soccer lineup default player ids must be unique')
  })

  it('keeps manager CAS authority and emits only a coarse lineup audit key', () => {
    expect(sql).toContain('public.has_active_app_access()')
    expect(sql).toContain(
      "coalesce(public.current_team_role(p_team_id), '') not in ('owner', 'admin')"
    )
    expect(sql).toContain('for update')
    expect(sql).toContain('revision = revision + 1')
    expect(sql).toContain("p_event_type => 'soccer_settings_changed'")
    expect(sql).toContain("select 'lineup_defaults'")
    expect(sql).toContain("'changed_fields', v_changed_fields")
    const auditMetadata = sql.slice(
      sql.indexOf('p_metadata => jsonb_build_object'),
      sql.indexOf('return jsonb_build_object', sql.indexOf('p_metadata => jsonb_build_object'))
    )
    expect(auditMetadata).not.toContain('starterplayerids')
  })

  it('keeps validators private and the fixed team save RPC authenticated', () => {
    expect(sql).toContain(
      'revoke all on function public._validate_soccer_team_lineup_defaults(jsonb) from public'
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

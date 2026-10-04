import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')
    .replace(/\r\n/g, '\n')
    .toLowerCase()
}

const staged = migration('072_hockey_event_platform_publication_constraint.sql')
const sql = migration('073_hockey_event_cloud_lifecycle.sql')
const source057 = migration('057_basketball_recorder_finalization_contracts.sql')
const source058 = migration('058_basketball_canonical_finalization.sql')
const source069 = migration('069_soccer_setup_v2_compatibility.sql')

function definition(text: string, name: string): string {
  const start = text.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  return text.slice(start, text.indexOf('\n$$;\n', start) + 5)
}

/** The lines `next` adds to `previous`, which must otherwise be unchanged and in order. */
function addedLines(previous: string, next: string): string[] {
  const before = previous.split('\n')
  const added: string[] = []
  let index = 0
  for (const line of next.split('\n')) {
    if (index < before.length && line === before[index]) index += 1
    else added.push(line.trim())
  }
  expect(index).toBe(before.length)
  return added
}

describe('migrations 072-073 Hockey event cloud lifecycle', () => {
  it('stages the publication sport check without a scan, then validates and swaps it', () => {
    expect(staged).toContain("check (sport_id in ('soccer', 'basketball', 'hockey'))\n  not valid;")
    expect(staged).not.toContain('validate constraint')
    const validate = sql.indexOf('validate constraint game_event_canonical_publications_sport_id_hockey_check')
    const drop = sql.indexOf('drop constraint game_event_canonical_publications_sport_id_check')
    const rename = sql.indexOf('to game_event_canonical_publications_sport_id_check')
    expect(validate).toBeGreaterThanOrEqual(0)
    expect(drop).toBeGreaterThan(validate)
    expect(rename).toBeGreaterThan(drop)
  })

  it('admits Hockey only: Baseball and Football stay off the platform and the aggregate guard', () => {
    expect(sql).toContain("select coalesce(p_sport_id in ('soccer', 'basketball', 'hockey'), false);")
    expect(sql).not.toMatch(/'baseball'|'football'/)
    expect(sql).not.toMatch(/function public\.[a-z_]*aggregate/)
  })

  it('re-creates the shared functions from their latest sources, adding only the Hockey branch', () => {
    expect(addedLines(definition(source069, 'bind_event_game_v2'), definition(sql, 'bind_event_game_v2'))).toEqual([
      "or (p_sport_id = 'hockey' and p_setup_snapshot->>'version' = '1')",
    ])
    expect(
      addedLines(
        definition(source057, 'get_event_finalization_readiness'),
        definition(sql, 'get_event_finalization_readiness')
      ).filter(line => line.includes('hockey'))
    ).toEqual(["elsif p_sport_id = 'hockey' then", 'v_primary_ended := public.is_hockey_primary_stream_ended('])
    expect(
      addedLines(definition(source058, 'finalize_event_game'), definition(sql, 'finalize_event_game')).filter(line =>
        line.includes('hockey')
      )
    ).toEqual(["elsif p_sport_id = 'hockey' then", 'from public.validate_hockey_finalization_policy('])
  })

  it('treats the latest end or abandon as terminal, and a suspend or reopen as not', () => {
    const ended = definition(sql, 'is_hockey_primary_stream_ended')
    expect(ended).toContain("select event.event_type in ('hockey.match_ended', 'hockey.match_abandoned')")
    for (const type of ['match_ended', 'match_abandoned', 'match_suspended', 'match_reopened']) {
      expect(ended).toContain(`'hockey.${type}'`)
    }
    expect(ended).toContain('order by event.stream_sequence desc, event.id desc')
    expect(ended).toContain('event.deleted_at is null')
  })

  it('scores goals and adjustments, and adds the shootout goal only for a decided shootout', () => {
    const policy = definition(sql, 'validate_hockey_finalization_policy')
    expect(policy).toContain("and event.payload->>'outcome' = 'goal' then 1")
    expect(policy).toContain("or (event.payload->>'delta')::numeric not in (1, -1)")
    expect(policy).toContain("setup.setup_snapshot #> '{rulesSnapshot,shootout,rounds}'".toLowerCase())
    expect(policy).toContain('if v_taken_tracked <= v_rounds and v_taken_opponent <= v_rounds then')
    expect(policy).toContain('if v_goals_tracked > v_goals_opponent + (v_rounds - v_taken_opponent) then')
    expect(policy).toContain('elsif v_goals_opponent > v_goals_tracked + (v_rounds - v_taken_tracked) then')
    expect(policy).toContain('elsif v_taken_tracked = v_taken_opponent\n       and v_goals_tracked <> v_goals_opponent then')
    expect(policy).toContain('abs(v_taken_tracked - v_taken_opponent) > 1')
    expect(policy).toContain("raise exception 'hockey shootout rules are unavailable for finalization'")
    expect(policy).toContain("raise exception 'canonical hockey scores are invalid'")
    // Ties are accepted: unlike Basketball there is no tie refusal.
    expect(policy).not.toContain('tied')
  })

  it('adds fixed authenticated Hockey wrappers over the private cores', () => {
    const wrappers: Array<[string, string]> = [
      ['bind_hockey_event_game_v5', 'uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean'],
      ['get_hockey_game_recorders', 'uuid'],
      ['get_hockey_primary_recorder_history', 'uuid'],
      ['set_hockey_primary_recorder', 'uuid, uuid'],
      ['get_hockey_finalization_readiness', 'uuid'],
      ['get_hockey_canonical_publication', 'uuid'],
      ['get_hockey_primary_conflicts_for_finalization', 'uuid'],
      ['resolve_hockey_primary_conflict_for_finalization', 'uuid, text'],
      ['confirm_hockey_primary_checkpoint_for_finalization', 'uuid, uuid, integer, jsonb, integer, bigint, text'],
      ['finalize_hockey_event_game', 'uuid, uuid, jsonb, text, jsonb'],
      ['reopen_hockey_event_game', 'uuid, text'],
      ['get_hockey_canonical_publication_history', 'uuid'],
      ['get_hockey_release_capabilities', ''],
    ]
    const normalized = sql.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')
    for (const [name, args] of wrappers) {
      expect(normalized).toContain(`revoke all on function public.${name}(${args}) from public;`)
      expect(normalized).toContain(`grant execute on function public.${name}(${args}) to authenticated;`)
      expect(definition(sql, name)).toContain('security definer')
    }
    expect(normalized).not.toMatch(/to anon/)
    for (const core of [
      'is_event_platform_sport(text)',
      'is_hockey_primary_stream_ended(uuid, uuid)',
      'validate_hockey_finalization_policy(uuid, uuid)',
      'get_event_finalization_readiness(text, uuid)',
      'finalize_event_game(text, uuid, uuid, jsonb, text, jsonb)',
      'bind_event_game_v2(text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb)',
    ]) {
      expect(normalized).toContain(`revoke all on function public.${core} from public;`)
    }
    expect(normalized).not.toMatch(/grant execute on function public\.(finalize_event_game|validate_hockey|is_hockey|get_event_finalization)/)
  })

  it('checks the canonical schema version before finalizing and requires a reopen reason through the core', () => {
    const finalize = definition(sql, 'finalize_hockey_event_game')
    expect(finalize.indexOf("p_canonical_snapshot->>'canonicalschemaversion' is distinct from '1'")).toBeLessThan(
      finalize.indexOf("public.finalize_event_game(\n    'hockey'")
    )
    expect(definition(sql, 'reopen_hockey_event_game')).toContain("public.reopen_event_game('hockey', p_game_id, p_reason)")
    expect(definition(sql, 'get_hockey_canonical_publication_history')).toContain(
      "public.can_manage_event_game('hockey', p_game_id)"
    )
  })

  it('reports the Hockey handshake only when every table and fixed RPC is present', () => {
    const handshake = definition(sql, 'get_hockey_release_capabilities')
    expect(handshake).toContain('public.has_active_app_access()')
    expect(handshake).toContain("not public.is_event_platform_sport('hockey')")
    expect(handshake).toContain("return jsonb_build_object('contractversion', 0);")
    expect(handshake).toContain("'contractversion', 1,\n    'migration', 73,")
    for (const name of [
      'bind_hockey_event_game_v5',
      'get_hockey_game_recorders',
      'get_hockey_finalization_readiness',
      'finalize_hockey_event_game',
      'reopen_hockey_event_game',
      'get_hockey_canonical_publication_history',
    ]) {
      expect(handshake).toContain(`'public.${name}(`)
    }
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true)
  })
})

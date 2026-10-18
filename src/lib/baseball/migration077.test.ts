import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')
    .replace(/\r\n/g, '\n')
    .toLowerCase()
}

const staged = migration('076_baseball_event_platform_publication_constraint.sql')
const sql = migration('077_baseball_event_cloud_lifecycle.sql')
const source073 = migration('073_hockey_event_cloud_lifecycle.sql')

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

const asBaseball = (text: string) => text.split('hockey').join('baseball')

const WRAPPERS: Array<[string, string]> = [
  ['bind_baseball_event_game_v5', 'uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean'],
  ['get_baseball_game_recorders', 'uuid'],
  ['get_baseball_primary_recorder_history', 'uuid'],
  ['set_baseball_primary_recorder', 'uuid, uuid'],
  ['get_baseball_finalization_readiness', 'uuid'],
  ['get_baseball_canonical_publication', 'uuid'],
  ['get_baseball_primary_conflicts_for_finalization', 'uuid'],
  ['resolve_baseball_primary_conflict_for_finalization', 'uuid, text'],
  ['confirm_baseball_primary_checkpoint_for_finalization', 'uuid, uuid, integer, jsonb, integer, bigint, text'],
  ['finalize_baseball_event_game', 'uuid, uuid, jsonb, text, jsonb'],
  ['reopen_baseball_event_game', 'uuid, text'],
  ['get_baseball_canonical_publication_history', 'uuid'],
  ['get_baseball_release_capabilities', ''],
]

describe('migrations 076-077 Baseball event cloud lifecycle', () => {
  it('stages the publication sport check without a scan, then validates and swaps it', () => {
    expect(staged).toContain("check (sport_id in ('soccer', 'basketball', 'hockey', 'baseball'))\n  not valid;")
    expect(staged).not.toContain('validate constraint')
    const validate = sql.indexOf('validate constraint game_event_canonical_publications_sport_id_baseball_check')
    const drop = sql.indexOf('drop constraint game_event_canonical_publications_sport_id_check')
    const rename = sql.indexOf('to game_event_canonical_publications_sport_id_check')
    expect(validate).toBeGreaterThanOrEqual(0)
    expect(drop).toBeGreaterThan(validate)
    expect(rename).toBeGreaterThan(drop)
  })

  it('admits Baseball only: Football stays off the platform and the aggregate guard is untouched', () => {
    expect(sql).toContain("select coalesce(p_sport_id in ('soccer', 'basketball', 'hockey', 'baseball'), false);")
    expect(sql).not.toContain("'football'")
    expect(sql).not.toMatch(/function public\.[a-z_]*aggregate/)
  })

  it('re-creates the shared functions from their 073 bodies, adding only the Baseball branch', () => {
    expect(addedLines(definition(source073, 'bind_event_game_v2'), definition(sql, 'bind_event_game_v2'))).toEqual([
      "or (p_sport_id = 'baseball' and p_setup_snapshot->>'version' = '1')",
    ])
    expect(
      addedLines(definition(source073, 'get_event_finalization_readiness'), definition(sql, 'get_event_finalization_readiness'))
    ).toEqual([
      "elsif p_sport_id = 'baseball' then",
      'v_primary_ended := public.is_baseball_primary_stream_ended(',
      'p_game_id,',
      'v_primary',
      ');',
    ])
    expect(addedLines(definition(source073, 'finalize_event_game'), definition(sql, 'finalize_event_game'))).toEqual([
      "elsif p_sport_id = 'baseball' then",
      'select policy.tracked_score, policy.opponent_score',
      'into v_tracked_score, v_opponent_score',
      'from public.validate_baseball_finalization_policy(',
      'p_game_id,',
      'p_primary_recorded_by',
      ') policy;',
    ])
  })

  it('treats the latest end that is not suspended as terminal, and a reopen as not', () => {
    const ended = definition(sql, 'is_baseball_primary_stream_ended')
    expect(ended).toContain("select event.event_type = 'baseball.game_ended'")
    expect(ended).toContain("'completed', 'run_rule', 'time_limit', 'forfeit', 'abandoned'")
    expect(ended).not.toContain("'suspended'")
    expect(ended).toContain("and event.event_type in ('baseball.game_ended', 'baseball.game_reopened')")
    expect(ended).toContain('order by event.stream_sequence desc, event.id desc')
    expect(ended).toContain('event.deleted_at is null')
  })

  it('replays runs in capture order with the third-out rule and the placed runner', () => {
    const policy = definition(sql, 'validate_baseball_finalization_policy')
    expect(policy).toContain('order by event.stream_sequence, event.id')
    expect(policy).toContain('event.deleted_at is null')
    expect(policy).toContain("regexp_match(coalesce(v_event.period_id, ''), '^inning-([1-9][0-9]?)-(top|bottom)$')")
    expect(policy).toContain("when (v_half = 'top') = (v_tracked_side = 'away') then 'tracked'")
    expect(policy).toContain("v_second := v_placed_base = 'second' and v_inning >= v_placed_from;")
    expect(policy).toContain('v_third_from := v_out_froms[3 - v_outs];')
    expect(policy).toContain("v_batter_out_before := 'batter' = any(v_out_froms[1:2 - v_outs]);")
    expect(policy).toContain("'single', 'double', 'triple', 'home_run', 'ground_rule_double'")
    expect(policy).toContain("coalesce((movement.value->>'runcounts')::boolean, v_runs_count_by_default)")
    expect(policy).toContain("raise exception 'canonical baseball scores are invalid'")
    // Ties and forfeits publish the recorded runs.
    expect(policy).not.toContain('tied')
    expect(policy).not.toContain('forfeitwinner')
  })

  it('adds fixed authenticated Baseball wrappers that match the Hockey ones', () => {
    const normalized = sql.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')
    for (const [name, args] of WRAPPERS) {
      expect(normalized).toContain(`revoke all on function public.${name}(${args}) from public;`)
      expect(normalized).toContain(`grant execute on function public.${name}(${args}) to authenticated;`)
      expect(definition(sql, name)).toContain('security definer')
      if (name !== 'get_baseball_release_capabilities') {
        expect(definition(sql, name)).toBe(asBaseball(definition(source073, name.replace('baseball', 'hockey'))))
      }
    }
    expect(normalized).not.toMatch(/to anon/)
    for (const core of [
      'is_event_platform_sport(text)',
      'is_baseball_primary_stream_ended(uuid, uuid)',
      'validate_baseball_finalization_policy(uuid, uuid)',
      'get_event_finalization_readiness(text, uuid)',
      'finalize_event_game(text, uuid, uuid, jsonb, text, jsonb)',
      'bind_event_game_v2(text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb)',
    ]) {
      expect(normalized).toContain(`revoke all on function public.${core} from public;`)
    }
    expect(normalized).not.toMatch(/grant execute on function public\.(finalize_event_game|validate_baseball|is_baseball|get_event_finalization)/)
  })

  it('reports the Baseball handshake only when every table and fixed RPC is present, team settings included', () => {
    const handshake = definition(sql, 'get_baseball_release_capabilities')
    const from073 = asBaseball(definition(source073, 'get_hockey_release_capabilities'))
    expect(from073).toContain("'migration', 73,")
    expect(addedLines(from073.replace("'migration', 73,", "'migration', 77,"), handshake)).toEqual([
      'or to_regprocedure(',
      "'public.save_baseball_team_settings_revisioned(uuid,bigint,jsonb)'",
      ') is null',
    ])
    expect(handshake).toContain("not public.is_event_platform_sport('baseball')")
    expect(handshake).toContain("'contractversion', 1,")
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true)
  })
})

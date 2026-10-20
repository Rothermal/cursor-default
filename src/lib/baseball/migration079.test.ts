import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8').replace(/\r\n/g, '\n')
const sql = read('079_baseball_aggregate_identity_foundation.sql')
const previous = read('075_hockey_aggregate_sources.sql')
function definition(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('\n$$;', start) + 4)
}

describe('migration 079 Baseball canonical identity server contract', () => {
  it('extends the exact latest-075 pager only at Baseball seams', () => {
    const next = definition(sql, '_event_aggregate_publication_page')
      .replace("('soccer', 'basketball', 'hockey', 'baseball')", "('soccer', 'basketball', 'hockey')")
      .replace('      baseball.identity as baseball_identity,\n', '')
      .replace(`    left join lateral (
      select public._baseball_personal_publication_identity(publication.id) as identity
      where p_sport_id = 'baseball' and game.cloud_scope = 'personal'
    ) baseball on true
`, '')
      .replace("p_sport_id in ('hockey', 'baseball')", "p_sport_id = 'hockey'")
      .replace(`      and (
        p_sport_id <> 'baseball'
        or public._baseball_canonical_snapshot_completed(publication.canonical_snapshot)
      )
`, '')
      .replace(`          and (
            case when p_sport_id = 'baseball' and game.cloud_scope = 'personal' then
              public._baseball_personal_player_authorized(p_player_id, v_user_id)
              and (
                baseball.identity->>'status' = 'invalid'
                or exists (select 1 from jsonb_each_text(case
                  when jsonb_typeof(baseball.identity->'participantSourceMap') = 'object'
                    then baseball.identity->'participantSourceMap' else '{}'::jsonb end) entry
                  where entry.value = p_player_id::text)
              )
            else exists (
              select 1
              from public.game_participants participant
              where participant.game_id = game.id
                and participant.source_player_id = p_player_id
            ) end
          )`, `          and exists (
            select 1
            from public.game_participants participant
            where participant.game_id = game.id
              and participant.source_player_id = p_player_id
          )`)
      .replace(`          case when p_sport_id = 'baseball' and ranked.cloud_scope = 'personal'
            then ranked.baseball_identity->'participantSourceMap'
            else public._event_aggregate_participant_source_map(p_sport_id, ranked.game_id) end,`,
      '          public._event_aggregate_participant_source_map(p_sport_id, ranked.game_id),')
      .replace(`      ) || case when p_sport_id = 'baseball' then jsonb_build_object(
        'participantMapFingerprint', ranked.baseball_identity->'mapFingerprint',
        'identityStatus', coalesce(ranked.baseball_identity->>'status', 'valid'),
        'identityDiagnostic', ranked.baseball_identity->'diagnostic'
      ) else '{}'::jsonb end as item`, '      ) as item')
    expect(next).toBe(definition(previous, '_event_aggregate_publication_page'))
  })

  it('leaves old finalization/binding/release wrappers and settings schemas untouched', () => {
    const names = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map(match => match[1])
    expect(names.filter(name => !name.includes('baseball'))).toEqual(['merge_players_execute', '_event_aggregate_publication_page'])
    expect(sql).not.toMatch(/create.*(?:settings|legacy)|alter table public\.(?:games|game_events|game_event_setup_snapshots)/i)
    expect(sql).not.toContain('get_baseball_release_capabilities(')
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
  })

  it('keeps pins and receipts private with RLS and no player-FK cascade', () => {
    for (const table of ['baseball_personal_publication_pins', 'baseball_personal_link_receipts']) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`)
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated;`)
    }
    const pinTable = sql.slice(sql.indexOf('create table'), sql.indexOf('create table public.baseball_personal_link_receipts'))
    expect(pinTable).not.toContain('references public.players')
    expect(sql).toContain('after insert on public.game_event_canonical_publications')
    expect(definition(sql, '_baseball_personal_pin_publication')).not.toContain('_baseball_personal_lock_player(')
    expect(sql).not.toMatch(/update public\.baseball_personal_publication_pins/)
  })

  it('adds only fixed authenticated public surfaces and revokes the renamed merge core', () => {
    expect([...sql.matchAll(/grant execute on function public\.(\w+)\(/g)].map(match => match[1]).sort()).toEqual([
      'finalize_baseball_event_game_reviewed', 'get_baseball_aggregate_capabilities',
      'get_baseball_personal_link_capabilities', 'get_baseball_personal_participant_links',
      'get_baseball_player_aggregate_publications', 'get_baseball_scope_aggregate_publications',
      'link_baseball_personal_participant', 'merge_players_execute',
    ])
    expect(sql).toContain('revoke all on function public._merge_players_execute_before_baseball_identity(uuid, uuid, jsonb)\n  from public, anon, authenticated;')
    expect(sql).not.toMatch(/grant .* to (?:public|anon)/i)
  })

  it('uses target-before-game and ordered participant locks without changing the merge body', () => {
    const link = definition(sql, 'link_baseball_personal_participant')
    expect(link.indexOf('_baseball_personal_lock_player(')).toBeLessThan(link.indexOf('for update;'))
    expect(link).toContain('order by participant.id for update;')
    expect(link.indexOf('_baseball_personal_player_authorized(')).toBeLessThan(link.indexOf('return v_receipt.result;'))
    const merge = definition(sql, 'merge_players_execute')
    expect(merge).toContain('select distinct id from unnest(array[p_duplicate_id, p_survivor_id]) id order by id')
    expect(merge).toContain('_merge_players_execute_before_baseball_identity(p_duplicate_id, p_survivor_id, p_resolutions)')
    expect(sql).toContain('alter function public.merge_players_execute(uuid, uuid, jsonb) rename to _merge_players_execute_before_baseball_identity;')
  })

  it('keeps aggregate eligibility narrower without changing BSB-6 finalization', () => {
    const completed = definition(sql, '_baseball_canonical_snapshot_completed')
    expect(completed).toContain("in ('completed', 'run_rule', 'time_limit')")
    expect(completed).toContain("('baseball.game_ended', 'baseball.game_reopened')")
    expect(completed).not.toMatch(/forfeit|abandoned|suspended/)
    expect(completed).toContain("nullif(event.value->>'deletedAt', '') is null")
  })

  it('has independent exact aggregate/link handshakes and no settings feature claim', () => {
    expect(definition(sql, 'get_baseball_aggregate_capabilities')).toContain(
      "jsonb_build_object('contractVersion', 1, 'sportId', 'baseball', 'aggregateContractVersion', 1, 'migration', 79)"
    )
    expect(definition(sql, 'get_baseball_personal_link_capabilities')).toContain(
      "jsonb_build_object('contractVersion', 1, 'sportId', 'baseball', 'personalLinkContractVersion', 1,\n    'publicationIdentityVersion', 1, 'reviewedFinalizationVersion', 1, 'migration', 79)"
    )
    for (const name of ['get_baseball_aggregate_capabilities', 'get_baseball_personal_link_capabilities']) {
      expect(definition(sql, name)).toContain("jsonb_build_object('contractVersion', 0)")
      expect(definition(sql, name)).toContain('has_active_app_access()')
    }
  })

  it('preserves convergence but refuses ambiguous/cyclic lineage and new duplicate links', () => {
    const resolver = definition(sql, '_baseball_personal_resolve_source')
    expect(resolver).toContain('v_count <> 1')
    expect(resolver).toContain('v_current = any(v_path)')
    expect(resolver).not.toContain('order by')
    expect(definition(sql, '_baseball_personal_publication_identity')).not.toContain('having count(*) > 1')
    expect(definition(sql, 'link_baseball_personal_participant')).toContain('Baseball target is already linked in this game')
    const reviewed = definition(sql, 'finalize_baseball_event_game_reviewed')
    expect(reviewed.indexOf('v_game.status = \'final\'')).toBeLessThan(reviewed.indexOf('finalize_baseball_event_game('))
    expect(reviewed).toContain('Baseball participant map changed during finalization')
  })
})

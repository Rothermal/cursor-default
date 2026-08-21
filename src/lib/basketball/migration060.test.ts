import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = source('supabase/migrations/060_basketball_aggregate_sources.sql')
const soccerSql = source('supabase/migrations/047_soccer_canonical_aggregate_sources.sql')

describe('migration 060 Basketball aggregate source contracts', () => {
  it('exposes four fixed authenticated Basketball wrappers and no broad sport parameter', () => {
    for (const name of [
      'get_basketball_scope_aggregate_publications',
      'get_basketball_player_aggregate_publications',
      'get_basketball_scope_aggregate_legacy_games',
      'get_basketball_player_aggregate_legacy_games',
    ]) {
      expect(sql).toContain(`create or replace function public.${name}`)
      expect(sql).toContain(`revoke all on function public.${name}`)
      expect(sql).toContain(`grant execute on function public.${name}`)
    }
    expect(sql).not.toContain('grant execute on function public._event_aggregate')
    expect(sql).not.toContain('grant execute on function public._basketball_legacy')
    expect(sql).not.toContain('to anon')
  })

  it('keeps shared cores private and Soccer fixed wrapper signatures intact', () => {
    expect(sql).toContain('public._event_aggregate_snapshot_completed')
    expect(sql).toContain('public._event_aggregate_participant_source_map')
    expect(sql).toContain('public._event_aggregate_publication_page')
    expect(sql).toContain("'soccer', p_scope_type, p_scope_id")
    expect(sql).toContain("'soccer', null, null, p_player_id")
    expect(sql).toContain(
      'public._event_aggregate_participant_source_map(p_sport_id, ranked.game_id)'
    )
    expect(sql).toContain(
      'create or replace function public.get_soccer_scope_aggregate_publications'
    )
    expect(sql).toContain(
      'create or replace function public.get_soccer_player_aggregate_publications'
    )
    expect(sql).toContain("p_sport_id = 'soccer'\n        or exists")
    for (const key of [
      'publicationid', 'publicationnumber', 'snapshotfingerprint', 'finalizedat',
      'eventcount', 'payloadbytes', 'canonicalsnapshot', 'participantsourcemap',
      'canmanage',
    ]) {
      expect(sql).toContain(`'${key}'`)
      expect(soccerSql).toContain(`'${key}'`)
    }
  })

  it('requires authentication, active app access, readable final games, and exact authority', () => {
    expect(sql).toContain("if v_user_id is null then raise exception 'authentication required'")
    expect(sql).toContain('if not public.has_active_app_access()')
    expect(sql).toContain('public.can_read_game(game.id)')
    expect(sql).toContain("game.status = 'final'")
    expect(sql).toContain("game.sport_id = 'basketball'")
    expect(sql).toContain("publication.sport_id = p_sport_id")
    expect(sql).toContain('publication.invalidated_at is null')
    expect(sql).toContain('public._basketball_canonical_snapshot_completed')
    expect(sql).toContain('setup.sport_id = p_sport_id')
    expect(sql).toContain('not exists (\n        select 1\n        from public.game_event_setup_snapshots setup')
  })

  it('uses bounded paired keysets and tie-break ids for both source families', () => {
    expect(sql).toContain('v_limit < 1 or v_limit > 50')
    expect(sql).toContain(
      '(p_before_finalized_at is null) <> (p_before_publication_id is null)'
    )
    expect(sql).toContain(
      '(publication.finalized_at, publication.id)\n          < (p_before_finalized_at, p_before_publication_id)'
    )
    expect(sql).toContain(
      'order by publication.finalized_at desc, publication.id desc'
    )
    expect(sql).toContain(
      '(p_before_game_date is null) <> (p_before_game_id is null)'
    )
    expect(sql).toContain(
      '(game.game_date, game.id) < (p_before_game_date, p_before_game_id)'
    )
    expect(sql).toContain('order by game.game_date desc, game.id desc')
    expect(sql.match(/limit v_limit \+ 1/g)).toHaveLength(2)
  })

  it('resolves legacy corrections into explicit players, team totals, scores, and provenance', () => {
    expect(sql).toContain('public.get_game_stats_resolved(p_game_id)')
    expect(sql).toContain('public._basketball_empty_stat_totals()')
    expect(sql).toContain('tracked_totals as')
    expect(sql).toContain('opponent_totals as')
    expect(sql.match(/public\.get_game_stats_resolved\(p_game_id\)/g)).toHaveLength(1)
    expect(sql).toContain("'participationevidence'")
    expect(sql).toContain('public.player_checkouts checkout')
    expect(sql).toContain("'sourcefingerprint', md5(v_source_body::text)")
    expect(sql).toContain("'periods', '[]'::jsonb")
    expect(sql).toContain('v_game.home_team_score')
    expect(sql).toContain('v_game.home_score_adjustment')
    expect(sql).toContain('v_game.opponent_score')
    expect(sql).toContain('not player.is_team_placeholder')
    expect(sql).toContain('resolved.player_id = v_game.home_team_player_id')
    expect(sql).toContain('resolved.player_id = v_game.opp_team_player_id')
  })

  it('preserves old Basketball history only when sport identity is provable', () => {
    expect(sql).toContain("set sport_id = 'basketball'")
    expect(sql).toContain('game.sport_id is null')
    expect(sql).toContain('join public.seasons season on season.id = team.season_id')
    expect(sql).toContain("lower(trim(season.sport)) = 'basketball'")
    expect(sql).not.toContain('team.sport')
    expect(sql.match(/enable trigger enforce_game_identity_and_final_state/g)).toHaveLength(3)
    expect(sql).toContain('exception when others then')
    expect(sql).toContain(
      'alter table public.games disable trigger enforce_game_identity_and_final_state'
    )
    expect(sql).toContain(
      'alter table public.games enable trigger enforce_game_identity_and_final_state'
    )
    expect(sql).toMatch(
      /and not exists\s*\(\s*select 1\s*from public\.game_event_setup_snapshots setup/
    )
  })

  it('repairs only audited non-cyclic participant lineage and retains future merge remounting', () => {
    expect(sql).toContain('with recursive candidates as')
    expect(sql).toContain('public.player_merge_audit audit')
    expect(sql).toContain('not merge.survivor_player_id = any(lineage.path)')
    expect(sql).toContain('terminal.depth > 0')
    expect(sql).toContain('public.team_players team_player')
    expect(sql).toContain('public.player_guardians guardian')
    expect(sql).not.toContain('display_name =')
    expect(sql).not.toContain('jersey_number =')
    expect(soccerSql).toContain('update public.game_participants')
    expect(soccerSql).toContain('set source_player_id = p_survivor_id')
  })
})

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/\r\n/g, '\n')
    .toLowerCase()
}

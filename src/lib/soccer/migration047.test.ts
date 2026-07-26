import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/047_soccer_canonical_aggregate_sources.sql'
  ),
  'utf8'
).toLowerCase()

const auditSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/scripts/audit_soccer_participant_sources_pre_047.sql'
  ),
  'utf8'
).toLowerCase()

describe('migration 047 soccer aggregate source contracts', () => {
  it('exposes only the two narrow authenticated aggregate RPCs', () => {
    expect(sql).toContain(
      'create or replace function public.get_soccer_scope_aggregate_publications'
    )
    expect(sql).toContain(
      'create or replace function public.get_soccer_player_aggregate_publications'
    )
    expect(sql).toContain(
      'revoke all on function public.get_soccer_scope_aggregate_publications'
    )
    expect(sql).toContain(
      'revoke all on function public.get_soccer_player_aggregate_publications'
    )
    expect(sql).toContain('to authenticated')
    expect(sql).not.toContain('to anon')
  })

  it('enforces active readable completed team publications and exact scopes', () => {
    expect(sql).toContain('publication.invalidated_at is null')
    expect(sql).toContain("publication.sport_id = 'soccer'")
    expect(sql).toContain("game.status = 'final'")
    expect(sql).toContain("game.cloud_scope = 'team'")
    expect(sql).toContain('public.can_read_game(game.id)')
    expect(sql).toContain(
      'public._soccer_canonical_snapshot_completed(publication.canonical_snapshot)'
    )
    expect(sql).toContain("event.value->>'sequence'")
    expect(sql).toContain(
      "p_scope_type = 'team' and game.team_id = p_scope_id"
    )
    expect(sql).toContain(
      "p_scope_type = 'season' and game.season_id = p_scope_id"
    )
    expect(sql).toContain(
      "p_scope_type = 'tournament' and game.tournament_id = p_scope_id"
    )
  })

  it('uses stable keyset pagination and an indexed player predicate', () => {
    expect(sql).toContain('v_limit < 1 or v_limit > 50')
    expect(sql).toContain(
      '(p_before_finalized_at is null) <> (p_before_publication_id is null)'
    )
    expect(sql).toContain(
      '(publication.finalized_at, publication.id)'
    )
    expect(sql).toContain(
      '< (p_before_finalized_at, p_before_publication_id)'
    )
    expect(sql).toContain(
      'order by publication.finalized_at desc, publication.id desc'
    )
    expect(sql).toContain('limit v_limit + 1')
    expect(sql).toContain(
      'participant.source_player_id = p_player_id'
    )
    expect(sql).toContain("'nextcursor'")
  })

  it('returns the pinned canonical item shape and calendar date', () => {
    for (const key of [
      'publicationid',
      'publicationnumber',
      'snapshotfingerprint',
      'finalizedat',
      'eventcount',
      'payloadbytes',
      'canonicalsnapshot',
      'participantsourcemap',
      'canmanage',
    ]) {
      expect(sql).toContain(`'${key}'`)
    }
    expect(sql).toContain("to_char(ranked.game_date, 'yyyy-mm-dd')")
    expect(sql).toContain(
      'public._soccer_participant_source_map(ranked.game_id)'
    )
  })

  it('repairs only audited merge lineage with a surviving team player', () => {
    expect(sql).toContain('with recursive candidates as')
    expect(sql).toContain('public.player_merge_audit audit')
    expect(sql).toContain(
      'audit.duplicate_player_id = lineage.current_player_id'
    )
    expect(sql).toContain('terminal.depth > 0')
    expect(sql).toContain('join public.players player')
    expect(sql).toContain('join public.team_players team_player')
    expect(sql).not.toContain('display_name =')
    expect(sql).not.toContain('jersey_number =')
    expect(sql).toContain('remaining unresolved')
  })

  it('preserves participant source ids during future player merges', () => {
    expect(sql).toContain(
      'create or replace function public.merge_players_execute'
    )
    const mergeSql = sql.slice(
      sql.indexOf('create or replace function public.merge_players_execute')
    )
    expect(mergeSql).toContain('update public.game_participants')
    expect(mergeSql).toContain('set source_player_id = p_survivor_id')
    expect(mergeSql).toContain('where source_player_id = p_duplicate_id')
    expect(
      mergeSql.indexOf('update public.game_participants')
    ).toBeLessThan(
      mergeSql.indexOf('delete from public.players where id = p_duplicate_id')
    )
  })

  it('ships a read-only preflight classification report', () => {
    expect(auditSql).toContain("'repairable'")
    expect(auditSql).toContain("'already_resolved'")
    expect(auditSql).toContain("'intentionally_unresolved'")
    expect(auditSql).toContain("'unprovable'")
    expect(auditSql).toContain('public.player_merge_audit audit')
    expect(auditSql).not.toMatch(/\b(update|delete|insert)\b/)
  })
})

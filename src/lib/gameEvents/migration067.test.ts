import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/067_roster_history_binding_recovery.sql'),
  'utf8'
).toLowerCase()

describe('migration 067 roster history binding recovery', () => {
  it('removes direct player deletion and exposes only the guarded delete RPC', () => {
    expect(sql).toContain('drop policy if exists "players_delete"')
    expect(sql).toContain('revoke delete on table public.players from authenticated')
    expect(sql).toContain('create or replace function public.delete_unreferenced_player')
    expect(sql).toContain('participant.source_player_id = p_player_id')
    expect(sql).toContain('stat.player_id = p_player_id')
    expect(sql).toContain('shot.player_id = p_player_id')
    expect(sql).toContain('correction.player_id = p_player_id')
    expect(sql).toContain('checkout.player_id = p_player_id')
    expect(sql).toContain('game.home_team_player_id = p_player_id')
    expect(sql).toContain('game.opp_team_player_id = p_player_id')
    expect(sql).toContain('player_delete_has_history')
    expect(sql).toContain(
      'grant execute on function public.delete_unreferenced_player(uuid) to authenticated'
    )
  })

  it('keeps ordinary v4 binding unless a manager deliberately requests recovery', () => {
    expect(sql).toContain('create or replace function public.bind_event_game_v5')
    expect(sql).toContain('if not coalesce(p_allow_deleted_source_players, false) then')
    expect(sql).toContain('return public.bind_event_game_v4')
    expect(sql).toContain('not public.is_accepted_team_admin(p_source_team_id)')
  })

  it('unlinks only a source id whose player row is genuinely gone', () => {
    expect(sql).toContain('from public.team_players team_player')
    expect(sql).toContain('from public.players player')
    expect(sql).toContain("jsonb_set(v_item, '{source_player_id}', 'null'::jsonb, true)")
    expect(sql).toContain("'sourceplayerdeletedbeforebinding', true")
    expect(sql).not.toContain('update public.players')
  })

  it('keeps the shared core private and grants fixed sport wrappers', () => {
    expect(sql).toContain('create or replace function public.bind_soccer_event_game_v5')
    expect(sql).toContain('create or replace function public.bind_basketball_event_game_v5')
    expect(sql).toContain('revoke all on function public.bind_event_game_v5')
    expect(sql).not.toMatch(/grant execute on function public\.bind_event_game_v5/)
    expect(sql).toMatch(/grant execute on function public\.bind_soccer_event_game_v5[\s\S]*to authenticated/)
    expect(sql).toMatch(/grant execute on function public\.bind_basketball_event_game_v5[\s\S]*to authenticated/)
  })
})

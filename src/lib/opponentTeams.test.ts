import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  escapeLikePattern,
  filterOpponents,
  findOpponentByName,
  opponentLabelError,
  opponentSaveCandidate,
  parseOpponentTeam,
  type OpponentTeam,
} from './opponentTeams'
import { withOpponentLabels } from './opponentLocalGames'
import { createInitialState } from './gameReducer'

const tigers: OpponentTeam = { id: 'o1', sportId: 'basketball', name: 'Tigers', nickname: 'TGR' }
const eagles: OpponentTeam = { id: 'o2', sportId: 'basketball', name: 'Central Eagles', nickname: null }
const lions: OpponentTeam = { id: 'o3', sportId: 'basketball', name: 'Lincoln Lions', nickname: 'Tig' }

describe('RTN-1 saved opponents', () => {
  it('parses rows strictly and trims labels', () => {
    expect(parseOpponentTeam({ id: 'a', sport_id: 'soccer', name: ' FC ', nickname: '  ' })).toEqual({ id: 'a', sportId: 'soccer', name: 'FC', nickname: null })
    expect(parseOpponentTeam({ id: 'a', sport_id: 'soccer', name: '   ' })).toBeNull()
    expect(parseOpponentTeam({ id: 'a', sport_id: 'soccer', name: 'X', nickname: 4 })).toBeNull()
  })

  it('validates name and nickname lengths', () => {
    expect(opponentLabelError('  ', null)).toMatch(/Enter/)
    expect(opponentLabelError('x'.repeat(101), null)).toMatch(/at most 100/)
    expect(opponentLabelError('Tigers', 'n'.repeat(101))).toMatch(/Nickname/)
    expect(opponentLabelError('Tigers', '')).toBeNull()
  })

  it('matches names case-insensitively and ranks prefix matches first', () => {
    expect(findOpponentByName([tigers], ' tigers ')).toBe(tigers)
    expect(filterOpponents([lions, eagles, tigers], 'tig').map(o => o.id)).toEqual(['o3', 'o1'])
    expect(filterOpponents([lions, eagles, tigers], 'eag').map(o => o.id)).toEqual(['o2'])
    expect(filterOpponents([lions, eagles, tigers], '').map(o => o.id)).toEqual(['o2', 'o3', 'o1'])
  })

  it('offers to save only new names or changed nicknames', () => {
    expect(opponentSaveCandidate([tigers], 'Wolves', null)).toEqual({ kind: 'new' })
    expect(opponentSaveCandidate([tigers], 'tigers', 'TGR')).toBeNull()
    expect(opponentSaveCandidate([tigers], 'Tigers', 'Cats')).toEqual({ kind: 'nickname', opponent: tigers })
    expect(opponentSaveCandidate([tigers], '', null)).toBeNull()
  })

  it('escapes LIKE wildcards in opponent names', () => {
    expect(escapeLikePattern('100%_Club\\')).toBe('100\\%\\_Club\\\\')
  })

  it('relabels a device copy without touching its binding', () => {
    const state = {
      ...createInitialState(),
      gameInfo: { teamName: 'Us', opponentName: 'Old', opponentNickname: 'O', tournamentName: '', date: '2026-11-08' },
    }
    state.cloudSync = { ...state.cloudSync, gameId: 'g1', teamId: 't1' }
    const next = withOpponentLabels(state, ' New ', '  ')
    expect(next.gameInfo).toMatchObject({ teamName: 'Us', opponentName: 'New', opponentNickname: null })
    expect(next.cloudSync).toBe(state.cloudSync)
  })
})

describe('migration 082 saved opponents', () => {
  const sql = readFileSync('supabase/migrations/082_saved_opponents_and_game_labels.sql', 'utf8').toLowerCase()

  it('scopes saved opponents to the owner and sport with unique active names', () => {
    expect(sql).toContain('create table if not exists public.opponent_teams')
    expect(sql).toContain('on public.opponent_teams (owner_id, sport_id, lower(name))')
    expect(sql).toContain('where archived_at is null')
    for (const action of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toContain(`"opponent_teams_${action}_own"`)
    }
    expect(sql).toContain('new.owner_id := old.owner_id')
  })

  it('allows only the two opponent label columns to change through the relabel rpc', () => {
    expect(sql).toContain("current_setting('statkeeper.opponent_label_game_id', true), '') = old.id::text")
    expect(sql).toContain("(to_jsonb(new) - 'opponent_name' - 'opponent_nickname' - 'updated_at')")
    expect(sql).toContain("raise exception 'final games are immutable; use correction/admin actions'")
    expect(sql).toContain('v_game.created_by = v_user_id')
    // current_team_role is null for non-members; the check must fail closed.
    expect(sql).toContain("in ('owner', 'admin'))\n  ) is not true then\n    raise exception 'only the game creator")
    expect(sql).toContain("public.current_team_role(v_game.team_id) in ('owner', 'admin')")
    expect(sql).toContain('grant execute on function public.set_game_opponent_labels(uuid, text, text) to authenticated')
  })

  it('keeps the rest of the 055 trigger body unchanged', () => {
    const original = readFileSync('supabase/migrations/055_event_platform_finalization_recovery.sql', 'utf8')
    const start = original.indexOf('create or replace function public.enforce_game_identity_and_final_state()')
    const end = original.indexOf('$$;', start) + 3
    const tail = original.slice(original.indexOf("    if old.status = 'final' then", start), end).toLowerCase()
    expect(sql).toContain(tail)
  })
})

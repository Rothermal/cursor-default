import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { baseballLegacyProvenance, loadBaseballLegacyAggregates, parseBaseballLegacyGame, type BaseballLegacyGame } from './legacyAggregates'

function game(id = 'g', extra: Partial<BaseballLegacyGame> = {}): BaseballLegacyGame {
  return { id, game_date: '2026-10-21', opponent_name: 'Visitors', status: 'final', sport_id: 'baseball', team_id: 't', season_id: 's', tournament_id: null,
    home_team_player_id: 'home', opp_team_player_id: 'opp', teams: { name: 'Falcons', seasons: { name: 'Fall', sport: 'baseball' } }, ...extra }
}
function fake(games: unknown[], options: { events?: string[]; failSetups?: boolean; failStatsAccess?: boolean; lines?: Record<string, unknown[]>; onRead?: (table: string) => void } = {}) {
  const calls: Array<{ table: string; start: number; filters: Array<[string, unknown]> }> = []
  const client = { from: (table: string) => builder(table), rpc: (table: string, args: { p_game_id: string }) => builder(table, args.p_game_id) }
  function builder(table: string, id?: string) {
    let start = 0, end = 199
    const filters: Array<[string, unknown]> = []
    const q = { select: () => q, order: () => q, abortSignal: () => q,
      eq: (key: string, value: unknown) => { filters.push([key,value]); return q },
      in: (key: string, value: unknown) => { filters.push([key,value]); return q },
      range: (a: number, b: number) => { start = a; end = b; return q },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        calls.push({ table, start, filters }); options.onRead?.(table)
        if (table === 'get_game_stats_resolved' && options.failStatsAccess) return Promise.resolve({ data: null, error: { code: '42501', message: 'APP_ACCESS_SUSPENDED' } }).then(resolve,reject)
        if (table === 'game_event_setup_snapshots' && options.failSetups) return Promise.resolve({ data: null, error: { message: 'denied' } }).then(resolve, reject)
        let data: unknown[] = table === 'games' ? games : table === 'game_event_setup_snapshots' ? (options.events ?? []).map(game_id => ({ game_id }))
          : table === 'get_game_stats_resolved' ? options.lines?.[id!] ?? [{ player_id: 'p', stat_id: '1b', value: 3 }]
            : table === 'players' ? [{ id: 'p', first_name: 'Historical', last_name: 'Player', nickname: null, is_team_placeholder: false }] : []
        data = data.filter(row => filters.every(([key, value]) => {
          if (key === 'is_team_placeholder') return true
          const found = (row as Record<string, unknown>)[key]
          return Array.isArray(value) ? value.includes(found) : found === value
        }))
        return Promise.resolve({ data: data.slice(start,end + 1), error: null }).then(resolve, reject)
      } }
    return q
  }
  return { client: client as unknown as SupabaseClient, calls }
}
beforeEach(() => setCurrentAuthUserId('a'))
afterEach(resetCurrentAuthUserIdForTests)
describe('BSB-7B RLS-backed separate Legacy Totals', () => {
  it('accepts provable Baseball and rejects explicit conflicts, contradictory team sport and unfinished rows', () => {
    expect(baseballLegacyProvenance(game())).toBe('baseball')
    expect(baseballLegacyProvenance(game('g',{ sport_id: null }))).toBe('baseball')
    expect(baseballLegacyProvenance(game('g',{ sport_id: 'football' }))).toBe('excluded')
    expect(baseballLegacyProvenance(game('g',{ teams: { name: 'Other', seasons: { sport: 'football', name: 'S' } } }))).toBe('excluded')
    expect(baseballLegacyProvenance(game('g',{ status: 'in_progress' }))).toBe('excluded')
    expect(parseBaseballLegacyGame({ ...game(), teams: [] })).toBeNull()
  })
  it('uses resolved correction counters, allowlists stat ids, and excludes known team/opponent rows', async () => {
    const backend = fake([game()], { lines: { g: [{ player_id: 'p', stat_id: '1b', value: 4, source: 'correction' }, { player_id: 'p', stat_id: 'bsb_h', value: 99 }, { player_id: 'opp', stat_id: '1b', value: 100 }, { player_id: 'home', stat_id: '1b', value: 100 }] } })
    const result = await loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: backend.client })
    expect(result.players).toHaveLength(1)
    expect(result.players[0].stats).toEqual({ '1b': 4 })
    expect(backend.calls.map(row => row.table)).not.toContain('get_season_stats_resolved')
  })
  it('proves absence of ALL event setups and fails closed when that proof errors', async () => {
    const backend = fake([game()], { events: ['g'] })
    expect((await loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: backend.client })).games).toHaveLength(0)
    expect(backend.calls.some(row => row.table === 'get_game_stats_resolved')).toBe(false)
    await expect(loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: fake([game()], { failSetups: true }).client })).rejects.toThrow('event-authority')
  })
  it('does not disguise a revoked session/access error as partial game quality', async () => {
    await expect(loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: fake([game()], { failStatsAccess: true }).client })).rejects.toMatchObject({ code: 'access_denied' })
  })
  it('pages games beyond the row limit and filters zero roster rows to the exact scope', async () => {
    const backend = fake(Array.from({ length: 201 }, (_, i) => game(`g${i}`)))
    const result = await loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: backend.client,
      activeRoster: [{ playerId: 'zero', displayName: 'Zero', number: null, teamId: 't' }, { playerId: 'foreign', displayName: 'Foreign', number: null, teamId: 'other' }] })
    expect(result.games).toHaveLength(201)
    expect(result.players.find(row => row.playerId === 'p')?.stats['1b']).toBe(603)
    expect(result.players.find(row => row.playerId === 'zero')?.games).toBe(0)
    expect(result.players.some(row => row.playerId === 'foreign')).toBe(false)
    expect(backend.calls.filter(row => row.table === 'games').map(row => row.start)).toEqual([0,200])
  })
  it.each([1.5, NaN, -1, Number.MAX_SAFE_INTEGER + 1])('isolates invalid counter %s and malformed duplicate rows', async value => {
    const backend = fake([game()], { lines: { g: [{ player_id: 'p', stat_id: '1b', value }] } })
    const result = await loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: backend.client })
    expect(result.games).toHaveLength(0); expect(result.quality).toBe('partial')
  })
  it('does not double-count duplicate resolved rows', async () => {
    const line = { player_id: 'p', stat_id: '1b', value: 2 }
    const backend = fake([game()], { lines: { g: [line,line] } })
    expect((await loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: backend.client })).exclusions[0].message).toContain('Duplicate')
  })
  it('keeps ambiguous Personal history review-only and only lists a requested player association', async () => {
    const backend = fake([game('old',{ sport_id: null, team_id: null, season_id: null, teams: null }), game('other',{ sport_id: null, team_id: null, season_id: null, teams: null })],
      { lines: { old: [{ player_id: 'p', stat_id: '1b', value: 2 }], other: [{ player_id: 'else', stat_id: '1b', value: 5 }] } })
    const result = await loadBaseballLegacyAggregates({ type: 'career', playerId: 'p' }, { userId: 'a', client: backend.client })
    expect(result.players).toHaveLength(0); expect(result.games).toHaveLength(0)
    expect(result.reviewOnly.map(row => row.id)).toEqual(['old'])
  })
  it('rejects A -> B -> A during a read instead of settling the old account epoch', async () => {
    const backend = fake([game()], { onRead: table => { if (table === 'game_event_setup_snapshots') { setCurrentAuthUserId('b'); setCurrentAuthUserId('a') } } })
    await expect(loadBaseballLegacyAggregates({ type: 'team', id: 't' }, { userId: 'a', client: backend.client })).rejects.toMatchObject({ code: 'stale_account' })
  })
})

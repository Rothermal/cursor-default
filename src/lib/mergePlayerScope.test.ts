import { describe, expect, it, vi } from 'vitest'
import { fetchMergePlayerScope } from './mergePlayerScope'

type QueryResult = { data?: unknown; error?: { message: string } | null }

function chainable(result: QueryResult) {
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = vi.fn(self)
  api.eq = vi.fn(self)
  api.in = vi.fn(self)
  api.not = vi.fn(self)
  // thenable so `await supabase.from(...).select...` resolves
  api.then = (resolve: (v: QueryResult) => unknown) => Promise.resolve(result).then(resolve)
  return api
}

describe('fetchMergePlayerScope', () => {
  it('returns empty when user has no admin or owned teams', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'team_members') return chainable({ data: [], error: null })
      if (table === 'teams') return chainable({ data: [], error: null })
      throw new Error(`unexpected table ${table}`)
    })
    const result = await fetchMergePlayerScope({ from } as never, 'user-1')
    expect(result).toEqual({ teamIds: [], candidates: [] })
  })

  it('unions owned and admin teams and dedupes candidates', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'team_members') {
        return chainable({ data: [{ team_id: 't1' }], error: null })
      }
      if (table === 'teams') {
        return chainable({ data: [{ id: 't1' }, { id: 't2' }], error: null })
      }
      if (table === 'team_players') {
        return chainable({
          data: [
            {
              player_id: 'p1',
              players: {
                id: 'p1',
                first_name: 'Ada',
                last_name: 'L',
                nickname: null,
                is_team_placeholder: false,
              },
            },
            {
              player_id: 'p1',
              players: {
                id: 'p1',
                first_name: 'Ada',
                last_name: 'L',
                nickname: null,
                is_team_placeholder: false,
              },
            },
            {
              player_id: 'ph',
              players: {
                id: 'ph',
                first_name: 'Home',
                last_name: null,
                nickname: null,
                is_team_placeholder: true,
              },
            },
            {
              player_id: 'p2',
              players: {
                id: 'p2',
                first_name: 'Grace',
                last_name: 'H',
                nickname: 'GH',
              },
            },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table ${table}`)
    })

    const result = await fetchMergePlayerScope({ from } as never, 'user-1')
    expect(result.teamIds.sort()).toEqual(['t1', 't2'])
    expect(result.candidates).toEqual([
      { id: 'p1', first_name: 'Ada', last_name: 'L', nickname: null },
      { id: 'p2', first_name: 'Grace', last_name: 'H', nickname: 'GH' },
    ])
  })

  it('falls back to legacy select when is_team_placeholder column is missing', async () => {
    let teamPlayersCalls = 0
    const from = vi.fn((table: string) => {
      if (table === 'team_members') {
        return chainable({ data: [{ team_id: 't1' }], error: null })
      }
      if (table === 'teams') {
        return chainable({ data: [], error: null })
      }
      if (table === 'team_players') {
        teamPlayersCalls += 1
        if (teamPlayersCalls === 1) {
          return chainable({
            data: null,
            error: { message: 'column players.is_team_placeholder does not exist' },
          })
        }
        return chainable({
          data: [
            {
              player_id: 'p1',
              players: { id: 'p1', first_name: 'Ada', last_name: null, nickname: null },
            },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table ${table}`)
    })

    const result = await fetchMergePlayerScope({ from } as never, 'user-1')
    expect(teamPlayersCalls).toBe(2)
    expect(result.candidates).toEqual([
      { id: 'p1', first_name: 'Ada', last_name: null, nickname: null },
    ])
  })
})

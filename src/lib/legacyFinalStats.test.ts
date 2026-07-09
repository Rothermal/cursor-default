import { describe, expect, it, vi } from 'vitest'
import { loadLegacyFinalStatsTotals } from './legacyFinalStats'

function mockClient(
  responses: Record<string, { data?: { stat_id: string; value: number }[]; error?: { message: string } }>
) {
  return {
    rpc: vi.fn(async (_name: string, args: { p_game_id: string }) => {
      return responses[args.p_game_id] ?? { data: [], error: null }
    }),
  }
}

describe('loadLegacyFinalStatsTotals', () => {
  it('returns empty when no legacy finals need resolution', async () => {
    const client = mockClient({})
    const totals = await loadLegacyFinalStatsTotals(client as never, [
      { id: 'g1', status: 'final', home_team_score: 72 },
      { id: 'g2', status: 'in_progress', home_team_score: null },
    ])
    expect(totals).toEqual({})
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('sums resolved stats per legacy final game', async () => {
    const client = mockClient({
      g1: {
        data: [
          { stat_id: '2pt', value: 10 },
          { stat_id: '2pt', value: 4 },
          { stat_id: '3pt', value: 3 },
        ],
      },
      g2: {
        data: [{ stat_id: 'ft', value: 5 }],
      },
    })
    const totals = await loadLegacyFinalStatsTotals(client as never, [
      { id: 'g1', status: 'final', home_team_score: null },
      { id: 'g2', status: 'final', home_team_score: null },
      { id: 'g3', status: 'final', home_team_score: 80 },
    ])
    expect(totals).toEqual({
      g1: { '2pt': 14, '3pt': 3 },
      g2: { ft: 5 },
    })
    expect(client.rpc).toHaveBeenCalledTimes(2)
  })

  it('omits games whose RPC fails', async () => {
    const client = mockClient({
      g1: { error: { message: 'boom' } },
      g2: { data: [{ stat_id: '2pt', value: 2 }] },
    })
    const totals = await loadLegacyFinalStatsTotals(client as never, [
      { id: 'g1', status: 'final', home_team_score: null },
      { id: 'g2', status: 'final', home_team_score: null },
    ])
    expect(totals).toEqual({ g2: { '2pt': 2 } })
  })
})

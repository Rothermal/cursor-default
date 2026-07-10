import { describe, expect, it } from 'vitest'
import { buildResolvedByGameForPlayer } from './playerStatSummaryTables'

describe('buildResolvedByGameForPlayer', () => {
  it('aggregates matching player rows per game id', () => {
    const result = buildResolvedByGameForPlayer(
      ['g1', 'g2'],
      'p1',
      [
        [
          { player_id: 'p1', stat_id: 'pts', value: 10 },
          { player_id: 'p1', stat_id: 'pts', value: 2 },
          { player_id: 'p2', stat_id: 'pts', value: 99 },
        ],
        [{ player_id: 'p1', stat_id: 'ast', value: 3 }],
      ]
    )
    expect(result).toEqual({
      g1: { pts: 12 },
      g2: { ast: 3 },
    })
  })

  it('returns empty stat maps when a game has no rows for the player', () => {
    expect(buildResolvedByGameForPlayer(['g1'], 'p1', [[{ player_id: 'p2', stat_id: 'pts', value: 1 }]])).toEqual({
      g1: {},
    })
  })

  it('tolerates missing row arrays', () => {
    expect(buildResolvedByGameForPlayer(['g1', 'g2'], 'p1', [])).toEqual({
      g1: {},
      g2: {},
    })
  })
})

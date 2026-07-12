import { describe, expect, it } from 'vitest'
import { sports } from '../config/sports'
import { getDisplayedHomeScore, resolveFinalHomeScoreFromGameRow } from './gameScore'

const basketball = sports.find(s => s.id === 'basketball')!

describe('getDisplayedHomeScore', () => {
  it('returns standalone homeTeamScore when set', () => {
    expect(
      getDisplayedHomeScore(
        basketball,
        [{ stats: { '2pt': 10, '3pt': 3 } }],
        55,
        99
      )
    ).toBe(55)
  })

  it('sums player scoring stats plus adjustment when homeTeamScore is null', () => {
    // 2×2pt + 1×3pt = 7, + adjustment 2 = 9
    expect(
      getDisplayedHomeScore(
        basketball,
        [
          { stats: { '2pt': 2, '3pt': 1 } },
          { stats: { ft: 0 } },
        ],
        null,
        2
      )
    ).toBe(9)
  })

  it('treats empty roster as zero plus adjustment', () => {
    expect(getDisplayedHomeScore(basketball, [], null, 3)).toBe(3)
  })
})

describe('resolveFinalHomeScoreFromGameRow', () => {
  it('prefers home_team_score on the game row', () => {
    expect(
      resolveFinalHomeScoreFromGameRow(basketball, { '2pt': 20 }, {
        home_team_score: 48,
        home_score_adjustment: 5,
      })
    ).toBe(48)
  })

  it('computes from aggregated stats plus adjustment when home_team_score is null', () => {
    // 5×2pt = 10 + adjustment 4 = 14
    expect(
      resolveFinalHomeScoreFromGameRow(basketball, { '2pt': 5 }, {
        home_team_score: null,
        home_score_adjustment: 4,
      })
    ).toBe(14)
  })

  it('treats missing home_score_adjustment as zero', () => {
    expect(
      resolveFinalHomeScoreFromGameRow(basketball, { '3pt': 2 }, {
        home_team_score: null,
      })
    ).toBe(6)
  })
})

import { describe, expect, it } from 'vitest'
import {
  BASKETBALL_AGGREGATE_CATEGORY_IDS,
  BASKETBALL_AGGREGATE_STAT_DEFINITIONS,
  BASKETBALL_CANONICAL_STAT_IDS,
  basketballAggregateRates,
  basketballAggregateSportCategories,
  basketballCanonicalStatsFromTotals,
  emptyBasketballAggregateStats,
  formatBasketballAggregateDuration,
  formatBasketballAggregateStat,
  formatBasketballAggregateRate,
  mergeBasketballMatchStats,
} from './aggregateStats'
import { emptyBasketballStatTotals } from './state'

describe('Basketball canonical aggregate stat contract', () => {
  it('keeps the exact unique bk catalog isolated from live SportConfig actions', () => {
    expect(BASKETBALL_CANONICAL_STAT_IDS).toHaveLength(24)
    expect(new Set(BASKETBALL_CANONICAL_STAT_IDS).size).toBe(24)
    expect(BASKETBALL_AGGREGATE_STAT_DEFINITIONS.map(definition => definition.id).sort())
      .toEqual([...BASKETBALL_CANONICAL_STAT_IDS].sort())
    expect(basketballAggregateSportCategories().map(category => category.id))
      .toEqual(BASKETBALL_AGGREGATE_CATEGORY_IDS)
  })

  it('constructs attempts, combined totals, points, participation, and recorded seconds', () => {
    const stats = basketballCanonicalStatsFromTotals({
      ft: 3, ft_miss: 2, '2pt': 4, '2pt_miss': 3, '3pt': 2, '3pt_miss': 1,
      oreb: 2, dreb: 5, ast: 6, stl: 3, blk: 1, to: 2, pf: 4, min: 17,
    }, {
      appeared: true, started: true, disqualified: true, ejected: false,
    })

    expect(stats).toEqual({
      bk_app: 1, bk_start: 1, bk_dnp: 0, bk_min_sec: 1_020, bk_pm: 0,
      bk_pts: 17,
      bk_fgm: 6, bk_fga: 10,
      bk_2pm: 4, bk_2pa: 7,
      bk_3pm: 2, bk_3pa: 3,
      bk_ftm: 3, bk_fta: 5,
      bk_oreb: 2, bk_dreb: 5, bk_reb: 7,
      bk_ast: 6, bk_to: 2, bk_stl: 3, bk_blk: 1, bk_pf: 4,
      bk_dq: 1, bk_eject: 0,
    })
  })

  it('calculates rates from summed raw numerators and returns null at zero denominators', () => {
    const stats = basketballCanonicalStatsFromTotals({
      ft: 3, ft_miss: 1, '2pt': 2, '2pt_miss': 2, '3pt': 1, '3pt_miss': 1,
      oreb: 0, dreb: 0, ast: 6, stl: 0, blk: 0, to: 3, pf: 0, min: 0,
    }, { appeared: true, started: false, disqualified: false, ejected: false })
    const rates = basketballAggregateRates(stats)
    expect(rates.points_per_game?.value).toBe(10)
    expect(rates.field_goal_percentage?.value).toBe(0.5)
    expect(rates.two_point_percentage?.value).toBe(0.5)
    expect(rates.three_point_percentage?.value).toBe(0.5)
    expect(rates.free_throw_percentage?.value).toBe(0.75)
    expect(rates.effective_field_goal_percentage?.value).toBeCloseTo(3.5 / 6)
    expect(rates.true_shooting_percentage?.value).toBeCloseTo(10 / (2 * (6 + 0.44 * 4)))
    expect(rates.assist_to_turnover_ratio?.value).toBe(2)

    const emptyRates = basketballAggregateRates(emptyBasketballAggregateStats())
    expect(Object.values(emptyRates).every(rate => rate === null)).toBe(true)
  })

  it('deduplicates match-scoped credits while preserving merged stints and formats values', () => {
    const first = basketballCanonicalStatsFromTotals(
      { ...emptyBasketballStatTotals(), '2pt': 1, min: 4 },
      { appeared: true, started: true, disqualified: false, ejected: false }
    )
    const second = basketballCanonicalStatsFromTotals(
      { ...emptyBasketballStatTotals(), '3pt': 1, min: 6 },
      { appeared: true, started: false, disqualified: true, ejected: true }
    )
    mergeBasketballMatchStats(first, second)
    expect(first).toMatchObject({
      bk_app: 1, bk_start: 1, bk_min_sec: 600, bk_pts: 5, bk_dq: 1, bk_eject: 1,
    })
    expect(formatBasketballAggregateDuration(600)).toBe('10:00')
    expect(formatBasketballAggregateStat('bk_pm', 4)).toBe('+4')
    expect(formatBasketballAggregateStat('bk_pm', -2)).toBe('-2')
    expect(formatBasketballAggregateRate({ numerator: 3, denominator: 4, value: 0.75 }, true))
      .toBe('75% (3/4)')
    expect(formatBasketballAggregateRate(
      { numerator: 3.5, denominator: 6, value: 3.5 / 6 },
      true,
      false
    )).toBe('58%')
    expect(formatBasketballAggregateRate(null, false)).toBe('-')

    const dnp = basketballCanonicalStatsFromTotals(
      emptyBasketballStatTotals(),
      {
        appeared: false,
        started: false,
        dnp: true,
        participationMs: 999,
        plusMinus: 0,
        disqualified: false,
        ejected: false,
      }
    )
    expect(dnp).toMatchObject({ bk_dnp: 1, bk_min_sec: 0, bk_pm: 0 })
    mergeBasketballMatchStats(dnp, first)
    expect(dnp).toMatchObject({ bk_app: 1, bk_dnp: 0 })
  })
})

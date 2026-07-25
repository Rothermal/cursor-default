import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import {
  SOCCER_AGGREGATE_CATEGORY_IDS,
  SOCCER_AGGREGATE_STAT_DEFINITIONS,
  SOCCER_CANONICAL_STAT_IDS,
  SOCCER_LEGACY_STAT_ALIASES,
  compareSoccerAggregatePlayerRows,
  emptySoccerAggregateStats,
  formatSoccerAggregateDuration,
  formatSoccerAggregateRate,
  normalizeSoccerAggregateStats,
  soccerAggregateRates,
} from './aggregateStats'

describe('soccer canonical aggregate stat contract', () => {
  it('uses every canonical id exactly once in SportConfig and no legacy ids', () => {
    const soccer = sports.find(sport => sport.id === 'soccer')!
    const configIds = soccer.categories.flatMap(category =>
      category.actions.map(action => action.id)
    )

    expect(soccer.categories.map(category => category.id))
      .toEqual(SOCCER_AGGREGATE_CATEGORY_IDS)
    expect(configIds).toEqual(SOCCER_CANONICAL_STAT_IDS)
    expect(new Set(configIds).size).toBe(configIds.length)
    expect(configIds).toEqual(
      SOCCER_AGGREGATE_STAT_DEFINITIONS.map(definition => definition.id)
    )
    expect(configIds.some(id => id in SOCCER_LEGACY_STAT_ALIASES)).toBe(false)
    expect(soccer.keyStatIds).toEqual(['soc_goal', 'soc_ast', 'soc_shot'])
  })

  it('keeps the basketball contract unchanged', () => {
    const basketball = sports.find(sport => sport.id === 'basketball')!
    expect(basketball.keyStatIds).toEqual(['ast', 'stl', 'blk'])
    expect(basketball.categories.map(category => category.id)).toEqual([
      'scoring',
      'rebounds',
      'playmaking',
      'other',
    ])
    expect(basketball.categories[0].actions.map(action => action.id)).toEqual([
      'ft',
      'ft_miss',
      '2pt',
      '2pt_miss',
      '3pt',
      '3pt_miss',
    ])
  })

  it('reads narrow legacy aliases without double-counting canonical values', () => {
    const legacy = normalizeSoccerAggregateStats({
      s_goal: 2,
      s_ast: 3,
      s_tackle: 4,
      s_sv: 5,
    })
    expect(legacy).toMatchObject({
      soc_goal: 2,
      soc_ast: 3,
      soc_tkl_att: 4,
      soc_gk_save: 5,
      soc_ast_primary: 0,
      soc_tkl_won: 0,
    })

    const canonicalWins = normalizeSoccerAggregateStats({
      soc_goal: 1,
      s_goal: 99,
    })
    expect(canonicalWins.soc_goal).toBe(1)
  })

  it('formats aggregate seconds and combined rates at their boundaries', () => {
    expect(formatSoccerAggregateDuration(0)).toBe('0:00')
    expect(formatSoccerAggregateDuration(3_599)).toBe('59:59')
    expect(formatSoccerAggregateDuration(3_600)).toBe('1:00:00')
    expect(formatSoccerAggregateDuration(3_661)).toBe('1:01:01')

    const stats = emptySoccerAggregateStats()
    stats.soc_shot = 8
    stats.soc_sot = 5
    stats.soc_goal = 2
    stats.soc_tkl_att = 0
    stats.soc_gk_sot_faced = 4
    stats.soc_gk_save = 3
    const rates = soccerAggregateRates(stats)

    expect(rates.shot_accuracy).toEqual({
      numerator: 5,
      denominator: 8,
      value: 0.625,
    })
    expect(rates.goal_conversion?.value).toBe(0.25)
    expect(rates.tackle_win).toBeNull()
    expect(formatSoccerAggregateRate(rates.goalkeeper_save)).toBe('75% (3/4)')
    expect(formatSoccerAggregateRate(null)).toBe('-')
  })

  it('sorts deterministically by selected value and reviewed tie-breakers', () => {
    const first = {
      playerId: 'player-b',
      displayName: 'Beta',
      stats: { ...emptySoccerAggregateStats(), soc_goal: 2, soc_ast: 1 },
    }
    const second = {
      playerId: 'player-a',
      displayName: 'Alpha',
      stats: { ...emptySoccerAggregateStats(), soc_goal: 2, soc_ast: 2 },
    }
    const third = {
      playerId: 'player-c',
      displayName: 'Gamma',
      stats: { ...emptySoccerAggregateStats(), soc_goal: 1, soc_ast: 9 },
    }

    expect([first, second, third].sort(compareSoccerAggregatePlayerRows)
      .map(row => row.playerId)).toEqual(['player-a', 'player-b', 'player-c'])
  })
})

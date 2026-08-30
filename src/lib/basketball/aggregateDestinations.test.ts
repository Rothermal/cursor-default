import { describe, expect, it } from 'vitest'
import { aggregateBasketballSources } from './aggregateComposition'
import {
  BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES,
  basketballAggregateCategoryHasValues,
  basketballAggregateMetricAvailable,
  basketballAggregateMetricLabel,
  basketballPlayerAggregateMetricAvailable,
  basketballAggregateRankingMetrics,
  basketballAggregateVisibleColumns,
  formatBasketballAggregateMetric,
  shouldAutoRefreshBasketballAggregates,
  sortBasketballAggregatePlayers,
} from './aggregateDestinations'
import {
  AGGREGATE_PLAYERS,
  ANCHORED_AGGREGATE_PLAYERS,
  makeAnchoredCanonicalAggregateSource,
  makeCanonicalAggregateSource,
  makeLegacyAggregateSource,
} from './aggregateTestFixtures'

describe('Basketball aggregate destination adapter', () => {
  it('exposes Scoring first and suppresses rankings unavailable in mixed history', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [makeCanonicalAggregateSource()],
      [makeLegacyAggregateSource()]
    )
    expect(BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES[0]).toMatchObject({
      id: 'scoring', defaultMetricId: 'bk_pts',
    })
    const discipline = BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.find(
      category => category.id === 'discipline'
    )!
    expect(basketballAggregateRankingMetrics(aggregate, discipline)).toEqual(['bk_pf', 'bk_app'])
    expect(basketballAggregateMetricAvailable(aggregate, 'bk_dq')).toBe(false)
    expect(basketballAggregateVisibleColumns(discipline, 'bk_pf', aggregate))
      .toEqual(['bk_pf', 'bk_app'])
  })

  it('sorts scoring by points, PPG, appearances, and stable name order', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [makeCanonicalAggregateSource()],
      [makeLegacyAggregateSource()]
    )
    const ordered = sortBasketballAggregatePlayers(aggregate.players, 'bk_pts')
    expect(ordered[0].playerId).toBe(AGGREGATE_PLAYERS.starter)
    expect(ordered[1].playerId).toBe(AGGREGATE_PLAYERS.late)
  })

  it('formats canonical totals and rates and keeps Participation visible at zero', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [],
      [],
      [{ playerId: 'zero', displayName: 'Zero', number: null, teamId: 'team-1' }]
    )
    const zero = aggregate.players[0]
    const participation = BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.find(
      category => category.id === 'participation'
    )!
    const scoring = BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.find(
      category => category.id === 'scoring'
    )!
    expect(basketballAggregateCategoryHasValues([zero], participation, aggregate)).toBe(true)
    expect(basketballAggregateCategoryHasValues([zero], scoring, aggregate)).toBe(false)
    expect(formatBasketballAggregateMetric(zero, 'bk_min_sec')).toBe('00:00')
    expect(formatBasketballAggregateMetric(zero, 'field_goal_percentage')).toBe('-')
    expect(basketballAggregateMetricLabel('effective_field_goal_percentage'))
      .toEqual({ label: 'Effective Field Goal Percentage', shortLabel: 'eFG%' })
  })

  it('shows count operands for ordinary percentages but not eFG or true shooting formulas', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [],
      [makeLegacyAggregateSource()]
    )
    const player = aggregate.players[0]
    expect(formatBasketballAggregateMetric(player, 'field_goal_percentage')).toBe('57% (4/7)')
    expect(formatBasketballAggregateMetric(player, 'effective_field_goal_percentage')).toBe('64%')
    expect(formatBasketballAggregateMetric(player, 'true_shooting_percentage')).toBe('66%')
  })

  it('refreshes visible idle destinations with focus-event debouncing', () => {
    expect(shouldAutoRefreshBasketballAggregates({
      loading: false, visible: true, now: 1_000, lastRefreshAt: 0,
    })).toBe(true)
    expect(shouldAutoRefreshBasketballAggregates({
      loading: true, visible: true, now: 1_000, lastRefreshAt: 0,
    })).toBe(false)
    expect(shouldAutoRefreshBasketballAggregates({
      loading: false, visible: true, now: 100, lastRefreshAt: 0,
    })).toBe(false)
  })

  it('suppresses partial plus-minus rankings while retaining individual review', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'career', id: ANCHORED_AGGREGATE_PLAYERS.starter },
      [makeAnchoredCanonicalAggregateSource()],
      [makeLegacyAggregateSource({ playerId: ANCHORED_AGGREGATE_PLAYERS.starter })]
    )
    const participation = BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.find(
      category => category.id === 'participation'
    )!
    const player = aggregate.players[0]
    expect(basketballAggregateRankingMetrics(aggregate, participation)).not.toContain('bk_pm')
    expect(basketballPlayerAggregateMetricAvailable(aggregate, player, 'bk_pm')).toBe(true)
    expect(formatBasketballAggregateMetric(player, 'bk_pm')).toBe('+2')
  })
})

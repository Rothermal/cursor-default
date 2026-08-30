import { describe, expect, it } from 'vitest'
import { aggregateBasketballSources } from './aggregateComposition'
import {
  basketballPlayerAggregateGames,
  basketballPlayerCareerSegments,
  basketballPlayerGameMetricAvailability,
  basketballPlayerProfileBreakdown,
  selectBasketballAggregatePlayer,
  visibleBasketballPlayerAggregateCategories,
} from './aggregatePlayerDestinations'
import {
  AGGREGATE_PLAYERS,
  ANCHORED_AGGREGATE_PLAYERS,
  makeAnchoredCanonicalAggregateSource,
  makeCanonicalAggregateSource,
  makeLegacyAggregateSource,
} from './aggregateTestFixtures'

describe('Basketball player and career aggregate destinations', () => {
  it('selects only stable player identity and returns a zero row when absent', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'career', id: AGGREGATE_PLAYERS.starter },
      [makeCanonicalAggregateSource()],
      []
    )
    const selected = selectBasketballAggregatePlayer(aggregate, {
      playerId: AGGREGATE_PLAYERS.starter,
      displayName: 'Current Name',
      number: '9',
    })
    expect(selected).toMatchObject({ displayName: 'Current Name', number: '9', stats: { bk_app: 1 } })
    expect(selectBasketballAggregatePlayer(aggregate, {
      playerId: 'different-id', displayName: 'Starter One', number: null,
    }).stats.bk_app).toBe(0)
  })

  it('keeps team and personal histories in separate career segments', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'career', id: AGGREGATE_PLAYERS.starter },
      [
        makeCanonicalAggregateSource(),
        makeCanonicalAggregateSource({
          gameId: 'personal-game', cloudScope: 'personal', teamId: null, date: '2026-08-21',
        }),
      ],
      [makeLegacyAggregateSource()]
    )
    const identity = {
      playerId: AGGREGATE_PLAYERS.starter,
      displayName: 'Starter One',
      number: '1',
    }
    const games = basketballPlayerAggregateGames(aggregate, identity.playerId)
    expect(games).toHaveLength(3)
    const segments = basketballPlayerCareerSegments(aggregate, identity)
    expect(segments.map(segment => segment.kind)).toEqual(['personal', 'team'])
    expect(segments[0]).toMatchObject({ teamName: 'Personal', teamId: null })
    expect(segments[1]).toMatchObject({ teamName: 'Aces', teamId: 'team-1' })
    expect(segments[1].player.stats.bk_app).toBe(2)
  })

  it('always keeps Participation while hiding other all-zero player categories', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [],
      [],
      [{ playerId: 'zero', displayName: 'Zero', number: null, teamId: 'team-1' }]
    )
    expect(visibleBasketballPlayerAggregateCategories(aggregate, aggregate.players[0])
      .map(category => category.id)).toEqual(['participation'])
  })

  it('keeps authorized personal games separate from scoped profile team totals', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'player', id: AGGREGATE_PLAYERS.starter },
      [
        makeCanonicalAggregateSource(),
        makeCanonicalAggregateSource({
          gameId: 'personal-game',
          cloudScope: 'personal',
          teamId: null,
          date: '2026-08-21',
        }),
      ],
      [makeLegacyAggregateSource()]
    )
    const scoped = aggregateBasketballSources(
      { type: 'player', id: AGGREGATE_PLAYERS.starter },
      [makeCanonicalAggregateSource()],
      [makeLegacyAggregateSource()]
    )
    const breakdown = basketballPlayerProfileBreakdown(
      scoped,
      aggregate,
      {
        playerId: AGGREGATE_PLAYERS.starter,
        displayName: 'Starter One',
        number: '1',
      }
    )

    expect(breakdown.teamGames).toHaveLength(2)
    expect(breakdown.teamPlayer.stats.bk_app).toBe(2)
    expect(breakdown.personalSegment).toMatchObject({
      kind: 'personal',
      teamName: 'Personal',
      games: [{ gameId: 'personal-game' }],
    })
  })

  it('returns a zero profile row when only personal history is available', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'player', id: AGGREGATE_PLAYERS.starter },
      [makeCanonicalAggregateSource({
        gameId: 'personal-only',
        cloudScope: 'personal',
        teamId: null,
      })],
      []
    )
    const scoped = aggregateBasketballSources(
      { type: 'player', id: AGGREGATE_PLAYERS.starter },
      [],
      []
    )
    const breakdown = basketballPlayerProfileBreakdown(
      scoped,
      aggregate,
      {
        playerId: AGGREGATE_PLAYERS.starter,
        displayName: 'Starter One',
        number: '1',
      }
    )

    expect(breakdown.teamPlayer.stats.bk_app).toBe(0)
    expect(breakdown.teamGames).toEqual([])
    expect(breakdown.personalSegment?.games).toHaveLength(1)
  })

  it('computes metric availability within each career segment', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'career', id: AGGREGATE_PLAYERS.starter },
      [
        makeCanonicalAggregateSource(),
        makeCanonicalAggregateSource({
          gameId: 'personal-game',
          cloudScope: 'personal',
          teamId: null,
        }),
      ],
      [makeLegacyAggregateSource()]
    )
    const segments = basketballPlayerCareerSegments(aggregate, {
      playerId: AGGREGATE_PLAYERS.starter,
      displayName: 'Starter One',
      number: '1',
    })
    const personal = segments.find(segment => segment.kind === 'personal')!
    const team = segments.find(segment => segment.kind === 'team')!

    expect(basketballPlayerGameMetricAvailability(personal.games)).toContain('bk_start')
    expect(basketballPlayerGameMetricAvailability(team.games)).not.toContain('bk_start')
  })

  it('recomposes partial plus-minus coverage within a career segment', () => {
    const playerId = ANCHORED_AGGREGATE_PLAYERS.starter
    const aggregate = aggregateBasketballSources(
      { type: 'career', id: playerId },
      [makeAnchoredCanonicalAggregateSource()],
      [makeLegacyAggregateSource({ playerId })]
    )
    const segment = basketballPlayerCareerSegments(aggregate, {
      playerId,
      displayName: 'Anchored starter',
      number: null,
    })[0]
    expect(segment.player).toMatchObject({
      participationBasis: 'mixed',
      stats: { bk_pm: 2 },
      metricCoverage: {
        bk_pm: { includedGameCount: 1, totalGameCount: 2, complete: false },
      },
    })
    expect(basketballPlayerGameMetricAvailability(segment.games, playerId))
      .not.toContain('bk_pm')
  })
})

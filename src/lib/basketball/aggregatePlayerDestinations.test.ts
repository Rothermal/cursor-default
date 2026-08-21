import { describe, expect, it } from 'vitest'
import { aggregateBasketballSources } from './aggregateComposition'
import {
  basketballPlayerAggregateGames,
  basketballPlayerCareerSegments,
  selectBasketballAggregatePlayer,
  visibleBasketballPlayerAggregateCategories,
} from './aggregatePlayerDestinations'
import {
  AGGREGATE_PLAYERS,
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
})

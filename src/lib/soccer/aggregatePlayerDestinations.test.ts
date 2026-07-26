import { describe, expect, it } from 'vitest'
import {
  selectSoccerAggregatePlayer,
  soccerPlayerAggregateGames,
  soccerPlayerCareerSegments,
  visibleSoccerPlayerAggregateCategories,
} from './aggregatePlayerDestinations'
import {
  emptySoccerAggregateStats,
  soccerAggregateRates,
  type SoccerAggregateStats,
} from './aggregateStats'
import type {
  SoccerAggregateGame,
  SoccerAggregatePlayer,
  SoccerAggregateResult,
} from './aggregateProjection'

describe('soccer player aggregate destinations', () => {
  it('selects only the requested current stable player identity', () => {
    const aggregate = result({
      players: [
        player('survivor', { soc_goal: 3, soc_app: 2 }, ['game-1', 'game-2']),
        player('teammate', { soc_goal: 9, soc_app: 2 }, ['game-1', 'game-2']),
      ],
    })

    expect(selectSoccerAggregatePlayer(aggregate, {
      playerId: 'survivor',
      displayName: 'Current Player',
      number: '10',
    })).toMatchObject({
      playerId: 'survivor',
      displayName: 'Current Player',
      number: '10',
      stats: { soc_goal: 3, soc_app: 2 },
    })
  })

  it('always shows Participation and hides every other all-zero category', () => {
    const aggregate = result()
    const selected = selectSoccerAggregatePlayer(aggregate, {
      playerId: 'reserve',
      displayName: 'Reserve Player',
      number: '18',
    })

    expect(
      visibleSoccerPlayerAggregateCategories(selected).map(category => category.id)
    ).toEqual(['participation'])

    selected.stats.soc_gk_save = 2
    selected.rates = soccerAggregateRates(selected.stats)
    expect(
      visibleSoccerPlayerAggregateCategories(selected).map(category => category.id)
    ).toEqual(['participation', 'goalkeeping'])
  })

  it('keeps only games containing the requested stable player', () => {
    const aggregate = result({
      players: [player('player-1', { soc_app: 1 }, ['game-1'])],
      games: [
        game('game-1', 'season-1', 'team-1', { 'player-1': stats({ soc_app: 1 }) }),
        game('game-2', 'season-1', 'team-1', { teammate: stats({ soc_app: 1 }) }),
      ],
    })

    expect(soccerPlayerAggregateGames(aggregate, 'player-1').map(row => row.gameId))
      .toEqual(['game-1'])
  })

  it('rebuilds season/team history from canonical per-game totals', () => {
    const aggregate = result({
      players: [
        player('player-1', { soc_app: 3, soc_goal: 3, soc_shot: 6 }, [
          'game-1',
          'game-2',
          'game-3',
        ]),
      ],
      games: [
        game('game-1', 'season-2', 'team-2', {
          'player-1': stats({ soc_app: 1, soc_goal: 2, soc_shot: 3 }),
        }, '2026-07-20'),
        game('game-2', 'season-1', 'team-1', {
          'player-1': stats({ soc_app: 1, soc_goal: 1, soc_shot: 2 }),
        }, '2025-07-20'),
        game('game-3', 'season-1', 'team-1', {
          'player-1': stats({ soc_app: 1, soc_shot: 1 }),
        }, '2025-07-10'),
      ],
    })

    const segments = soccerPlayerCareerSegments(aggregate, {
      playerId: 'player-1',
      displayName: 'Player One',
      number: '10',
    })

    expect(segments.map(segment => segment.key)).toEqual([
      'season-2::team-2',
      'season-1::team-1',
    ])
    expect(segments[1].player.stats).toMatchObject({
      soc_app: 2,
      soc_goal: 1,
      soc_shot: 3,
    })
    expect(segments[1].player.rates.goal_conversion?.value).toBeCloseTo(1 / 3)
  })
})

function stats(values: Partial<SoccerAggregateStats> = {}): SoccerAggregateStats {
  return { ...emptySoccerAggregateStats(), ...values }
}

function player(
  playerId: string,
  values: Partial<SoccerAggregateStats>,
  matchIds: string[]
): SoccerAggregatePlayer {
  const totals = stats(values)
  return {
    playerId,
    displayName: playerId,
    number: null,
    teamIds: ['team-1'],
    matchIds,
    stats: totals,
    rates: soccerAggregateRates(totals),
  }
}

function game(
  gameId: string,
  seasonId: string,
  teamId: string,
  playerStats: Record<string, SoccerAggregateStats>,
  date = '2026-07-20'
): SoccerAggregateGame {
  return {
    publicationId: `publication-${gameId}`,
    gameId,
    teamId,
    seasonId,
    tournamentId: null,
    date,
    trackedTeamName: `Team ${teamId}`,
    opponentName: 'Opponent',
    trackedScore: 2,
    opponentScore: 1,
    result: 'win',
    playerStats,
  }
}

function result(
  overrides: Partial<SoccerAggregateResult> = {}
): SoccerAggregateResult {
  return {
    scope: { type: 'career', id: 'player-1' },
    quality: 'complete',
    includedMatchCount: 0,
    newestMatchDate: null,
    oldestMatchDate: null,
    players: [],
    teams: [],
    games: [],
    exclusions: [],
    metrics: {
      sourceCount: 0,
      includedMatchCount: 0,
      eventCount: 0,
      unresolvedParticipantCount: 0,
      excludedContributionCount: 0,
      malformedPublicationCount: 0,
    },
    ...overrides,
  }
}

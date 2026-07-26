import {
  SOCCER_AGGREGATE_DESTINATION_CATEGORIES,
  soccerAggregateCategoryHasValues,
  type SoccerAggregateCategoryDestination,
} from './aggregateDestinations'
import {
  addSoccerAggregateStatsInPlace,
  emptySoccerAggregateStats,
  soccerAggregateRates,
} from './aggregateStats'
import type {
  SoccerAggregateGame,
  SoccerAggregatePlayer,
  SoccerAggregateResult,
} from './aggregateProjection'

export interface SoccerAggregatePlayerIdentity {
  playerId: string
  displayName: string
  number: string | null
  teamIds?: string[]
}

export interface SoccerPlayerCareerSegment {
  key: string
  seasonId: string | null
  teamId: string
  teamName: string
  newestGameDate: string
  oldestGameDate: string
  games: SoccerAggregateGame[]
  player: SoccerAggregatePlayer
}

export function selectSoccerAggregatePlayer(
  aggregate: SoccerAggregateResult,
  identity: SoccerAggregatePlayerIdentity
): SoccerAggregatePlayer {
  const resolved = aggregate.players.find(player => player.playerId === identity.playerId)
  if (resolved) {
    return {
      ...resolved,
      displayName: identity.displayName,
      number: identity.number ?? resolved.number,
      teamIds: [...new Set([
        ...resolved.teamIds,
        ...(identity.teamIds ?? []),
      ])].sort(),
    }
  }
  const stats = emptySoccerAggregateStats()
  return {
    playerId: identity.playerId,
    displayName: identity.displayName,
    number: identity.number,
    teamIds: [...new Set(identity.teamIds ?? [])].sort(),
    matchIds: [],
    stats,
    rates: soccerAggregateRates(stats),
  }
}

export function visibleSoccerPlayerAggregateCategories(
  player: SoccerAggregatePlayer
): SoccerAggregateCategoryDestination[] {
  return SOCCER_AGGREGATE_DESTINATION_CATEGORIES.filter(category =>
    soccerAggregateCategoryHasValues([player], category)
  )
}

export function soccerPlayerAggregateGames(
  aggregate: SoccerAggregateResult,
  playerId: string
): SoccerAggregateGame[] {
  const matchIds = new Set(
    aggregate.players.find(player => player.playerId === playerId)?.matchIds ?? []
  )
  return aggregate.games.filter(game =>
    matchIds.has(game.gameId) && game.playerStats[playerId] !== undefined
  )
}

export function soccerPlayerCareerSegments(
  aggregate: SoccerAggregateResult,
  identity: SoccerAggregatePlayerIdentity
): SoccerPlayerCareerSegment[] {
  const segments = new Map<string, SoccerAggregateGame[]>()
  for (const game of soccerPlayerAggregateGames(aggregate, identity.playerId)) {
    const key = `${game.seasonId ?? 'unassigned'}::${game.teamId}`
    const games = segments.get(key) ?? []
    games.push(game)
    segments.set(key, games)
  }

  return [...segments.entries()]
    .map(([key, games]) => {
      const first = games[0]
      const stats = emptySoccerAggregateStats()
      for (const game of games) {
        addSoccerAggregateStatsInPlace(stats, game.playerStats[identity.playerId])
      }
      return {
        key,
        seasonId: first.seasonId,
        teamId: first.teamId,
        teamName: first.trackedTeamName,
        newestGameDate: games[0].date,
        oldestGameDate: games[games.length - 1].date,
        games,
        player: {
          playerId: identity.playerId,
          displayName: identity.displayName,
          number: identity.number,
          teamIds: [first.teamId],
          matchIds: games.map(game => game.gameId),
          stats,
          rates: soccerAggregateRates(stats),
        },
      }
    })
    .sort((left, right) =>
      right.newestGameDate.localeCompare(left.newestGameDate) ||
      left.teamName.localeCompare(right.teamName) ||
      left.key.localeCompare(right.key)
    )
}

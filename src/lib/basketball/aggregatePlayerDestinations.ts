import type {
  BasketballAggregateGame,
  BasketballAggregatePlayer,
  BasketballAggregateResult,
} from './aggregateComposition'
import {
  BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES,
  basketballAggregateCategoryHasValues,
  type BasketballAggregateCategoryDestination,
} from './aggregateDestinations'
import {
  BASKETBALL_CANONICAL_STAT_IDS,
  addBasketballAggregateStatsInPlace,
  basketballAggregateRates,
  emptyBasketballAggregateStats,
  type BasketballCanonicalStatId,
} from './aggregateStats'

export interface BasketballAggregatePlayerIdentity {
  playerId: string
  displayName: string
  number: string | null
  teamIds?: string[]
}

export interface BasketballPlayerCareerSegment {
  key: string
  kind: 'team' | 'personal'
  seasonId: string | null
  teamId: string | null
  teamName: string
  newestGameDate: string
  oldestGameDate: string
  games: BasketballAggregateGame[]
  player: BasketballAggregatePlayer
}

export interface BasketballPlayerProfileBreakdown {
  teamPlayer: BasketballAggregatePlayer
  teamGames: BasketballAggregateGame[]
  personalSegment: BasketballPlayerCareerSegment | null
}

export function selectBasketballAggregatePlayer(
  aggregate: BasketballAggregateResult,
  identity: BasketballAggregatePlayerIdentity
): BasketballAggregatePlayer {
  const resolved = aggregate.players.find(player => player.playerId === identity.playerId)
  if (resolved) {
    return {
      ...resolved,
      displayName: identity.displayName,
      number: identity.number ?? resolved.number,
      teamIds: [...new Set([...resolved.teamIds, ...(identity.teamIds ?? [])])].sort(),
    }
  }
  const stats = emptyBasketballAggregateStats()
  return {
    playerId: identity.playerId,
    displayName: identity.displayName,
    number: identity.number,
    teamIds: [...new Set(identity.teamIds ?? [])].sort(),
    matchIds: [],
    stats,
    rates: basketballAggregateRates(stats),
  }
}

export function visibleBasketballPlayerAggregateCategories(
  aggregate: BasketballAggregateResult,
  player: BasketballAggregatePlayer
): BasketballAggregateCategoryDestination[] {
  return BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.filter(category =>
    basketballAggregateCategoryHasValues([player], category, aggregate)
  )
}

export function basketballPlayerAggregateGames(
  aggregate: BasketballAggregateResult,
  playerId: string
): BasketballAggregateGame[] {
  const matchIds = new Set(
    aggregate.players.find(player => player.playerId === playerId)?.matchIds ?? []
  )
  return aggregate.games.filter(game =>
    matchIds.has(game.gameId) && game.playerStats?.[playerId] !== undefined
  )
}

export function basketballPlayerCareerSegments(
  aggregate: BasketballAggregateResult,
  identity: BasketballAggregatePlayerIdentity
): BasketballPlayerCareerSegment[] {
  const segments = new Map<string, BasketballAggregateGame[]>()
  for (const game of basketballPlayerAggregateGames(aggregate, identity.playerId)) {
    const key = game.cloudScope === 'personal'
      ? 'personal'
      : `${game.seasonId ?? 'unassigned'}::${game.teamId ?? 'unknown-team'}`
    segments.set(key, [...(segments.get(key) ?? []), game])
  }

  return [...segments.entries()].map(([key, games]) => {
    const orderedGames = [...games].sort((left, right) =>
      right.date.localeCompare(left.date) || left.sourceId.localeCompare(right.sourceId)
    )
    const first = orderedGames[0]
    const stats = emptyBasketballAggregateStats()
    for (const game of orderedGames) {
      const gameStats = game.playerStats?.[identity.playerId]
      if (gameStats) addBasketballAggregateStatsInPlace(stats, gameStats)
    }
    const dates = orderedGames.map(game => game.date)
    const personal = first.cloudScope === 'personal'
    return {
      key,
      kind: personal ? 'personal' as const : 'team' as const,
      seasonId: personal ? null : first.seasonId,
      teamId: personal ? null : first.teamId,
      teamName: personal ? 'Personal' : first.trackedTeamName,
      newestGameDate: dates.reduce((latest, date) => date > latest ? date : latest),
      oldestGameDate: dates.reduce((earliest, date) => date < earliest ? date : earliest),
      games: orderedGames,
      player: {
        playerId: identity.playerId,
        displayName: identity.displayName,
        number: identity.number,
        teamIds: first.teamId ? [first.teamId] : [],
        matchIds: orderedGames.map(game => game.gameId),
        stats,
        rates: basketballAggregateRates(stats),
      },
    }
  }).sort((left, right) =>
    right.newestGameDate.localeCompare(left.newestGameDate) ||
    left.teamName.localeCompare(right.teamName) ||
    left.key.localeCompare(right.key)
  )
}

export function basketballPlayerProfileBreakdown(
  scopedAggregate: BasketballAggregateResult,
  playerAggregate: BasketballAggregateResult,
  identity: BasketballAggregatePlayerIdentity
): BasketballPlayerProfileBreakdown {
  const personalSegment = basketballPlayerCareerSegments(playerAggregate, identity)
    .find(segment => segment.kind === 'personal') ?? null

  return {
    teamPlayer: selectBasketballAggregatePlayer(scopedAggregate, identity),
    teamGames: basketballPlayerAggregateGames(scopedAggregate, identity.playerId),
    personalSegment,
  }
}

export function basketballPlayerGameMetricAvailability(
  games: BasketballAggregateGame[]
): BasketballCanonicalStatId[] {
  if (games.length === 0) return [...BASKETBALL_CANONICAL_STAT_IDS]
  return BASKETBALL_CANONICAL_STAT_IDS.filter(metricId =>
    games.every(game => game.availableMetricIds.includes(metricId))
  )
}

import type {
  BasketballAggregateGame,
  BasketballAggregateMetricCoverage,
  BasketballAggregatePlayer,
  BasketballAggregateResult,
} from './aggregateComposition'
import {
  BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES,
  basketballAggregateMetricValue,
  basketballPlayerAggregateMetricAvailable,
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
    participationBasis: null,
    metricCoverage: {},
    stats,
    rates: basketballAggregateRates(stats),
  }
}

export function visibleBasketballPlayerAggregateCategories(
  aggregate: BasketballAggregateResult,
  player: BasketballAggregatePlayer
): BasketballAggregateCategoryDestination[] {
  return BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.filter(category => {
    if (category.id === 'participation') return true
    return category.metricIds.some(metricId => (
      basketballPlayerAggregateMetricAvailable(aggregate, player, metricId) &&
      basketballAggregateMetricValue(player, metricId) !== 0 &&
      basketballAggregateMetricValue(player, metricId) !== null
    ))
  })
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
        participationBasis: playerGameParticipationBasis(orderedGames),
        metricCoverage: playerGameMetricCoverage(orderedGames, identity.playerId),
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

function playerGameParticipationBasis(
  games: BasketballAggregateGame[]
): BasketballAggregatePlayer['participationBasis'] {
  if (games.length === 0) return null
  const values = new Set(games.map(game => game.participationBasis))
  return values.size === 1 ? [...values][0] : 'mixed'
}

function playerGameMetricCoverage(
  games: BasketballAggregateGame[],
  playerId: string
): BasketballAggregateMetricCoverage {
  const coverage: BasketballAggregateMetricCoverage = {}
  for (const metricId of ['bk_dnp', 'bk_pm'] as const) {
    const entries = games.flatMap(game => {
      const entry = game.playerMetricEligibility?.[playerId]?.[metricId]
      return entry ? [entry] : []
    })
    if (entries.length === 0) continue
    coverage[metricId] = {
      includedGameCount: entries.filter(entry => entry.eligible).length,
      totalGameCount: entries.length,
      complete: entries.every(entry => entry.eligible),
      reasons: [...new Set(entries.flatMap(entry => entry.reason ? [entry.reason] : []))],
    }
  }
  return coverage
}

export function basketballPlayerGameMetricAvailability(
  games: BasketballAggregateGame[],
  playerId?: string
): BasketballCanonicalStatId[] {
  if (games.length === 0) return [...BASKETBALL_CANONICAL_STAT_IDS]
  return BASKETBALL_CANONICAL_STAT_IDS.filter(metricId =>
    games.every(game => {
      if (playerId && (metricId === 'bk_dnp' || metricId === 'bk_pm')) {
        return game.playerMetricEligibility?.[playerId]?.[metricId]?.eligible === true
      }
      return game.availableMetricIds.includes(metricId)
    })
  )
}

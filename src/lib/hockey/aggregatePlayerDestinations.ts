import {
  addHockeyMatchPlayer,
  emptyHockeyAggregatePlayer,
  type HockeyAggregateGame,
  type HockeyAggregatePlayer,
  type HockeyAggregateResult,
} from './aggregateProjection'
import {
  HOCKEY_AGGREGATE_CATEGORIES,
  hockeyAggregateMetricValue,
  hockeyAggregateRoleGames,
  type HockeyAggregateCategory,
} from './aggregateStats'

/**
 * Player Profile and Career (HKY-6B2). A profile shows the team-season totals and keeps the
 * player's personal games separate; Career groups every game by team season, with personal
 * games in their own segment, as for Basketball.
 */

export interface HockeyAggregatePlayerIdentity {
  playerId: string
  displayName: string
  number: string | null
}

export interface HockeyPlayerCareerSegment {
  key: string
  kind: 'team' | 'personal'
  seasonId: string | null
  teamId: string | null
  teamName: string
  newestGameDate: string
  oldestGameDate: string
  games: HockeyAggregateGame[]
  player: HockeyAggregatePlayer
}

/** The player's totals in a result, or a zero line with their identity. */
export function selectHockeyAggregatePlayer(result: HockeyAggregateResult, identity: HockeyAggregatePlayerIdentity): HockeyAggregatePlayer {
  const found = result.players.find(player => player.playerId === identity.playerId)
  if (found) return { ...found, displayName: identity.displayName, number: identity.number ?? found.number }
  return emptyHockeyAggregatePlayer(identity.playerId, identity.displayName, identity.number)
}

/** Games the player has a line in, newest first. */
export function hockeyPlayerAggregateGames(result: HockeyAggregateResult, playerId: string): HockeyAggregateGame[] {
  const played = new Set(result.players.find(player => player.playerId === playerId)?.gameIds ?? [])
  return result.games.filter(game => played.has(game.gameId) && game.player?.playerId === playerId)
}

export function hockeyPlayerCareerSegments(
  result: HockeyAggregateResult,
  identity: HockeyAggregatePlayerIdentity
): HockeyPlayerCareerSegment[] {
  const groups = new Map<string, HockeyAggregateGame[]>()
  for (const game of hockeyPlayerAggregateGames(result, identity.playerId)) {
    const key = game.cloudScope === 'personal' ? 'personal' : `${game.seasonId ?? 'unassigned'}::${game.teamId ?? 'unknown-team'}`
    groups.set(key, [...(groups.get(key) ?? []), game])
  }
  return [...groups.entries()].map(([key, games]) => {
    const first = games[0]
    const personal = first.cloudScope === 'personal'
    const player = emptyHockeyAggregatePlayer(identity.playerId, identity.displayName, identity.number)
    for (const game of games) if (game.player) addHockeyMatchPlayer(player, game.player, game.gameId, personal ? null : game.teamId)
    const dates = games.map(game => game.date)
    return {
      key,
      kind: personal ? 'personal' as const : 'team' as const,
      seasonId: personal ? null : first.seasonId,
      teamId: personal ? null : first.teamId,
      teamName: personal ? 'Personal' : first.trackedTeamName,
      newestGameDate: dates.reduce((latest, date) => (date > latest ? date : latest)),
      oldestGameDate: dates.reduce((earliest, date) => (date < earliest ? date : earliest)),
      games,
      player,
    }
  }).sort((a, b) => b.newestGameDate.localeCompare(a.newestGameDate) || a.teamName.localeCompare(b.teamName) || a.key.localeCompare(b.key))
}

/**
 * Categories worth showing for one player: those in a role they played, with at least one
 * non-zero value. Scoring always shows for a skater, Goaltending for a goalie, and Scoring
 * for a player with no games yet, so a new roster player reads as zero, not as empty.
 */
export function visibleHockeyPlayerCategories(player: HockeyAggregatePlayer): HockeyAggregateCategory[] {
  const noGames = player.skaterGames === 0 && player.goalieGames === 0
  return HOCKEY_AGGREGATE_CATEGORIES.filter(category => {
    if (noGames) return category.id === 'scoring'
    if (hockeyAggregateRoleGames(player, category.role) === 0) return false
    if (category.id === 'scoring' || category.id === 'goaltending') return true
    return category.metricIds.some(id => id !== 'hky_gp' && (hockeyAggregateMetricValue(player, id) ?? 0) !== 0)
  })
}

export interface HockeyPlayerProfileBreakdown {
  teamPlayer: HockeyAggregatePlayer
  teamGames: HockeyAggregateGame[]
  personalSegment: HockeyPlayerCareerSegment | null
}

/**
 * A Player Profile: team-season totals from the scoped result, and the player's personal
 * games from the unscoped player result, kept apart.
 */
export function hockeyPlayerProfileBreakdown(
  scopedResult: HockeyAggregateResult,
  playerResult: HockeyAggregateResult,
  identity: HockeyAggregatePlayerIdentity
): HockeyPlayerProfileBreakdown {
  return {
    teamPlayer: selectHockeyAggregatePlayer(scopedResult, identity),
    teamGames: hockeyPlayerAggregateGames(scopedResult, identity.playerId).filter(game => game.cloudScope === 'team'),
    personalSegment: hockeyPlayerCareerSegments(playerResult, identity).find(segment => segment.kind === 'personal') ?? null,
  }
}

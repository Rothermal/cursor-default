import type { SportConfig } from '../types'
import { resolveFinalHomeScoreFromGameRow } from './gameScore'

export interface TeamInfoGame {
  id: string
  status: string
  opponent_score: number | null
  home_team_score?: number | null
  home_score_adjustment?: number | null
}

export interface TeamRecord {
  wins: number
  losses: number
  ties: number
  gamesPlayed: number
}

export type TeamGameResult = 'W' | 'L' | 'T'

export interface SplitTeamGames<T> {
  upcoming: T[]
  inProgress: T[]
  completed: T[]
}

export function resolveTeamInfoHomeScore(
  sport: SportConfig | null,
  game: TeamInfoGame,
  statsTotalsByGameId: Record<string, Record<string, number>> = {}
): number | null {
  if (game.home_team_score != null) return game.home_team_score
  if (!sport || !(game.id in statsTotalsByGameId)) return null
  return resolveFinalHomeScoreFromGameRow(
    sport,
    statsTotalsByGameId[game.id] ?? {},
    game
  )
}

export function teamGameResult(homeScore: number, opponentScore: number): TeamGameResult {
  if (homeScore > opponentScore) return 'W'
  if (homeScore < opponentScore) return 'L'
  return 'T'
}

export function computeTeamRecord(
  sport: SportConfig | null,
  games: TeamInfoGame[],
  statsTotalsByGameId: Record<string, Record<string, number>> = {}
): TeamRecord {
  const record: TeamRecord = { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 }

  for (const game of games) {
    if (game.status !== 'final' || game.opponent_score == null) continue
    const homeScore = resolveTeamInfoHomeScore(sport, game, statsTotalsByGameId)
    if (homeScore == null) continue

    record.gamesPlayed += 1

    const result = teamGameResult(homeScore, game.opponent_score)
    if (result === 'W') record.wins += 1
    else if (result === 'L') record.losses += 1
    else record.ties += 1
  }

  return record
}

export function splitTeamGames<T extends { status: string }>(games: T[]): SplitTeamGames<T> {
  return {
    upcoming: games.filter(game => game.status !== 'final' && game.status !== 'in_progress'),
    inProgress: games.filter(game => game.status === 'in_progress'),
    completed: games.filter(game => game.status === 'final'),
  }
}

export function teamInfoPath(teamId: string): string {
  return `/team?teamId=${encodeURIComponent(teamId)}`
}

export function teamRosterPath(teamId: string): string {
  return `/team/roster?teamId=${encodeURIComponent(teamId)}`
}

export function teamLeaderboardPath(teamId: string, seasonId?: string | null): string {
  const params = new URLSearchParams({ teamId })
  if (seasonId) params.set('seasonId', seasonId)
  return `/leaderboard?${params.toString()}`
}

export function teamStatsPath(teamId: string): string {
  return `/team-stats?teamId=${encodeURIComponent(teamId)}`
}

export function teamManagementPath(teamId: string): string {
  return `/teams?teamId=${encodeURIComponent(teamId)}`
}

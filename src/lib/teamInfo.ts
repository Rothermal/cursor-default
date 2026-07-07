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

export interface SplitTeamGames<T> {
  upcoming: T[]
  inProgress: T[]
  completed: T[]
}

export function computeTeamRecord(
  sport: SportConfig,
  games: TeamInfoGame[],
  statsTotalsByGameId: Record<string, Record<string, number>> = {}
): TeamRecord {
  const record: TeamRecord = { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 }

  for (const game of games) {
    if (game.status !== 'final' || game.opponent_score == null) continue

    const homeScore = resolveFinalHomeScoreFromGameRow(
      sport,
      statsTotalsByGameId[game.id] ?? {},
      game
    )
    record.gamesPlayed += 1

    if (homeScore > game.opponent_score) record.wins += 1
    else if (homeScore < game.opponent_score) record.losses += 1
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

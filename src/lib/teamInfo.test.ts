import { describe, expect, it } from 'vitest'
import { sports } from '../config/sports'
import {
  computeTeamRecord,
  splitTeamGames,
  teamInfoPath,
  teamLeaderboardPath,
  teamManagementPath,
  teamStatsPath,
} from './teamInfo'

const basketball = sports.find(sport => sport.id === 'basketball')!

describe('computeTeamRecord', () => {
  it('counts wins, losses, and ties from finalized game row scores', () => {
    const record = computeTeamRecord(basketball, [
      { id: 'win', status: 'final', opponent_score: 40, home_team_score: 41 },
      { id: 'loss', status: 'final', opponent_score: 52, home_team_score: 48 },
      { id: 'tie', status: 'final', opponent_score: 33, home_team_score: 33 },
      { id: 'active', status: 'in_progress', opponent_score: 10, home_team_score: 12 },
    ])

    expect(record).toEqual({ wins: 1, losses: 1, ties: 1, gamesPlayed: 3 })
  })

  it('falls back to stat totals and home score adjustment for legacy rows', () => {
    const record = computeTeamRecord(
      basketball,
      [
        {
          id: 'legacy-win',
          status: 'final',
          opponent_score: 46,
          home_team_score: null,
          home_score_adjustment: 2,
        },
      ],
      {
        'legacy-win': { '2pt': 20, ft: 5 },
      }
    )

    expect(record).toEqual({ wins: 1, losses: 0, ties: 0, gamesPlayed: 1 })
  })

  it('skips final games without opponent scores', () => {
    const record = computeTeamRecord(basketball, [
      { id: 'missing', status: 'final', opponent_score: null, home_team_score: 12 },
    ])

    expect(record).toEqual({ wins: 0, losses: 0, ties: 0, gamesPlayed: 0 })
  })

  it('skips legacy final games when resolved stat totals are unavailable', () => {
    const record = computeTeamRecord(basketball, [
      {
        id: 'legacy-missing-stats',
        status: 'final',
        opponent_score: 10,
        home_team_score: null,
        home_score_adjustment: 0,
      },
    ])

    expect(record).toEqual({ wins: 0, losses: 0, ties: 0, gamesPlayed: 0 })
  })

  it('counts stored scores even when sport config is unavailable', () => {
    const record = computeTeamRecord(null, [
      { id: 'win', status: 'final', opponent_score: 40, home_team_score: 41 },
      { id: 'legacy', status: 'final', opponent_score: 10, home_team_score: null },
    ])

    expect(record).toEqual({ wins: 1, losses: 0, ties: 0, gamesPlayed: 1 })
  })
})

describe('splitTeamGames', () => {
  it('groups team games by status', () => {
    const games = [
      { id: 'scheduled', status: 'scheduled' },
      { id: 'active', status: 'in_progress' },
      { id: 'final', status: 'final' },
      { id: 'draft', status: 'draft' },
    ]

    expect(splitTeamGames(games)).toEqual({
      upcoming: [games[0], games[3]],
      inProgress: [games[1]],
      completed: [games[2]],
    })
  })
})

describe('team info paths', () => {
  it('builds query-param team routes', () => {
    expect(teamInfoPath('team 1')).toBe('/team?teamId=team%201')
    expect(teamLeaderboardPath('team 1', 'season 1')).toBe(
      '/leaderboard?teamId=team+1&seasonId=season+1'
    )
    expect(teamStatsPath('team 1')).toBe('/team-stats?teamId=team%201')
    expect(teamManagementPath('team 1')).toBe('/teams?teamId=team%201')
  })
})

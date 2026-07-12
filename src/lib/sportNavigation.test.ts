import { describe, expect, it } from 'vitest'
import {
  isKnownSportId,
  parkedSyncLabel,
  routeForResumedGame,
  sportDashboardPath,
  sportGamesPath,
  sportLeaderboardPath,
  sportTeamsPath,
} from './sportNavigation'

describe('sportNavigation', () => {
  it('builds sport-scoped hash route paths', () => {
    expect(sportDashboardPath('basketball')).toBe('/sport/basketball')
    expect(sportTeamsPath('basketball')).toBe('/teams?sport=basketball')
    expect(sportGamesPath('basketball')).toBe('/games?sport=basketball')
    expect(sportLeaderboardPath('basketball')).toBe('/leaderboard?sport=basketball')
  })

  it('validates known sport ids', () => {
    expect(isKnownSportId('basketball', ['basketball', 'soccer'])).toBe(true)
    expect(isKnownSportId('lacrosse', ['basketball', 'soccer'])).toBe(false)
    expect(isKnownSportId(null, ['basketball'])).toBe(false)
  })

  it('routes resumed games to the first incomplete game-flow step', () => {
    expect(routeForResumedGame({ sport: null, gameInfo: null, players: [] })).toBe('/')
    expect(routeForResumedGame({ sport: { id: 'basketball' } as never, gameInfo: null, players: [] })).toBe('/setup')
    expect(routeForResumedGame({
      sport: { id: 'basketball' } as never,
      gameInfo: { teamName: 'A', opponentName: 'B', tournamentName: '', date: '2026-07-12' },
      players: [],
    })).toBe('/players')
    expect(routeForResumedGame({
      sport: { id: 'basketball' } as never,
      gameInfo: { teamName: 'A', opponentName: 'B', tournamentName: '', date: '2026-07-12' },
      players: [{ id: 'p1', name: 'A', number: '1', stats: {} }],
    })).toBe('/game')
  })

  it('formats parked sync labels', () => {
    expect(parkedSyncLabel({ syncDirty: false, syncStatus: 'synced', syncLastError: null })).toBe('Sync: saved')
    expect(parkedSyncLabel({ syncDirty: true, syncStatus: 'offline', syncLastError: null })).toBe('Sync: offline changes pending')
    expect(parkedSyncLabel({ syncDirty: true, syncStatus: 'error', syncLastError: 'Nope' })).toBe('Sync: error - Nope')
  })
})

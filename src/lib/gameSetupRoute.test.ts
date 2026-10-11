import { describe, expect, it } from 'vitest'
import { gameSetupRouteTarget, loadTeamSportId, type GameSetupRouteInput } from './gameSetupRoute'

const base: GameSetupRouteInput = {
  requestedSport: null,
  eventsRequested: false,
  teamId: null,
  activeSportId: null,
  hockeyNewGamesUseEvents: true,
}

describe('gameSetupRouteTarget', () => {
  it('resolves a team-only link before the active Soccer setup (HKY-6C)', () => {
    // A started Soccer game and a pre-kickoff one mount the same Soccer sport; neither
    // may answer a team-only link before the team's sport is known.
    const link = { ...base, teamId: 'team-1', activeSportId: 'soccer' }
    expect(gameSetupRouteTarget(link)).toBe('resolve_team_sport')
    expect(gameSetupRouteTarget({ ...link, teamSportId: 'hockey' })).toBe('hockey_events')
    expect(gameSetupRouteTarget({ ...link, teamSportId: 'soccer' })).toBe('soccer')
    expect(gameSetupRouteTarget({ ...link, teamSportId: 'basketball' })).toBe('generic')
    // Unreadable teams keep the earlier Soccer behavior.
    expect(gameSetupRouteTarget({ ...link, teamSportId: null })).toBe('soccer')
    // Rolled back to opt_in with the toggle off: the generic setup starts the legacy game.
    expect(gameSetupRouteTarget({ ...link, teamSportId: 'hockey', hockeyNewGamesUseEvents: false })).toBe('generic')
  })

  it('keeps explicit sport links and active-game resumes unchanged', () => {
    expect(gameSetupRouteTarget({ ...base, requestedSport: 'hockey', teamId: 'team-1', activeSportId: 'soccer' }))
      .toBe('hockey_events')
    expect(gameSetupRouteTarget({ ...base, requestedSport: 'hockey', hockeyNewGamesUseEvents: false })).toBe('generic')
    expect(gameSetupRouteTarget({ ...base, requestedSport: 'hockey', eventsRequested: true, hockeyNewGamesUseEvents: false }))
      .toBe('hockey_events')
    expect(gameSetupRouteTarget({ ...base, requestedSport: 'soccer', activeSportId: 'hockey' })).toBe('soccer')
    expect(gameSetupRouteTarget({ ...base, requestedSport: 'baseball', eventsRequested: true })).toBe('baseball_events')
    expect(gameSetupRouteTarget({ ...base, requestedSport: 'baseball' })).toBe('generic')
    // Plain /setup resumes the mounted sport: Soccer setup, or the generic setup for legacy Hockey.
    expect(gameSetupRouteTarget({ ...base, activeSportId: 'soccer' })).toBe('soccer')
    expect(gameSetupRouteTarget({ ...base, activeSportId: 'hockey' })).toBe('generic')
    // Team-only links with another sport mounted still go to the generic setup, which redirects.
    expect(gameSetupRouteTarget({ ...base, teamId: 'team-1', activeSportId: 'hockey' })).toBe('generic')
    expect(gameSetupRouteTarget({ ...base, teamId: 'team-1' })).toBe('generic')
  })
})

describe('loadTeamSportId', () => {
  const client = (result: unknown) => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => result }) }) }),
  }) as never

  it('reads the team season sport and fails closed to null', async () => {
    expect(await loadTeamSportId(client({ data: { id: 't', seasons: { sport: 'hockey' } }, error: null }), 't')).toBe('hockey')
    expect(await loadTeamSportId(client({ data: null, error: { message: 'no' } }), 't')).toBeNull()
    expect(await loadTeamSportId(client({ data: { id: 't', seasons: null }, error: null }), 't')).toBeNull()
    expect(await loadTeamSportId(null, 't')).toBeNull()
  })
})

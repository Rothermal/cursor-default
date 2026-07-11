import { describe, expect, it } from 'vitest'
import {
  shouldGuardCloudTeamSwitch,
  shouldResetActiveGameForRequestedTeam,
} from './teamSwitchGuards'

describe('shouldResetActiveGameForRequestedTeam', () => {
  it('resets when requested sport differs from active sport', () => {
    expect(
      shouldResetActiveGameForRequestedTeam({
        hasActiveGame: true,
        currentSportId: 'basketball',
        requestedSportId: 'soccer',
        currentTeamId: 'team-a',
        requestedTeamId: 'team-a',
      })
    ).toBe(true)
  })

  it('resets same-sport deep link to a different team when a game is active', () => {
    expect(
      shouldResetActiveGameForRequestedTeam({
        hasActiveGame: true,
        currentSportId: 'basketball',
        requestedSportId: 'basketball',
        currentTeamId: 'team-a',
        requestedTeamId: 'team-b',
      })
    ).toBe(true)
  })

  it('does not reset same-sport team mismatch with no active game', () => {
    expect(
      shouldResetActiveGameForRequestedTeam({
        hasActiveGame: false,
        currentSportId: 'basketball',
        requestedSportId: 'basketball',
        currentTeamId: 'team-a',
        requestedTeamId: 'team-b',
      })
    ).toBe(false)
  })

  it('does not reset when sport and team already match', () => {
    expect(
      shouldResetActiveGameForRequestedTeam({
        hasActiveGame: true,
        currentSportId: 'basketball',
        requestedSportId: 'basketball',
        currentTeamId: 'team-a',
        requestedTeamId: 'team-a',
      })
    ).toBe(false)
  })

  it('ignores team mismatch when current or requested team id is missing', () => {
    expect(
      shouldResetActiveGameForRequestedTeam({
        hasActiveGame: true,
        currentSportId: 'basketball',
        requestedSportId: 'basketball',
        currentTeamId: null,
        requestedTeamId: 'team-b',
      })
    ).toBe(false)
    expect(
      shouldResetActiveGameForRequestedTeam({
        hasActiveGame: true,
        currentSportId: 'basketball',
        requestedSportId: 'basketball',
        currentTeamId: 'team-a',
        requestedTeamId: null,
      })
    ).toBe(false)
  })
})

describe('shouldGuardCloudTeamSwitch', () => {
  it('guards when switching teams with an active game', () => {
    expect(
      shouldGuardCloudTeamSwitch({
        nextTeamId: 'team-b',
        currentTeamId: 'team-a',
        hasActiveGame: true,
        currentGameId: null,
      })
    ).toBe(true)
  })

  it('guards when switching teams while a cloud gameId is still bound', () => {
    expect(
      shouldGuardCloudTeamSwitch({
        nextTeamId: 'team-b',
        currentTeamId: 'team-a',
        hasActiveGame: false,
        currentGameId: 'game-1',
      })
    ).toBe(true)
  })

  it('does not guard when team id is unchanged', () => {
    expect(
      shouldGuardCloudTeamSwitch({
        nextTeamId: 'team-a',
        currentTeamId: 'team-a',
        hasActiveGame: true,
        currentGameId: 'game-1',
      })
    ).toBe(false)
  })

  it('does not guard when switching with no active game and no bound gameId', () => {
    expect(
      shouldGuardCloudTeamSwitch({
        nextTeamId: 'team-b',
        currentTeamId: 'team-a',
        hasActiveGame: false,
        currentGameId: null,
      })
    ).toBe(false)
  })

  it('treats null next team (new-team mode) as a change from a bound team', () => {
    expect(
      shouldGuardCloudTeamSwitch({
        nextTeamId: null,
        currentTeamId: 'team-a',
        hasActiveGame: false,
        currentGameId: 'game-1',
      })
    ).toBe(true)
  })
})

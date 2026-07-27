import { describe, expect, it } from 'vitest'
import { selectTeamRoleView } from './useTeamRole'

describe('selectTeamRoleView', () => {
  it('returns idle empty access when no team is requested', () => {
    expect(
      selectTeamRoleView(null, {
        teamId: 'team-old',
        role: 'scorer',
        loading: false,
        error: null,
      })
    ).toEqual({ role: null, loading: false, error: null })
  })

  it('fails closed as loading when stored role belongs to a different team', () => {
    expect(
      selectTeamRoleView('team-b', {
        teamId: 'team-a',
        role: 'owner',
        loading: false,
        error: null,
      })
    ).toEqual({ role: null, loading: true, error: null })
  })

  it('returns the stored result once the requested team matches', () => {
    expect(
      selectTeamRoleView('team-a', {
        teamId: 'team-a',
        role: 'viewer',
        loading: false,
        error: 'Unable to verify team access.',
      })
    ).toEqual({
      role: 'viewer',
      loading: false,
      error: 'Unable to verify team access.',
    })
  })
})

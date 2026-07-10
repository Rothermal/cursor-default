import { describe, expect, it } from 'vitest'
import { resolveTeamsPageSelectedTeamId } from './teamsPageSelection'

describe('resolveTeamsPageSelectedTeamId', () => {
  it('returns empty on list mode even when a teamId query is present', () => {
    expect(
      resolveTeamsPageSelectedTeamId({
        isManagementRoute: false,
        requestedTeamId: 't1',
        loadedTeamIds: ['t1', 't2'],
      })
    ).toBe('')
  })

  it('selects requested team on manage route when it exists', () => {
    expect(
      resolveTeamsPageSelectedTeamId({
        isManagementRoute: true,
        requestedTeamId: 't2',
        loadedTeamIds: ['t1', 't2'],
      })
    ).toBe('t2')
  })

  it('does not fall back to the first team when request is missing or unknown', () => {
    expect(
      resolveTeamsPageSelectedTeamId({
        isManagementRoute: true,
        requestedTeamId: 'missing',
        loadedTeamIds: ['t1', 't2'],
      })
    ).toBe('')
    expect(
      resolveTeamsPageSelectedTeamId({
        isManagementRoute: true,
        requestedTeamId: null,
        loadedTeamIds: ['t1'],
      })
    ).toBe('')
  })
})

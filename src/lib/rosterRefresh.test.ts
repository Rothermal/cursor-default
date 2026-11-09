import { describe, expect, it } from 'vitest'
import { describeRosterUpdate, diffGameRoster, isEmptyRosterRefreshDiff, type RosterRefreshParticipant } from './rosterRefresh'
import { parseTeamRosterRows } from './teamRosterSnapshot'

const participant = (overrides: Partial<RosterRefreshParticipant>): RosterRefreshParticipant => ({
  participantId: 'p-1', playerId: 'player-1', teamSide: 'tracked', displayName: 'Alex', number: '12', position: 'G', ...overrides,
})

describe('diffGameRoster', () => {
  it('lists number and position changes, roster additions and unmatched players', () => {
    const diff = diffGameRoster([
      participant({}),
      participant({ participantId: 'p-2', playerId: 'player-2', displayName: 'Blake', number: '4', position: null }),
      participant({ participantId: 'p-3', playerId: 'player-3', displayName: 'Casey' }),
      participant({ participantId: 'p-4', playerId: 'opp-1', teamSide: 'opponent', displayName: 'Opp' }),
      participant({ participantId: 'p-5', playerId: null, displayName: 'Guest' }),
    ], [
      { playerId: 'player-1', name: 'Alex', number: '21', position: 'PG', isActive: true },
      { playerId: 'player-2', name: 'Blake', number: ' 4 ', position: '', isActive: true },
      { playerId: 'player-9', name: 'Drew', number: '3', position: 'F', isActive: true },
      { playerId: 'player-8', name: 'Eli', number: '10', position: null, isActive: true },
      { playerId: 'player-7', name: 'Inactive', number: '1', position: null, isActive: false },
    ])
    expect(diff.updates).toEqual([{
      participantId: 'p-1', playerId: 'player-1', displayName: 'Alex',
      from: { number: '12', position: 'G' }, to: { number: '21', position: 'PG' },
    }])
    expect(diff.additions.map(item => item.playerId)).toEqual(['player-9', 'player-8'])
    expect(diff.unmatched.map(item => item.participantId)).toEqual(['p-3'])
    expect(isEmptyRosterRefreshDiff(diff)).toBe(false)
  })

  it('is empty when the game matches the roster', () => {
    const diff = diffGameRoster([participant({})], [{ playerId: 'player-1', name: 'Alex', number: '12', position: 'G', isActive: true }])
    expect(isEmptyRosterRefreshDiff(diff)).toBe(true)
  })

  it('describes a change', () => {
    expect(describeRosterUpdate({ from: { number: '12', position: 'G' }, to: { number: '21', position: 'PG' } })).toBe('#12 → #21, G → PG')
    expect(describeRosterUpdate({ from: { number: null, position: 'G' }, to: { number: '5', position: 'G' } })).toBe('no number → #5')
    expect(describeRosterUpdate({ from: { number: '5', position: 'G' }, to: { number: '5', position: null } })).toBe('G → no position')
  })
})

describe('parseTeamRosterRows', () => {
  it('reads team_players rows and skips malformed ones', () => {
    expect(parseTeamRosterRows([
      { player_id: 'player-1', jersey_number: ' 21 ', position: 'PG', is_active: null, players: { first_name: 'Alex', last_name: 'One' } },
      { player_id: 'player-2', jersey_number: null, position: null, is_active: false, players: { first_name: 'Blake', last_name: null } },
      { jersey_number: '1' },
      null,
    ])).toEqual([
      { playerId: 'player-1', name: 'Alex One', number: '21', position: 'PG', isActive: true },
      { playerId: 'player-2', name: 'Blake', number: null, position: null, isActive: false },
    ])
  })
})

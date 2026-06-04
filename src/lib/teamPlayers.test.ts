import { describe, expect, it } from 'vitest'
import type { Player } from '../types'
import {
  playersWithTeamPlaceholders,
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from './teamPlayers'

describe('playersWithTeamPlaceholders', () => {
  it('returns null when both placeholders already exist', () => {
    const players: Player[] = [
      { id: TEAM_PLAYER_HOME_ID, name: 'Home', number: '★', stats: { fouls: 3 } },
      { id: TEAM_PLAYER_OPP_ID, name: 'Opp', number: '★', stats: {} },
      { id: 'p1', name: 'A', number: '1', stats: {} },
    ]
    expect(playersWithTeamPlaceholders(players, 'Home', 'Opp')).toBeNull()
  })

  it('preserves stats on an existing home placeholder when adding the opponent', () => {
    const players: Player[] = [
      { id: TEAM_PLAYER_HOME_ID, name: 'Home', number: '★', stats: { fouls: 4 } },
      { id: 'p1', name: 'A', number: '1', stats: {} },
    ]
    const next = playersWithTeamPlaceholders(players, 'Home', 'Opp')!
    const home = next.find(p => p.id === TEAM_PLAYER_HOME_ID)
    expect(home?.stats).toEqual({ fouls: 4 })
    expect(next.some(p => p.id === TEAM_PLAYER_OPP_ID)).toBe(true)
  })
})

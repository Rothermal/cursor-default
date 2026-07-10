import { describe, expect, it } from 'vitest'
import type { Player } from '../types'
import {
  isTeamPseudoPlayer,
  playersWithTeamPlaceholders,
  sortTeamPlayersFirst,
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

describe('isTeamPseudoPlayer', () => {
  it('detects by flag or local deterministic ids', () => {
    expect(isTeamPseudoPlayer({ id: 'p1', isTeamPlayer: true })).toBe(true)
    expect(isTeamPseudoPlayer({ id: TEAM_PLAYER_HOME_ID })).toBe(true)
    expect(isTeamPseudoPlayer({ id: 'p1' })).toBe(false)
  })
})

describe('sortTeamPlayersFirst', () => {
  it('orders home then opponent before individuals', () => {
    const players: Player[] = [
      { id: 'p1', name: 'A', number: '1', stats: {} },
      { id: TEAM_PLAYER_OPP_ID, name: 'Opp', number: '★', stats: {}, isTeamPlayer: true, teamSide: 'opponent' },
      { id: TEAM_PLAYER_HOME_ID, name: 'Home', number: '★', stats: {}, isTeamPlayer: true, teamSide: 'home' },
    ]
    expect(sortTeamPlayersFirst(players).map(p => p.id)).toEqual([
      TEAM_PLAYER_HOME_ID,
      TEAM_PLAYER_OPP_ID,
      'p1',
    ])
  })
})

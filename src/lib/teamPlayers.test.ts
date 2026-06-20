import { describe, expect, it } from 'vitest'
import type { Player } from '../types'
import { mergeTeamPlaceholders, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from './teamPlayers'

const homeWithStats: Player = {
  id: TEAM_PLAYER_HOME_ID,
  name: 'Eagles',
  number: '★',
  stats: { team_fouls: 3 },
  isTeamPlayer: true,
  teamSide: 'home',
}

describe('mergeTeamPlaceholders', () => {
  it('returns the same array when both placeholders already exist', () => {
    const players = [homeWithStats, { id: TEAM_PLAYER_OPP_ID, name: 'Hawks', number: '★', stats: {} }]
    expect(mergeTeamPlaceholders(players, 'Eagles', 'Hawks')).toBe(players)
  })

  it('adds only the missing placeholder without resetting existing team stats', () => {
    const roster = [{ id: 'p1', name: 'Alex', number: '1', stats: {} }]
    const merged = mergeTeamPlaceholders([homeWithStats, ...roster], 'Eagles', 'Hawks')

    expect(merged[0]).toEqual(homeWithStats)
    expect(merged[1]?.id).toBe(TEAM_PLAYER_OPP_ID)
    expect(merged[1]?.stats).toEqual({})
    expect(merged[2]?.id).toBe('p1')
  })

  it('creates both placeholders when neither exists', () => {
    const merged = mergeTeamPlaceholders([], 'Eagles', 'Hawks')
    expect(merged.map(p => p.id)).toEqual([TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID])
    expect(merged[0]?.stats).toEqual({})
  })
})

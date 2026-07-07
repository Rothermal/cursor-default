import { describe, expect, it } from 'vitest'
import type { Player } from '../types'
import {
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from './teamPlayers'
import { reboundPromptOptionsForMiss } from './reboundPrompt'

function player(id: string, overrides: Partial<Player> = {}): Player {
  return { id, name: id, number: '1', stats: {}, ...overrides }
}

const homeTeam = player(TEAM_PLAYER_HOME_ID, {
  name: 'Home',
  number: '*',
  isTeamPlayer: true,
  teamSide: 'home',
})
const oppTeam = player(TEAM_PLAYER_OPP_ID, {
  name: 'Opponent',
  number: '*',
  isTeamPlayer: true,
  teamSide: 'opponent',
})
const p23 = player('p23', { number: '23' })
const p11 = player('p11', { number: '11' })

describe('reboundPromptOptionsForMiss', () => {
  it('defaults a home-player miss to home offensive team and opponent defensive team', () => {
    const options = reboundPromptOptionsForMiss([homeTeam, oppTeam, p23, p11], 'p23')

    expect(options?.offensiveSide).toBe('home')
    expect(options?.defensiveSide).toBe('opponent')
    expect(options?.defaultOffensivePlayerId).toBe(TEAM_PLAYER_HOME_ID)
    expect(options?.defaultDefensivePlayerId).toBe(TEAM_PLAYER_OPP_ID)
    expect(options?.offensiveCandidates.map(p => p.id)).toEqual([
      TEAM_PLAYER_HOME_ID,
      'p23',
      'p11',
    ])
    expect(options?.defensiveCandidates.map(p => p.id)).toEqual([TEAM_PLAYER_OPP_ID])
  })

  it('flips sides for an opponent-team missed shot', () => {
    const options = reboundPromptOptionsForMiss([homeTeam, oppTeam, p23, p11], TEAM_PLAYER_OPP_ID)

    expect(options?.offensiveSide).toBe('opponent')
    expect(options?.defensiveSide).toBe('home')
    expect(options?.defaultOffensivePlayerId).toBe(TEAM_PLAYER_OPP_ID)
    expect(options?.defaultDefensivePlayerId).toBe(TEAM_PLAYER_HOME_ID)
    expect(options?.offensiveCandidates.map(p => p.id)).toEqual([TEAM_PLAYER_OPP_ID])
    expect(options?.defensiveCandidates.map(p => p.id)).toEqual([
      TEAM_PLAYER_HOME_ID,
      'p23',
      'p11',
    ])
  })

  it('includes future opponent-side individuals when present', () => {
    const oppPlayer = player('opp7', { number: '7', teamSide: 'opponent' })
    const options = reboundPromptOptionsForMiss([homeTeam, oppTeam, p23, oppPlayer], 'p23')

    expect(options?.defensiveCandidates.map(p => p.id)).toEqual([
      TEAM_PLAYER_OPP_ID,
      'opp7',
    ])
  })

  it('returns null for an unknown shooter', () => {
    expect(reboundPromptOptionsForMiss([homeTeam, oppTeam, p23], 'missing')).toBeNull()
  })
})

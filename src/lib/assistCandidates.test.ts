import { describe, expect, it } from 'vitest'
import type { Player } from '../types'
import {
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from './teamPlayers'
import { assistCandidatesForMadeShot } from './assistCandidates'

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
const p5 = player('p5', { number: '5' })

const players: Player[] = [homeTeam, oppTeam, p23, p11, p5]

describe('assistCandidatesForMadeShot', () => {
  it('returns same-side individual teammates excluding the shooter', () => {
    expect(assistCandidatesForMadeShot(players, 'p23').map(p => p.id)).toEqual([
      'p11',
      'p5',
    ])
  })

  it('does not offer assists for the opponent pseudo-player', () => {
    expect(assistCandidatesForMadeShot(players, TEAM_PLAYER_OPP_ID)).toEqual([])
  })

  it('can offer home individuals after a home team pseudo-player shot', () => {
    expect(assistCandidatesForMadeShot(players, TEAM_PLAYER_HOME_ID).map(p => p.id)).toEqual([
      'p23',
      'p11',
      'p5',
    ])
  })

  it('returns empty for an unknown shooter', () => {
    expect(assistCandidatesForMadeShot(players, 'missing')).toEqual([])
  })
})

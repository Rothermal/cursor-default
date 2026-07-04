import { describe, expect, it } from 'vitest'
import type { Player, ShotRecord } from '../types'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from './teamPlayers'
import { shotsForSelection, sideOf } from './shotChartViews'

function player(id: string, overrides: Partial<Player> = {}): Player {
  return { id, name: id, number: '1', stats: {}, ...overrides }
}

function shot(id: string, playerId: string): ShotRecord {
  return {
    id,
    x: 0,
    y: 10,
    made: true,
    shotType: '2pt',
    zone: 'paint',
    playerId,
    timestamp: 0,
  }
}

const homePseudo = player(TEAM_PLAYER_HOME_ID, {
  isTeamPlayer: true,
  teamSide: 'home',
  number: '★',
})
const oppPseudo = player(TEAM_PLAYER_OPP_ID, {
  isTeamPlayer: true,
  teamSide: 'opponent',
  number: '★',
})
const p23 = player('p23')
const p11 = player('p11')

const players: Player[] = [homePseudo, oppPseudo, p23, p11]

const shots: ShotRecord[] = [
  shot('s1', 'p23'),
  shot('s2', 'p11'),
  shot('s3', TEAM_PLAYER_HOME_ID),
  shot('s4', TEAM_PLAYER_OPP_ID),
  shot('s5', 'p23'),
]

describe('sideOf', () => {
  it('individual roster players are home side', () => {
    expect(sideOf(p23)).toBe('home')
  })

  it('home pseudo-player is home side', () => {
    expect(sideOf(homePseudo)).toBe('home')
  })

  it('opponent pseudo-player is opponent side', () => {
    expect(sideOf(oppPseudo)).toBe('opponent')
  })

  it('team pseudo-player without teamSide defaults to home', () => {
    expect(sideOf(player('x', { isTeamPlayer: true }))).toBe('home')
  })
})

describe('shotsForSelection', () => {
  it('all → returns the input array unchanged', () => {
    expect(shotsForSelection(shots, players, { kind: 'all' })).toEqual(shots)
  })

  it('individual id → only that player’s shots', () => {
    const result = shotsForSelection(shots, players, { kind: 'player', playerId: 'p23' })
    expect(result.map(s => s.id)).toEqual(['s1', 's5'])
  })

  it('home pseudo id → home-side union (individuals + home pseudo), no opponent shots', () => {
    const result = shotsForSelection(shots, players, {
      kind: 'player',
      playerId: TEAM_PLAYER_HOME_ID,
    })
    expect(result.map(s => s.id)).toEqual(['s1', 's2', 's3', 's5'])
  })

  it('opponent pseudo id → only opponent pseudo shots', () => {
    const result = shotsForSelection(shots, players, {
      kind: 'player',
      playerId: TEAM_PLAYER_OPP_ID,
    })
    expect(result.map(s => s.id)).toEqual(['s4'])
  })

  it('unknown player id → returns all shots (defensive)', () => {
    const result = shotsForSelection(shots, players, { kind: 'player', playerId: 'nope' })
    expect(result).toEqual(shots)
  })

  it('orphan shots (playerId not on roster) appear only under all', () => {
    const withOrphan = [...shots, shot('s6', 'gone')]
    expect(
      shotsForSelection(withOrphan, players, { kind: 'all' }).map(s => s.id)
    ).toContain('s6')
    expect(
      shotsForSelection(withOrphan, players, {
        kind: 'player',
        playerId: TEAM_PLAYER_HOME_ID,
      }).map(s => s.id)
    ).not.toContain('s6')
    expect(
      shotsForSelection(withOrphan, players, { kind: 'player', playerId: 'p23' }).map(
        s => s.id
      )
    ).not.toContain('s6')
  })
})

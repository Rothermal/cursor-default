import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import BasketballWorkspaceRoster from './BasketballWorkspaceRoster'
import { createInitialState } from '../../lib/gameReducer'
import { sports } from '../../config/sports'
import { playersWithTeamPlaceholders } from '../../lib/teamPlayers'
import { prepareBasketballGameStart } from '../../lib/basketball/commands'
import type { GameState } from '../../types'

function fixture(): GameState {
  return { ...createInitialState(), sport: sports.find(s => s.id === 'basketball')!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', date: '2026-09-20', tournamentName: '', tournamentId: null },
    players: playersWithTeamPlaceholders([
      { id: 'p1', name: 'Alex', number: '4', stats: {} },
      { id: 'p2', name: 'Blake', number: '12', stats: {}, teamSide: 'opponent' },
    ], 'Home', 'Away')!,
  }
}
function render(state: GameState, side: 'tracked' | 'opponent' = 'tracked') {
  return renderToStaticMarkup(createElement(BasketballWorkspaceRoster, {
    state, side, canAdd: true, onAdd: () => {}, onManage: () => {}, onOpen: () => {},
  }))
}
describe('Basketball workspace roster', () => {
  it('keeps legacy roster identity and does not invent lineup history', () => {
    const state = fixture()
    const before = JSON.stringify(state)
    const html = render(state)
    expect(html).toContain('Alex')
    expect(html).not.toContain('Blake')
    expect(html).not.toContain('On court')
    expect(html).not.toContain('Bench')
    expect(html).not.toContain('Manage Lineup')
    expect(JSON.stringify(state)).toBe(before)
  })
  it('shows opponent individuals independently of team pseudo-players', () => {
    const html = render(fixture(), 'opponent')
    expect(html).toContain('Blake')
    expect(html).not.toContain('Alex')
    expect(html).not.toContain('basketball-roster-__team_')
  })
  it('uses match participants, not later roster additions, for event detail links', () => {
    const result = prepareBasketballGameStart({ ...fixture(), gameDataAuthority: 'sport_events' }, { recorderUserId: null })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    result.state.players.push({ id: 'outside', name: 'Not in match', number: '99', stats: {} })
    expect(render(result.state)).toContain('Alex')
    expect(render(result.state)).not.toContain('Not in match')
  })
  it('keeps empty opponent rosters explicit', () => {
    const state = fixture()
    state.players = state.players.filter(player => player.id !== 'p2')
    expect(render(state, 'opponent')).toContain('No individual players.')
  })
})

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import BasketballWorkspaceRoster from './BasketballWorkspaceRoster'
import { createInitialState } from '../../lib/gameReducer'
import { sports } from '../../config/sports'
import { playersWithTeamPlaceholders } from '../../lib/teamPlayers'
import { prepareBasketballGameStart } from '../../lib/basketball/commands'
import type { GameState } from '../../types'
import { getBasketballRulesProfile, upgradeBasketballRulesDraftToV3 } from '../../lib/basketball/profiles'
import { startBasketballClock } from '../../lib/basketball/clockCommands'

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
function clockedFixture(): GameState {
  const initial = fixture()
  initial.players.push({ id: 'p3', name: 'Casey', number: '20', stats: {} })
  const participants = initial.players.filter(p => !p.isTeamPlayer).map((p, index) => ({
    id: `70000000-0000-4000-8000-00000000010${index}`, playerId: p.id, displayName: p.name,
    number: p.number, teamSide: p.teamSide === 'opponent' ? 'opponent' as const : 'tracked' as const,
    initialStatus: p.id === 'p3' ? 'bench' as const : 'starter' as const, position: null, captain: false,
  }))
  // Reviewed opponent identities live in setup, not the tracked setup roster.
  initial.players = initial.players.filter(player => player.id !== 'p2')
  const result = prepareBasketballGameStart({ ...initial, gameDataAuthority: 'sport_events' }, {
    recorderUserId: null, occurredAt: '2026-09-20T12:00:00.000Z', reviewedSetup: {
      rulesSnapshot: upgradeBasketballRulesDraftToV3(getBasketballRulesProfile('nfhs', 1)!.rules, 'nfhs'),
      rulesSource: { profileId: 'nfhs', profileVersion: 1, personalRevision: null, teamRevision: null, hasExplicitMatchOverrides: true },
      sourceTeamId: null, sourceSeasonId: null, courtOrientation: 'standard',
      version3Setup: { participants, openingLineups: {
        tracked: { participantIds: [participants[0].id], shortHandedReason: 'Test lineup' },
        opponent: { participantIds: [participants[1].id], shortHandedReason: 'Test lineup' },
      } },
    },
  })
  if (!result.ok) throw new Error(result.message)
  result.state.players.push({ id: 'p2', name: 'Blake', number: '12', stats: {}, teamSide: 'opponent' })
  return result.state
}
describe('Basketball workspace roster', () => {
  it('distinguishes on-court and bench participants on both sides', () => {
    const state = clockedFixture()
    const html = render(state)
    expect(html).toMatch(/Alex<\/span><span[^>]*>On court/)
    expect(html).toMatch(/Casey<\/span><span[^>]*>Bench/)
    expect(render(state, 'opponent')).toMatch(/Blake<\/span><span[^>]*>On court/)
  })
  it('enables Manage Lineup when paused and disables it while running or without a clock', () => {
    const state = clockedFixture()
    const manageButton = (candidate: GameState) => render(candidate).match(/<button[^>]*>[\s\S]*?Manage Lineup<\/button>/)?.[0]
    expect(manageButton(state)).toBeDefined()
    expect(manageButton(state)).not.toContain('disabled=')
    const started = startBasketballClock(state, { recorderUserId: null, occurredAt: '2026-09-20T12:00:01.000Z' })
    if (!started.ok) throw new Error(started.message)
    expect(manageButton(started.state)).toContain('disabled=""')
    if (state.sportGameState?.sportId !== 'basketball') throw new Error('Missing projection')
    state.sportGameState.projection.clock = null
    expect(manageButton(state)).toContain('disabled=""')
  })
  it('keeps legacy roster identity and does not invent lineup history', () => {
    const state = fixture()
    const before = JSON.stringify(state)
    const html = render(state)
    expect(html).toContain('Alex')
    expect(html).not.toContain('Blake')
    expect(html).not.toContain('On court')
    expect(html).not.toContain('Bench')
    expect(html).not.toContain('Manage Lineup')
    expect(html).toContain('Lineup not tracked')
    expect(JSON.stringify(state)).toBe(before)
  })
  it('shows current positions and pending boundary review without inventing court status', () => {
    const state = clockedFixture()
    if (state.sportGameState?.sportId !== 'basketball') throw Error('Missing projection')
    const projection = state.sportGameState.projection
    const participant = Object.values(projection.participants).find(item => item.playerId === 'p1')!
    participant.position = 'PG'
    expect(render(state)).toContain('PG')
    projection.lineup!.sides.tracked!.boundaryConfirmationRequired = true
    expect(render(state)).toContain('Lineup review required')
    expect(render(state)).not.toContain('On court')
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

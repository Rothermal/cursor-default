import { describe, expect, it } from 'vitest'
import { createInitialState } from '../gameReducer'
import { sports } from '../../config/sports'
import { playersWithTeamPlaceholders, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { addBasketballLateParticipant, captureBasketballCourtEvent, prepareBasketballGameStart } from './commands'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import { shotsForSelection } from '../shotChartViews'
import { assistCandidatesForMadeShot } from '../assistCandidates'
import type { GameState } from '../../types'

function fixture() {
  const initial: GameState = { ...createInitialState(), gameDataAuthority: 'sport_events', sport: sports.find(s => s.id === 'basketball')!,
    gameInfo: { teamName: 'Home', opponentName: 'Away', date: '2026-09-20', tournamentName: '', tournamentId: null },
    players: playersWithTeamPlaceholders([{ id: 'home1', name: 'Home One', number: '4', stats: {} }], 'Home', 'Away')!,
  }
  const start = prepareBasketballGameStart(initial, { recorderUserId: null })
  if (!start.ok) throw new Error(start.message)
  const added = addBasketballLateParticipant(start.state, { recorderUserId: null, teamSide: 'opponent', displayName: 'Away Seven', number: '7', playerId: 'away7' })
  if (!added.ok) throw new Error(added.message)
  let state = added.state
  for (const playerId of ['away7', 'home1']) {
    const shot = captureBasketballCourtEvent(state, { recorderUserId: null, playerId, point: { x: 0, y: 8 }, event: { kind: 'shot', made: true, shotType: '2pt' } })
    if (!shot.ok) throw new Error(shot.message)
    state = shot.state
  }
  return state
}
function expectSides(state: GameState) {
  expect(shotsForSelection(state.shotChart, state.players, { kind: 'player', playerId: TEAM_PLAYER_OPP_ID }).map(shot => shot.playerId)).toEqual(['away7'])
  expect(shotsForSelection(state.shotChart, state.players, { kind: 'player', playerId: TEAM_PLAYER_HOME_ID }).map(shot => shot.playerId)).toEqual(['home1'])
  expect(assistCandidatesForMadeShot(state.players, 'home1').map(player => player.id)).not.toContain('away7')
}
describe('Basketball event participant sides', () => {
  it('preserves late opponent identity in chart filters and assist candidates', () => {
    const state = fixture()
    expect(state.players.find(player => player.id === 'away7')?.teamSide).toBe('opponent')
    expectSides(state)
  })
  it('repairs old or stale player rows from authoritative participants', () => {
    const state = fixture()
    for (const player of state.players.filter(player => !player.isTeamPlayer)) delete player.teamSide
    expectSides(reconcileBasketballPlayerRows(state))
    state.players.find(player => player.id === 'away7')!.teamSide = 'home'
    expectSides(reconcileBasketballPlayerRows(state))
  })
  it('recreates missing opponent rows with the correct side', () => {
    const state = fixture()
    state.players = state.players.filter(player => player.id !== 'away7')
    expectSides(reconcileBasketballPlayerRows(state))
  })
})

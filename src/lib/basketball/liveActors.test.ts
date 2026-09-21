import { describe, expect, it } from 'vitest'
import { createInitialState } from '../gameReducer'
import { sports } from '../../config/sports'
import { playersWithTeamPlaceholders, TEAM_PLAYER_HOME_ID } from '../teamPlayers'
import { prepareBasketballGameStart } from './commands'
import { basketballActorPlayers, basketballOpenTrips, basketballParticipantIsLive, basketballTripShooter } from './liveActors'
import { basketballFreeThrowTripStatuses, captureBasketballFoul, captureBasketballFreeThrowAttempt } from './foulFreeThrowCommands'
import type { BasketballLineupSideProjection } from './types'

function game() {
  const result = prepareBasketballGameStart({ ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Home', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-09-21' },
    players: playersWithTeamPlaceholders([
      { id: 'p1', name: 'One', number: '12', stats: {} },
      { id: 'p2', name: 'Two', number: '2', stats: {} },
      { id: 'p3', name: 'Three', number: '3', stats: {} },
    ], 'Home', 'Away')!,
  }, { recorderUserId: null })
  if (!result.ok || result.state.sportGameState?.sportId !== 'basketball') throw Error('fixture failed')
  return { state: result.state, sport: result.state.sportGameState }
}
describe('Basketball live actor presentation policy', () => {
  it('sorts current match positions, numeric jerseys, custom and unassigned before teams', () => {
    const { state, sport } = game()
    const participants = Object.values(sport.projection.participants)
    participants[0].position = 'PG'; participants[1].position = 'PG'; participants[2].position = 'Wing'
    expect(basketballActorPlayers(state, state.players).map(player => player.id).slice(0, 3)).toEqual(['p2', 'p1', 'p3'])
    participants[0].position = null
    expect(basketballActorPlayers(state, state.players).map(player => player.id).slice(0, 3)).toEqual(['p2', 'p3', 'p1'])
    expect(basketballActorPlayers(state, state.players).slice(-2)[0]?.id).toBe(TEAM_PLAYER_HOME_ID)
  })
  it('filters bench and boundary-unknown lineups without removing the explicit bench path', () => {
    const { state, sport } = game()
    const participant = Object.values(sport.projection.participants)[0]
    const side: BasketballLineupSideProjection = { teamSide: 'tracked', currentParticipantIds: [participant.participantId],
      currentShortHandedReasonCode: null, currentShortHandedReasonNote: null, boundaryConfirmationRequired: false,
      boundaryConfirmedPeriodId: null, clockStartedInPeriod: false, replacementRequiredParticipantIds: [],
      incompletePeriodIds: [], onCourtIntervals: [], participationByParticipantId: {}, roleHistoryByParticipantId: {},
      plusMinusComplete: true, plusMinusUnavailableReason: null, lineupCombinations: [] }
    sport.projection.lineup = { sides: { tracked: side, opponent: null }, runningClockIntervals: [], equalPlayReviews: [],
      equalPlayCompliant: true, enforcedOverridesComplete: true, pendingEqualPlayOverride: null }
    expect(basketballActorPlayers(state, state.players).filter(player => player.id.startsWith('p')).map(player => player.id)).toEqual(['p1'])
    expect(basketballActorPlayers(state, state.players, true).filter(player => player.id.startsWith('p'))).toHaveLength(3)
    side.boundaryConfirmationRequired = true
    expect(basketballParticipantIsLive(state, participant)).toBe(false)
    participant.ejected = true
    expect(basketballActorPlayers(state, state.players, true).some(player => player.id === 'p1')).toBe(false)
  })
  it('does not treat a missing event authority as an untracked legacy roster', () => {
    const { state } = game()
    state.sportGameState = null
    expect(basketballActorPlayers(state, state.players).some(player => player.id === 'p1')).toBe(false)
  })
  it.each(['personal', 'technical', 'flagrant', 'intentional', 'double'] as const)('preserves existing %s foul offender kinds', foulClass => {
    for (const offender of [{ kind: 'team' as const }, { kind: 'staff' as const, label: 'Coach' }, { kind: 'player' as const, playerId: 'p1' }]) {
      const { state } = game()
      expect(captureBasketballFoul(state, { recorderUserId: null, teamSide: 'tracked', offender, class: foulClass, context: 'common' }).ok).toBe(true)
    }
  })
  it('routes open trips by side and keeps the latest recorded shooter as explicit context', () => {
    const { state } = game()
    const foul = captureBasketballFoul(state, { recorderUserId: null, teamSide: 'opponent', offender: { kind: 'team' },
      class: 'personal', context: 'shooting', freeThrows: { maximumAttempts: 2, oneAndOne: false, technical: false, possessionRetained: false } })
    if (!foul.ok || !foul.tripEventId) throw Error('award failed')
    expect(basketballOpenTrips(foul.state, basketballFreeThrowTripStatuses(foul.state), 'opponent')).toEqual([])
    const attempt = captureBasketballFreeThrowAttempt(foul.state, { recorderUserId: null, tripEventId: foul.tripEventId, shooterPlayerId: 'p2', made: true })
    if (!attempt.ok) throw Error(attempt.message)
    const trips = basketballOpenTrips(attempt.state, basketballFreeThrowTripStatuses(attempt.state), 'tracked')
    expect(trips).toHaveLength(1)
    expect(basketballTripShooter(trips[0])).toBe('p2')
  })
})

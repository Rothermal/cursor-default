import { describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { diffGameRoster } from '../rosterRefresh'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { basketballCloudParticipants } from './cloudSync'
import { addBasketballLateParticipant, prepareBasketballGameStart, updateBasketballParticipantDetails } from './commands'
import { basketballLiveCaptureUnits, undoLatestBasketballCourtCapture } from './courtCorrections'
import {
  applyBasketballRosterRefresh,
  basketballRosterLateAddIds,
  basketballRosterRefreshAvailability,
  basketballRosterRefreshParticipants,
  isBasketballRosterParticipant,
} from './rosterRefresh'
import { buildBasketballTimelineReview } from './timeline'
import type { BasketballMatchEvent } from './types'
import { previewBasketballTimelineRemoval } from './timelineCorrections'

vi.mock('../supabase', () => ({ supabase: null }))

const basketball = sports.find(sport => sport.id === 'basketball')!
const P1 = '70000000-0000-4000-8000-000000000101'
const P2 = '70000000-0000-4000-8000-000000000102'
const AT = '2026-11-08T12:00:00.000Z'

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function startedState(): GameState {
  const base = createInitialState()
  const initial: GameState = {
    ...base,
    gameDataAuthority: 'sport_events',
    sport: basketball,
    gameInfo: { teamName: 'Aces', opponentName: 'Bears', tournamentName: '', tournamentId: null, date: '2026-11-08' },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig: {
      periodsPerGame: 4, periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'], bonusThreshold: 5, doubleBonusThreshold: 5,
      hasOneAndOne: false, overtimeLabel: 'OT', overtimeFoulsReset: true, timeoutsPerPeriod: null, timeoutsPerOvertime: null,
    },
    cloudSync: { ...base.cloudSync, teamId: 'team-1', seasonId: 'season-1' },
  }
  const result = prepareBasketballGameStart(initial, {
    recorderUserId: 'user-1',
    occurredAt: AT,
    eventId: '70000000-0000-4000-8000-000000000001',
    participantIds: [P1, P2],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function projection(state: GameState) {
  if (state.sportGameState?.sportId !== 'basketball') throw new Error('not basketball')
  return state.sportGameState.projection
}

describe('updateBasketballParticipantDetails', () => {
  it('records new numbers and positions as events that undo together', () => {
    const state = startedState()
    const result = updateBasketballParticipantDetails(state, {
      recorderUserId: 'user-1',
      source: 'roster_refresh',
      occurredAt: AT,
      changes: [
        { participantId: P1, number: ' 21 ', position: 'PG' },
        { participantId: P2, number: '12', position: null },
      ],
    })
    if (!result.ok) throw new Error(result.message)
    const events = (result.state.eventStream!.events as BasketballMatchEvent[]).filter(event => event.eventType === 'basketball.participant_details_updated')
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ participantId: P1, number: '21', position: 'PG', source: 'roster_refresh' })
    expect(projection(result.state).participants[P1]).toMatchObject({ number: '21', position: 'PG' })
    expect(result.state.players.find(item => item.id === 'player-1')?.number).toBe('21')
    if (result.state.sportGameState?.sportId !== 'basketball') throw new Error('not basketball')
    expect(result.state.sportGameState.setup.participants.find(item => item.id === P1)?.number).toBe('4')

    const rebuilt = rebuildGameEventProjection(result.state, gameEventRegistry, gameEventProjectors)
    expect(rebuilt.inspection.complete).toBe(true)
    expect(projection(rebuilt.state).participants[P1]).toMatchObject({ number: '21', position: 'PG' })

    const unit = basketballLiveCaptureUnits(result.state)[0]
    expect(unit.who).toBe('Alex One')
    expect(unit.what).toBe('Now #21, PG')
    const undone = undoLatestBasketballCourtCapture(result.state, AT)
    if (!undone.ok) throw new Error(undone.message)
    expect(projection(undone.state).participants[P1]).toMatchObject({ number: '4', position: null })
  })

  it('shows the current number in the timeline and labels the change', () => {
    const result = updateBasketballParticipantDetails(startedState(), {
      recorderUserId: 'user-1', source: 'manual', occurredAt: AT,
      changes: [{ participantId: P1, number: '21', position: null }],
    })
    if (!result.ok) throw new Error(result.message)
    const review = buildBasketballTimelineReview(result.state)
    expect(review.complete).toBe(true)
    expect(review.participants.find(item => item.id === P1)?.label).toContain('21')
    const row = [...review.eventById.values()].find(item => item.event.eventType === 'basketball.participant_details_updated')
    expect(row?.title).toBe('Roster change: now #21, no position')
    expect(row?.actorLabel).toBe('Alex One')
  })

  it('rejects unknown participants, no-op changes and finalized cloud games', () => {
    const state = startedState()
    const unknown = updateBasketballParticipantDetails(state, {
      recorderUserId: 'user-1', source: 'manual', occurredAt: AT,
      changes: [{ participantId: 'missing', number: '1', position: null }],
    })
    expect(unknown.ok).toBe(false)
    const noop = updateBasketballParticipantDetails(state, {
      recorderUserId: 'user-1', source: 'manual', occurredAt: AT,
      changes: [{ participantId: P1, number: '4', position: '' }],
    })
    expect(noop).toMatchObject({ ok: false, message: 'Nothing changed.' })
    const final = updateBasketballParticipantDetails(
      { ...state, cloudSync: { ...state.cloudSync, gameStatus: 'final' } },
      { recorderUserId: 'user-1', source: 'manual', occurredAt: AT, changes: [{ participantId: P1, number: '9', position: null }] }
    )
    expect(final).toMatchObject({ ok: false, code: 'cloud_flow_unsupported' })
    expect(basketballRosterRefreshAvailability({ ...state, cloudSync: { ...state.cloudSync, gameStatus: 'final' } })).toEqual({ kind: 'reopen' })
    expect(basketballRosterRefreshAvailability(state)).toEqual({ kind: 'available', teamId: 'team-1' })
  })
})

describe('applyBasketballRosterRefresh', () => {
  it('applies chosen updates and adds roster players that keep their roster link', () => {
    const state = startedState()
    const diff = diffGameRoster(basketballRosterRefreshParticipants(state), [
      { playerId: 'player-1', name: 'Alex One', number: '21', position: 'PG', isActive: true },
      { playerId: 'player-2', name: 'Blake Two', number: '13', position: null, isActive: true },
      { playerId: 'player-3', name: 'Casey Three', number: '30', position: 'C', isActive: true },
    ])
    expect(diff.updates.map(item => item.participantId)).toEqual([P1, P2])
    const result = applyBasketballRosterRefresh(state, {
      recorderUserId: 'user-1', diff, occurredAt: AT,
      updateParticipantIds: [P1],
      additionPlayerIds: ['player-3'],
    })
    if (!result.ok) throw new Error(result.message)
    const participants = projection(result.state).participants
    expect(participants[P1].number).toBe('21')
    expect(participants[P2].number).toBe('12')
    const added = Object.values(participants).find(item => item.playerId === 'player-3')!
    expect(added).toMatchObject({ number: '30', position: 'C', teamSide: 'tracked', lateAdded: true })
    expect(basketballRosterLateAddIds(result.state.eventStream!.events).has(added.participantId)).toBe(true)
    expect(isBasketballRosterParticipant(result.state, added.participantId)).toBe(true)
    expect(isBasketballRosterParticipant(result.state, P1)).toBe(true)

    if (result.state.sportGameState?.sportId !== 'basketball') throw new Error('not basketball')
    const cloud = basketballCloudParticipants(result.state.sportGameState, result.state.eventStream!.events)
    // Setup rows keep their setup number; the change replays from the event stream.
    expect(cloud.find(row => row.client_participant_id === P1)).toMatchObject({ jersey_number: '4', source_player_id: 'player-1' })
    expect(cloud.find(row => row.client_participant_id === added.participantId)).toMatchObject({ jersey_number: '30', source_player_id: 'player-3' })
  })

  it('keeps free-text late adds off the roster link and blocks removing a late add with later details', () => {
    const state = startedState()
    const late = addBasketballLateParticipant(state, {
      recorderUserId: 'user-1', teamSide: 'tracked', displayName: 'Guest', number: '0', occurredAt: AT,
    })
    if (!late.ok) throw new Error(late.message)
    const guest = Object.values(projection(late.state).participants).find(item => item.displayName === 'Guest')!
    expect(isBasketballRosterParticipant(late.state, guest.participantId)).toBe(false)
    if (late.state.sportGameState?.sportId !== 'basketball') throw new Error('not basketball')
    expect(basketballCloudParticipants(late.state.sportGameState, late.state.eventStream!.events)
      .find(row => row.client_participant_id === guest.participantId)?.source_player_id).toBeNull()

    const changed = updateBasketballParticipantDetails(late.state, {
      recorderUserId: 'user-1', source: 'manual', occurredAt: AT,
      changes: [{ participantId: guest.participantId, number: '00', position: null }],
    })
    if (!changed.ok) throw new Error(changed.message)
    const addEvent = (changed.state.eventStream!.events as BasketballMatchEvent[]).find(event => event.eventType === 'basketball.match_roster_added')!
    expect(previewBasketballTimelineRemoval(changed.state, addEvent.id, 'event')).toMatchObject({ ok: false })
  })

  it('rejects a roster late add on the opponent side', () => {
    const result = addBasketballLateParticipant(startedState(), {
      recorderUserId: 'user-1', teamSide: 'opponent', displayName: 'Opp', playerId: 'player-9', fromRoster: true, occurredAt: AT,
    })
    expect(result.ok).toBe(false)
  })
})

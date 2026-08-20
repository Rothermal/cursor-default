import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  addBasketballLateParticipant,
  captureBasketballCourtEvent,
  prepareBasketballGameStart,
} from './commands'
import { captureBasketballDirectStat } from './directCommands'
import {
  basketballSummaryShotReview,
  DEFAULT_BASKETBALL_SUMMARY_SHOT_FILTERS,
  filterBasketballSummaryShots,
} from './summaryShots'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function startedState(): GameState {
  const started = prepareBasketballGameStart({
    ...createInitialState(),
    gameDataAuthority: 'sport_events',
    sport: basketball,
    gameInfo: {
      teamName: 'Aces', opponentName: 'Bears', tournamentName: '', date: '2026-08-20',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig: {
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: null,
      timeoutsPerOvertime: null,
    },
  }, {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-20T12:00:00.000Z',
    eventId: 'ad000000-0000-4000-8000-000000000001',
    participantIds: [
      'ad000000-0000-4000-8000-000000000101',
      'ad000000-0000-4000-8000-000000000102',
    ],
  })
  if (!started.ok) throw new Error(started.message)
  const opponent = addBasketballLateParticipant(started.state, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Nine',
    number: '9',
    playerId: 'opponent-9',
    participantId: 'ad000000-0000-4000-8000-000000000103',
    occurredAt: '2026-08-20T12:00:10.000Z',
    eventId: 'ad000000-0000-4000-8000-000000000002',
  })
  if (!opponent.ok) throw new Error(opponent.message)
  return opponent.state
}

function stateWithShots(): GameState {
  const trackedLocated = captureBasketballCourtEvent(startedState(), {
    recorderUserId: 'recorder-1',
    playerId: 'player-1',
    point: { x: 0, y: 8 },
    event: { kind: 'shot', made: true, shotType: '2pt' },
    occurredAt: '2026-08-20T12:01:00.000Z',
    eventIds: ['ad000000-0000-4000-8000-000000000003'],
  })
  if (!trackedLocated.ok) throw new Error(trackedLocated.message)
  const trackedUnlocated = captureBasketballDirectStat(trackedLocated.state, {
    recorderUserId: 'recorder-1',
    playerId: 'player-2',
    statId: '2pt_miss',
    occurredAt: '2026-08-20T12:02:00.000Z',
    eventId: 'ad000000-0000-4000-8000-000000000004',
  })
  if (!trackedUnlocated.ok) throw new Error(trackedUnlocated.message)
  const opponentLocated = captureBasketballCourtEvent(trackedUnlocated.state, {
    recorderUserId: 'recorder-1',
    playerId: 'opponent-9',
    point: { x: 0, y: 23 },
    event: { kind: 'shot', made: true, shotType: '3pt' },
    occurredAt: '2026-08-20T12:03:00.000Z',
    eventIds: ['ad000000-0000-4000-8000-000000000005'],
  })
  if (!opponentLocated.ok) throw new Error(opponentLocated.message)
  const freeThrow = captureBasketballDirectStat(opponentLocated.state, {
    recorderUserId: 'recorder-1',
    playerId: 'opponent-9',
    statId: 'ft',
    occurredAt: '2026-08-20T12:04:00.000Z',
    eventId: 'ad000000-0000-4000-8000-000000000006',
  })
  if (!freeThrow.ok) throw new Error(freeThrow.message)
  return freeThrow.state
}

describe('BKE-4D4 Basketball Summary shot review', () => {
  it('derives active field goals with located and unlocated parity while excluding free throws', () => {
    const review = basketballSummaryShotReview(stateWithShots())

    expect(review.shots).toHaveLength(3)
    expect(review.shots.filter(shot => shot.marker)).toHaveLength(2)
    expect(review.shots.filter(shot => !shot.marker)).toHaveLength(1)
    expect(review.shots.map(shot => shot.detail.ordinalLabel)).toEqual([
      'Field goal #1', 'Field goal #2', 'Field goal #3',
    ])
    expect(review.shots[0].marker).toMatchObject({ x: 0, y: 8, shotType: '2pt' })
    expect(review.shots[2]).toMatchObject({
      teamSide: 'opponent', participantLabel: '#9 Opponent Nine', value: 3,
    })
  })

  it('applies side, participant, period, result, and value filters without changing authority', () => {
    const review = basketballSummaryShotReview(stateWithShots())
    const opponent = review.participants.find(participant => participant.teamSide === 'opponent')
    if (!opponent) throw new Error('Expected opponent participant')

    expect(filterBasketballSummaryShots(review, {
      ...DEFAULT_BASKETBALL_SUMMARY_SHOT_FILTERS,
      teamSide: 'tracked',
      result: 'missed',
    }).map(shot => shot.id)).toEqual(['ad000000-0000-4000-8000-000000000004'])
    expect(filterBasketballSummaryShots(review, {
      ...DEFAULT_BASKETBALL_SUMMARY_SHOT_FILTERS,
      participantId: opponent.id,
      periodId: 'regulation-1',
      value: '3',
    }).map(shot => shot.id)).toEqual(['ad000000-0000-4000-8000-000000000005'])
    expect(filterBasketballSummaryShots(review, {
      ...DEFAULT_BASKETBALL_SUMMARY_SHOT_FILTERS,
      teamSide: 'opponent',
      result: 'missed',
    })).toEqual([])
  })
})

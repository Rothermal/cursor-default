import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { addBasketballLateParticipant, prepareBasketballGameStart } from './commands'
import {
  basketballPlayerReview,
  basketballReviewStatLine,
  basketballTeamReview,
} from './summaryDetails'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function startedState(): GameState {
  const base = createInitialState()
  const started = prepareBasketballGameStart({
    ...base,
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
    eventId: 'ac000000-0000-4000-8000-000000000001',
    participantIds: [
      'ac000000-0000-4000-8000-000000000101',
      'ac000000-0000-4000-8000-000000000102',
    ],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

function inspection(state: GameState) {
  return rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors).inspection
}

describe('Basketball detailed summary models', () => {
  it('derives traditional totals and denominator-safe rates', () => {
    const line = basketballReviewStatLine({
      ft: 3, ft_miss: 1, '2pt': 2, '2pt_miss': 2, '3pt': 1, '3pt_miss': 1,
      oreb: 1, dreb: 4, ast: 6, stl: 2, blk: 1, to: 3, pf: 2, min: 14,
    })
    expect(line).toMatchObject({
      points: 10,
      fieldGoalsMade: 3,
      fieldGoalsAttempted: 6,
      rebounds: 5,
      manualMinutes: 14,
    })
    expect(line.fieldGoalPercentage?.value).toBe(0.5)
    expect(line.assistToTurnoverRatio?.value).toBe(2)
    expect(basketballReviewStatLine({
      ft: 0, ft_miss: 0, '2pt': 0, '2pt_miss': 0, '3pt': 0, '3pt_miss': 0,
      oreb: 0, dreb: 0, ast: 1, stl: 0, blk: 0, to: 0, pf: 0, min: 0,
    }).assistToTurnoverRatio).toBeNull()
  })

  it('preserves setup order, appends late players, and never fabricates opponent rows', () => {
    const base = startedState()
    const added = addBasketballLateParticipant(base, {
      recorderUserId: 'recorder-1',
      teamSide: 'opponent',
      displayName: 'Opponent Seven',
      number: '7',
      playerId: 'ac000000-0000-4000-8000-000000000201',
      participantId: 'ac000000-0000-4000-8000-000000000301',
      occurredAt: '2026-08-20T12:01:00.000Z',
      eventId: 'ac000000-0000-4000-8000-000000000002',
    })
    if (!added.ok) throw new Error(added.message)
    const review = basketballPlayerReview(added.state, inspection(added.state))
    expect(review.tracked.map(row => row.displayName)).toEqual(['Alex One', 'Blake Two'])
    expect(review.opponent.map(row => row.displayName)).toEqual(['Opponent Seven'])
    expect(review.opponent[0]).toMatchObject({ lateAdded: true, rosterStatus: 'bench' })

    const withoutOpponent = basketballPlayerReview(base, inspection(base))
    expect(withoutOpponent.opponent).toEqual([])
  })

  it('uses authoritative side totals and separates unattributed activity', () => {
    const state = startedState()
    const sportState = state.sportGameState
    if (sportState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
    const candidate = structuredClone(state)
    if (candidate.sportGameState?.sportId !== 'basketball') throw new Error('Missing state')
    const participant = Object.values(candidate.sportGameState.projection.participants)[0]
    participant.stats.ast = 2
    candidate.sportGameState.projection.sideStats.tracked.ast = 3
    candidate.sportGameState.projection.sideStats.tracked.to = 1
    candidate.sportGameState.projection.teamActorStats.tracked.team_turnover = 1
    candidate.sportGameState.projection.teamActorStats.tracked.team_tech = 2
    const review = basketballTeamReview(candidate, inspection(state))
    expect(review.totals.tracked.assists).toBe(3)
    expect(review.attribution.participant.tracked.assists).toBe(2)
    expect(review.attribution.unattributed.tracked).toMatchObject({ assists: 1, turnovers: 1 })
    expect(review.attribution.technicalFouls.tracked).toBe(2)
  })
})

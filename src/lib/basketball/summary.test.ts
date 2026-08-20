import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { prepareBasketballGameStart } from './commands'
import { adjustBasketballScore } from './directCommands'
import {
  basketballMatchLeaders,
  basketballPeriodScoring,
  basketballSummaryPath,
  basketballTeamComparison,
  isBasketballSummaryRoute,
  parseBasketballSummaryQuery,
} from './summary'
import type { BasketballMatchEvent } from './types'

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
    eventId: 'ab000000-0000-4000-8000-000000000001',
    participantIds: [
      'ab000000-0000-4000-8000-000000000101',
      'ab000000-0000-4000-8000-000000000102',
    ],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

describe('Basketball summary model', () => {
  it('keeps the event summary route explicit and normalizes unshipped tabs', () => {
    const path = basketballSummaryPath({ gameId: 'game-1', tab: 'timeline', from: 'games' })
    const params = new URLSearchParams(path.split('?')[1])
    expect(params.get('sport')).toBe('basketball')
    expect(parseBasketballSummaryQuery(params)).toMatchObject({
      gameId: 'game-1', tab: 'overview', requestedTab: 'timeline', from: 'games',
    })
    expect(parseBasketballSummaryQuery(new URLSearchParams('tab=players')).tab).toBe('players')
    expect(parseBasketballSummaryQuery(new URLSearchParams('tab=team')).tab).toBe('team')
    expect(isBasketballSummaryRoute(createInitialState(), params)).toBe(true)
    expect(isBasketballSummaryRoute(createInitialState(), new URLSearchParams())).toBe(false)
    expect(isBasketballSummaryRoute(startedState(), new URLSearchParams('gameId=soccer-1')))
      .toBe(false)
    expect(isBasketballSummaryRoute(
      { ...createInitialState(), sport: basketball },
      new URLSearchParams('sport=basketball')
    )).toBe(false)
  })

  it('derives period scoring from active score events', () => {
    const adjusted = adjustBasketballScore(startedState(), {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: 3,
      reason: 'scoreboard_control',
      occurredAt: '2026-08-20T12:01:00.000Z',
      eventId: 'ab000000-0000-4000-8000-000000000002',
    })
    if (!adjusted.ok) throw new Error(adjusted.message)
    const rebuilt = rebuildGameEventProjection(
      adjusted.state, gameEventRegistry, gameEventProjectors
    )
    const sportState = rebuilt.state.sportGameState
    if (sportState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
    const events = rebuilt.inspection.activeEvents.filter(
      (event): event is BasketballMatchEvent => event.sportId === 'basketball'
    )
    expect(basketballPeriodScoring(sportState.projection, events)[0]).toMatchObject({
      label: 'Q1', tracked: 3, opponent: 0,
    })
  })

  it('derives comparisons and tie-aware tracked player leaders from projection totals', () => {
    const state = startedState()
    const sportState = state.sportGameState
    if (sportState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
    const projection = structuredClone(sportState.projection)
    const participants = Object.values(projection.participants)
    participants[0].stats['2pt'] = 2
    participants[0].stats.oreb = 1
    participants[0].stats.ast = 3
    participants[1].stats['3pt'] = 1
    participants[1].stats.ft = 1
    participants[1].stats.dreb = 2
    participants[1].stats.ast = 3
    projection.sideStats.tracked['2pt'] = 2
    projection.sideStats.tracked['3pt'] = 1
    projection.sideStats.tracked.ft = 1
    projection.sideStats.tracked.oreb = 1
    projection.sideStats.tracked.dreb = 2
    projection.sideStats.tracked.ast = 6

    const shooting = basketballTeamComparison(projection)[0]
    expect(shooting.rows[0]).toMatchObject({ tracked: 3, trackedAttempted: 3 })
    const leaders = basketballMatchLeaders(projection)
    expect(leaders.find(item => item.id === 'points')?.leaders).toHaveLength(2)
    expect(leaders.find(item => item.id === 'assists')?.leaders).toHaveLength(2)
    expect(leaders.some(item => item.id === 'steals')).toBe(false)
  })
})

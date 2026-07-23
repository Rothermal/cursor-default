import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { createInitialCloudSyncState } from '../gameReducer'
import { DEFAULT_SOCCER_MATCH_RULES } from './rules'
import {
  formatSoccerReviewDuration,
  formatSoccerReviewRate,
  soccerPlayerReview,
  soccerReviewRate,
} from './summaryPlayers'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

function fixtureState(): GameState {
  const setup: SoccerMatchSetup = {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: structuredClone(DEFAULT_SOCCER_MATCH_RULES),
    participants: [
      participant('keeper-a', 'A Keeper', '1', 'starter', 'goalkeeper'),
      participant('forward', 'Forward', '9', 'starter', 'forward'),
      participant('keeper-b', 'B Keeper', '12', 'bench', 'goalkeeper'),
      participant('zero-sub', 'Zero Second', '18', 'bench', 'defender'),
      participant('unused', 'Unused', '20', 'bench', 'midfielder'),
    ],
  }
  const sportGameState = createSoccerSportGameState(setup)
  const projection = sportGameState.projection
  projection.status = 'ended'
  projection.endReason = 'completed'
  projection.result = 'tracked_win'
  projection.decidedStage = 'regulation'
  projection.startedPeriodIds = ['regulation-1', 'regulation-2']
  projection.completedPeriodIds = ['regulation-1', 'regulation-2']
  projection.periodEndElapsedMsById = {
    'regulation-1': 45 * 60_000,
    'regulation-2': 90 * 60_000,
  }
  projection.clock = {
    running: false,
    elapsedMs: 90 * 60_000,
    anchorOccurredAt: null,
  }
  play(
    projection.participants['keeper-a'],
    true,
    'regulation-1',
    0,
    45 * 60_000,
    'goalkeeper'
  )
  play(
    projection.participants.forward,
    true,
    'regulation-1',
    0,
    45 * 60_000,
    'forward'
  )
  play(
    projection.participants['keeper-b'],
    false,
    'regulation-2',
    45 * 60_000,
    90 * 60_000,
    'goalkeeper'
  )
  play(
    projection.participants['zero-sub'],
    false,
    'regulation-2',
    50 * 60_000,
    50 * 60_000,
    'defender'
  )
  projection.participantStats.forward = {
    ...projection.participantStats.forward,
    goals: 2,
    shots: 6,
    shotsOnTarget: 4,
    primaryAssists: 1,
    tacklesAttempted: 3,
    tacklesWon: 2,
  }
  projection.participantStats['keeper-a'] = {
    ...projection.participantStats['keeper-a'],
    goalkeeperSaves: 3,
    goalkeeperShotsOnTargetFaced: 4,
    goalkeeperGoalsAllowed: 1,
  }

  return {
    sport: sports.find(sport => sport.id === 'soccer')!,
    gameInfo: {
      teamName: 'Tracked',
      opponentName: 'Opponent',
      tournamentName: '',
      date: '2026-07-23',
    },
    players: [],
    activePlayerId: null,
    opponentScore: 0,
    homeTeamScore: 0,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: createInitialCloudSyncState('idle'),
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    eventStream: { version: 1, events: [] },
    sportGameState,
  }
}

function participant(
  id: string,
  displayName: string,
  number: string,
  initialStatus: 'starter' | 'bench',
  role: 'goalkeeper' | 'defender' | 'midfielder' | 'forward'
) {
  return {
    id,
    kind: 'player' as const,
    playerId: `player-${id}`,
    displayName,
    number,
    initialStatus,
    initialRole: { group: role, label: null },
  }
}

function play(
  projected: NonNullable<GameState['sportGameState']>['projection']['participants'][string],
  started: boolean,
  periodId: string,
  startElapsedMs: number,
  endElapsedMs: number,
  role: 'goalkeeper' | 'defender' | 'forward'
) {
  projected.started = started
  projected.appearances = 1
  projected.totalActiveMs = endElapsedMs - startElapsedMs
  projected.status = 'bench'
  projected.role = { group: role, label: null }
  projected.onFieldIntervals = [{ periodId, startElapsedMs, endElapsedMs }]
  projected.roleIntervals = [{
    periodId,
    startElapsedMs,
    endElapsedMs,
    role: { group: role, label: null },
  }]
}

function matchEvent(
  sequence: number,
  eventType: string,
  options: {
    teamSide?: 'tracked' | 'opponent'
    elapsedMs?: number
    periodId?: string
    payload?: Record<string, unknown>
    goalkeeperId?: string | null
  } = {}
): GameEvent {
  const occurredAt = `2026-07-23T12:${String(sequence).padStart(2, '0')}:00.000Z`
  return {
    id: `event-${sequence}`,
    sportId: 'soccer',
    eventType,
    schemaVersion: 1,
    recorderUserId: 'recorder-1',
    sequence,
    period: {
      id: options.periodId ?? 'regulation-1',
      order: options.periodId === 'regulation-2' ? 2 : 1,
    },
    elapsedMs: options.elapsedMs ?? 10 * 60_000,
    occurredAt,
    teamSide: options.teamSide ?? 'tracked',
    location: null,
    actors: options.goalkeeperId === undefined || options.goalkeeperId === null
      ? []
      : [{
          kind: 'player',
          role: 'goalkeeper',
          participantId: options.goalkeeperId,
          playerId: `player-${options.goalkeeperId}`,
        }],
    payload: (options.payload ?? {}) as GameEvent['payload'],
    revision: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
  }
}

function inspection(...events: GameEvent[]): GameEventInspection<GameEvent> {
  return {
    complete: true,
    activeEvents: events,
    deletedEvents: [],
    diagnostics: [],
  }
}

describe('soccer player review', () => {
  it('orders starters, used substitutes, zero-second appearances, and DNP rows', () => {
    const state = fixtureState()
    const lineup = matchEvent(1, 'soccer.opening_lineup_recorded', {
      payload: {
        starters: [
          { participantId: 'forward', role: { group: 'forward', label: null } },
          { participantId: 'keeper-a', role: { group: 'goalkeeper', label: null } },
        ],
      },
    })
    const rows = soccerPlayerReview(state, inspection(lineup)).tracked.rows
    expect(rows.map(row => row.participantId)).toEqual([
      'forward',
      'keeper-a',
      'keeper-b',
      'zero-sub',
      'unused',
    ])
    expect(rows.find(row => row.participantId === 'zero-sub')).toMatchObject({
      lineupStatus: 'substitute',
      minutesMs: 0,
    })
    expect(rows.find(row => row.participantId === 'unused')?.lineupStatus).toBe('dnp')
  })

  it('derives exact rates and formats durations without shootout inputs', () => {
    const state = fixtureState()
    const review = soccerPlayerReview(state, inspection())
    const forward = review.tracked.rows.find(row => row.participantId === 'forward')!
    expect(forward.rates.shotAccuracy).toMatchObject({
      numerator: 4,
      denominator: 6,
    })
    expect(formatSoccerReviewRate(forward.rates.shotAccuracy)).toBe('67% (4/6)')
    expect(formatSoccerReviewRate(forward.rates.goalConversion)).toBe('33% (2/6)')
    expect(formatSoccerReviewRate(forward.rates.tackleWin)).toBe('67% (2/3)')
    expect(soccerReviewRate(0, 0)).toBeNull()
    expect(formatSoccerReviewDuration(65 * 60_000 + 3_000)).toBe('1:05:03')
  })

  it('credits only goalkeepers who did not concede during their intervals', () => {
    const state = fixtureState()
    state.sportGameState!.projection.sideTotals.opponent.score = 1
    const goal = matchEvent(2, 'soccer.shot', {
      teamSide: 'opponent',
      payload: { outcome: 'goal' },
      goalkeeperId: 'keeper-a',
    })
    const review = soccerPlayerReview(state, inspection(goal))
    expect(review.tracked.cleanSheet.status).toBe('denied')
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-a')?.cleanSheet.status)
      .toBe('denied')
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-b')?.cleanSheet.status)
      .toBe('credited')
  })

  it('shares clean sheets and excludes abandoned matches from final credit', () => {
    const state = fixtureState()
    let review = soccerPlayerReview(state, inspection())
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-a')?.cleanSheet.status)
      .toBe('shared')
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-b')?.cleanSheet.status)
      .toBe('shared')

    state.sportGameState!.projection.endReason = 'abandoned'
    state.sportGameState!.projection.result = 'abandoned'
    review = soccerPlayerReview(state, inspection())
    expect(review.tracked.cleanSheet.status).toBe('unavailable')
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-a')?.cleanSheet.status)
      .toBe('unavailable')
  })

  it('fails closed for score adjustments and unattributed concessions', () => {
    const state = fixtureState()
    const adjustment = matchEvent(3, 'soccer.score_adjustment', {
      teamSide: 'opponent',
      payload: { delta: 1, reason: 'Correction' },
    })
    let review = soccerPlayerReview(state, inspection(adjustment))
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-a')?.cleanSheet.status)
      .toBe('unavailable')
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-b')?.cleanSheet.status)
      .toBe('unavailable')

    state.sportGameState!.projection.participants['keeper-b'].onFieldIntervals[0].periodId =
      'regulation-1'
    state.sportGameState!.projection.participants['keeper-b'].roleIntervals[0].periodId =
      'regulation-1'
    const unattributed = matchEvent(4, 'soccer.own_goal', {
      teamSide: 'opponent',
      elapsedMs: 45 * 60_000,
      goalkeeperId: null,
    })
    review = soccerPlayerReview(state, inspection(unattributed))
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-a')?.cleanSheet.status)
      .toBe('denied')
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-b')?.cleanSheet.status)
      .toBe('denied')

    unattributed.elapsedMs = 100 * 60_000
    review = soccerPlayerReview(state, inspection(unattributed))
    expect(review.tracked.rows.find(row => row.participantId === 'keeper-a')?.cleanSheet.status)
      .toBe('unavailable')
  })
})

import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { prepareBasketballGameStart } from './commands'
import { adjustBasketballScore, captureBasketballDirectStat } from './directCommands'
import {
  BASKETBALL_NEGATIVE_SCORE_DIAGNOSTIC,
  basketballRecoverableScoreAdjustmentId,
  isBasketballNegativeScoreDiagnostic,
} from './scoreAdjustmentRecovery'
import { buildBasketballTimelineReview } from './timeline'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function startedState(): GameState {
  const started = prepareBasketballGameStart({
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-24',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
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
    occurredAt: '2026-08-24T16:00:00.000Z',
    eventId: '8a000000-0000-4000-8000-000000000001',
    participantIds: [
      '8a000000-0000-4000-8000-000000000101',
    ],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

function legacyNegativeScoreState(): {
  state: GameState
  shotId: string
  adjustmentId: string
} {
  const shot = captureBasketballDirectStat(startedState(), {
    recorderUserId: 'recorder-1',
    playerId: 'player-1',
    statId: '3pt',
    occurredAt: '2026-08-24T16:01:00.000Z',
    eventId: '8a000000-0000-4000-8000-000000000501',
  })
  if (!shot.ok) throw new Error(shot.message)
  const adjustment = adjustBasketballScore(shot.state, {
    recorderUserId: 'recorder-1',
    teamSide: 'tracked',
    delta: -3,
    reason: 'scoreboard_control',
    occurredAt: '2026-08-24T16:01:10.000Z',
    eventId: '8a000000-0000-4000-8000-000000000502',
  })
  if (!adjustment.ok) throw new Error(adjustment.message)
  return {
    shotId: shot.eventIds[0],
    adjustmentId: adjustment.eventIds[0],
    state: {
      ...adjustment.state,
      eventStream: adjustment.state.eventStream && {
        ...adjustment.state.eventStream,
        events: adjustment.state.eventStream.events.map(raw =>
          isGameEventEnvelope(raw) && raw.id === shot.eventIds[0]
            ? {
                ...raw,
                revision: raw.revision + 1,
                updatedAt: '2026-08-24T16:01:20.000Z',
                payload: { ...raw.payload, made: false },
              }
            : raw
        ),
      },
    },
  }
}

describe('Basketball negative-score recovery helpers', () => {
  it('recognizes only the exact negative-score semantic diagnostic', () => {
    expect(isBasketballNegativeScoreDiagnostic({
      code: 'semantic_validation_failed',
      message: BASKETBALL_NEGATIVE_SCORE_DIAGNOSTIC,
      eventId: '8a000000-0000-4000-8000-000000000502',
    })).toBe(true)
    expect(isBasketballNegativeScoreDiagnostic({
      code: 'semantic_validation_failed',
      message: BASKETBALL_NEGATIVE_SCORE_DIAGNOSTIC,
      eventId: null,
    })).toBe(false)
    expect(isBasketballNegativeScoreDiagnostic({
      code: 'unknown_event_type',
      message: BASKETBALL_NEGATIVE_SCORE_DIAGNOSTIC,
      eventId: '8a000000-0000-4000-8000-000000000502',
    })).toBe(false)
  })

  it('returns the flagged score adjustment for an already-persisted negative history', () => {
    const legacy = legacyNegativeScoreState()
    const review = buildBasketballTimelineReview(legacy.state)
    expect(basketballRecoverableScoreAdjustmentId(legacy.state, review.diagnostics))
      .toBe(legacy.adjustmentId)
  })

  it('refuses recovery once the cloud game is final', () => {
    const legacy = legacyNegativeScoreState()
    const finalState: GameState = {
      ...legacy.state,
      cloudSync: {
        ...legacy.state.cloudSync,
        gameStatus: 'final',
      },
    }
    const review = buildBasketballTimelineReview(legacy.state)
    expect(basketballRecoverableScoreAdjustmentId(finalState, review.diagnostics)).toBeNull()
  })

  it('refuses recovery for unmarked games and non-adjustment diagnostics', () => {
    const legacy = legacyNegativeScoreState()
    const unmarked: GameState = {
      ...legacy.state,
      gameDataAuthority: undefined,
      eventStream: null,
    }
    expect(basketballRecoverableScoreAdjustmentId(unmarked)).toBeNull()

    const review = buildBasketballTimelineReview(legacy.state)
    const shotOnlyDiagnostics = review.diagnostics.map(diagnostic =>
      diagnostic.eventId === legacy.adjustmentId
        ? { ...diagnostic, eventId: legacy.shotId }
        : diagnostic
    )
    expect(basketballRecoverableScoreAdjustmentId(legacy.state, shotOnlyDiagnostics)).toBeNull()
  })
})

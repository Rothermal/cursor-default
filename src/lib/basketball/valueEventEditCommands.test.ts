import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
} from './commands'
import { adjustBasketballScore, captureBasketballDirectStat } from './directCommands'
import { buildBasketballTimelineReview } from './timeline'
import {
  applyBasketballValueEvent,
  buildBasketballHistoricalValueEventDraft,
  buildBasketballValueEventEditDraft,
  previewBasketballHistoricalValueEvent,
  previewBasketballValueEventEdit,
} from './valueEventEditCommands'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-11',
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
  }
}

function startedState(): GameState {
  const started = prepareBasketballGameStart(setupState(), {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-11T14:00:00.000Z',
    eventId: '7a000000-0000-4000-8000-000000000001',
    participantIds: [
      '7a000000-0000-4000-8000-000000000101',
      '7a000000-0000-4000-8000-000000000102',
    ],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

describe('BKE-3D2 score and minutes event editing', () => {
  it('revises score metadata and moves manual minutes to another player', () => {
    const scored = adjustBasketballScore(startedState(), {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: 2,
      reason: 'scoreboard_control',
      occurredAt: '2026-08-11T14:01:00.000Z',
      eventId: '7a000000-0000-4000-8000-000000000201',
    })
    if (!scored.ok) throw new Error(scored.message)
    const minutes = captureBasketballDirectStat(scored.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: 'min',
      occurredAt: '2026-08-11T14:01:10.000Z',
      eventId: '7a000000-0000-4000-8000-000000000202',
    })
    if (!minutes.ok) throw new Error(minutes.message)

    const scoreDraft = buildBasketballValueEventEditDraft(minutes.state, scored.eventIds[0])
    if (!scoreDraft.ok) throw new Error(scoreDraft.message)
    const scorePreview = previewBasketballValueEventEdit(minutes.state, {
      ...scoreDraft.value,
      delta: 4,
      reason: 'official_correction',
      note: 'Official table ruling',
    }, 'recorder-1', '2026-08-11T14:02:00.000Z')
    if (!scorePreview.ok) throw new Error(scorePreview.message)
    const scoreApplied = applyBasketballValueEvent(minutes.state, scorePreview.value)
    if (!scoreApplied.ok) throw new Error(scoreApplied.message)

    const minutesDraft = buildBasketballValueEventEditDraft(scoreApplied.state, minutes.eventIds[0])
    if (!minutesDraft.ok) throw new Error(minutesDraft.message)
    const minutesPreview = previewBasketballValueEventEdit(scoreApplied.state, {
      ...minutesDraft.value,
      actor: { kind: 'participant', participantId: '7a000000-0000-4000-8000-000000000102' },
      delta: 3,
    }, 'recorder-1', '2026-08-11T14:02:10.000Z')
    if (!minutesPreview.ok) throw new Error(minutesPreview.message)
    const applied = applyBasketballValueEvent(scoreApplied.state, minutesPreview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Edit failed')

    expect(applied.state.sportGameState.projection.score.tracked).toBe(4)
    expect(applied.state.sportGameState.projection.participants['7a000000-0000-4000-8000-000000000101'].stats.min).toBe(0)
    expect(applied.state.sportGameState.projection.participants['7a000000-0000-4000-8000-000000000102'].stats.min).toBe(3)
    expect(applied.state.eventStream?.events.find(event =>
      isGameEventEnvelope(event) && event.id === scored.eventIds[0]
    )).toMatchObject({
      revision: 2,
      eventType: 'basketball.score_adjustment',
      payload: { delta: 4, reason: 'official_correction', note: 'Official table ruling' },
    })
  })

  it('adds score and minutes to a prior started period while Q2 is active', () => {
    const ended = endBasketballPeriod(startedState(), {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:05:00.000Z',
      eventId: '7a000000-0000-4000-8000-000000000301',
    })
    if (!ended.ok) throw new Error(ended.message)
    const q2 = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:06:00.000Z',
      eventId: '7a000000-0000-4000-8000-000000000302',
    })
    if (!q2.ok || q2.state.sportGameState?.sportId !== 'basketball') throw new Error('Q2 failed')
    const q1 = q2.state.sportGameState.projection.periods[0]

    const scoreDraft = buildBasketballHistoricalValueEventDraft(q2.state, 'basketball.score_adjustment')
    if (!scoreDraft.ok) throw new Error(scoreDraft.message)
    const scorePreview = previewBasketballHistoricalValueEvent(q2.state, {
      ...scoreDraft.value,
      eventId: '7a000000-0000-4000-8000-000000000303',
      period: { id: q1.id, order: q1.order },
      delta: 2,
      reason: 'unattributed_score',
    }, 'recorder-1', '2026-08-11T14:07:00.000Z')
    if (!scorePreview.ok) throw new Error(scorePreview.message)
    const scored = applyBasketballValueEvent(q2.state, scorePreview.value)
    if (!scored.ok) throw new Error(scored.message)

    const minutesDraft = buildBasketballHistoricalValueEventDraft(scored.state, 'basketball.minutes_adjustment')
    if (!minutesDraft.ok) throw new Error(minutesDraft.message)
    const minutesPreview = previewBasketballHistoricalValueEvent(scored.state, {
      ...minutesDraft.value,
      eventId: '7a000000-0000-4000-8000-000000000304',
      period: { id: q1.id, order: q1.order },
      delta: 2,
    }, 'recorder-1', '2026-08-11T14:07:10.000Z')
    if (!minutesPreview.ok) throw new Error(minutesPreview.message)
    const applied = applyBasketballValueEvent(scored.state, minutesPreview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Add failed')

    expect(applied.state.sportGameState.projection.score.tracked).toBe(2)
    expect(applied.state.sportGameState.projection.participants['7a000000-0000-4000-8000-000000000101'].stats.min).toBe(2)
    const timeline = buildBasketballTimelineReview(applied.state)
    expect(timeline.eventById.get('7a000000-0000-4000-8000-000000000303')).toMatchObject({ recordedLater: true })
    expect(timeline.eventById.get('7a000000-0000-4000-8000-000000000304')).toMatchObject({ recordedLater: true })

    const q2Ended = endBasketballPeriod(applied.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:08:00.000Z',
      eventId: '7a000000-0000-4000-8000-000000000305',
    })
    if (!q2Ended.ok) throw new Error(q2Ended.message)
    const breakDraft = buildBasketballHistoricalValueEventDraft(q2Ended.state, 'basketball.minutes_adjustment')
    if (!breakDraft.ok) throw new Error(breakDraft.message)
    const breakPreview = previewBasketballHistoricalValueEvent(q2Ended.state, {
      ...breakDraft.value,
      eventId: '7a000000-0000-4000-8000-000000000306',
      period: { id: q1.id, order: q1.order },
      delta: 1,
    }, 'recorder-1', '2026-08-11T14:08:10.000Z')
    if (!breakPreview.ok) throw new Error(breakPreview.message)
    const breakApplied = applyBasketballValueEvent(q2Ended.state, breakPreview.value)
    if (!breakApplied.ok || breakApplied.state.sportGameState?.sportId !== 'basketball') throw new Error('Period-break add failed')
    expect(breakApplied.state.sportGameState.projection.participants['7a000000-0000-4000-8000-000000000101'].stats.min).toBe(3)
  })

  it('rejects negative totals, missing official notes, stale reviews, and anchored-clock minutes', () => {
    const scoreDraft = buildBasketballHistoricalValueEventDraft(startedState(), 'basketball.score_adjustment')
    if (!scoreDraft.ok) throw new Error(scoreDraft.message)
    expect(previewBasketballHistoricalValueEvent(startedState(), {
      ...scoreDraft.value,
      delta: -1,
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('below zero') })
    expect(previewBasketballHistoricalValueEvent(startedState(), {
      ...scoreDraft.value,
      reason: 'official_correction',
      note: '   ',
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('require a note') })

    const minutesDraft = buildBasketballHistoricalValueEventDraft(startedState(), 'basketball.minutes_adjustment')
    if (!minutesDraft.ok) throw new Error(minutesDraft.message)
    expect(previewBasketballHistoricalValueEvent(startedState(), {
      ...minutesDraft.value,
      delta: -1,
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('below zero') })

    const changed = adjustBasketballScore(startedState(), {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: 1,
      reason: 'scoreboard_control',
      eventId: '7a000000-0000-4000-8000-000000000401',
    })
    if (!changed.ok) throw new Error(changed.message)
    expect(previewBasketballHistoricalValueEvent(changed.state, scoreDraft.value, 'recorder-1'))
      .toMatchObject({ ok: false, message: expect.stringContaining('Timeline changed') })

    const manualState = startedState()
    const anchored: GameState = {
      ...manualState,
      sportGameState: manualState.sportGameState?.sportId === 'basketball'
        ? {
            ...manualState.sportGameState,
            setup: {
              ...manualState.sportGameState.setup,
              rulesSnapshot: {
                ...manualState.sportGameState.setup.rulesSnapshot,
                clockModel: 'anchored',
              },
            },
          }
        : null,
    }
    expect(buildBasketballHistoricalValueEventDraft(anchored, 'basketball.minutes_adjustment'))
      .toMatchObject({ ok: false, message: expect.stringContaining('clock is authoritative') })
  })
})

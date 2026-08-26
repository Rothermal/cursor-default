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
  previewBasketballTimelineRemoval,
  removeBasketballTimelineEvents,
} from './timelineCorrections'
import {
  buildBasketballShotEditDraft,
  previewBasketballShotEdit,
} from './shotEditCommands'
import { basketballRecoverableScoreAdjustmentId } from './scoreAdjustmentRecovery'
import type { BasketballMatchRulesV1 } from './types'
import {
  applyBasketballValueEvent,
  basketballMinutesActorOptions,
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

function madeThreeWithOffset(): {
  state: GameState
  shotId: string
  adjustmentId: string
} {
  const shot = captureBasketballDirectStat(startedState(), {
    recorderUserId: 'recorder-1',
    playerId: 'player-1',
    statId: '3pt',
    occurredAt: '2026-08-11T14:09:00.000Z',
    eventId: '7a000000-0000-4000-8000-000000000501',
  })
  if (!shot.ok) throw new Error(shot.message)
  const adjustment = adjustBasketballScore(shot.state, {
    recorderUserId: 'recorder-1',
    teamSide: 'tracked',
    delta: -3,
    reason: 'scoreboard_control',
    occurredAt: '2026-08-11T14:09:10.000Z',
    eventId: '7a000000-0000-4000-8000-000000000502',
  })
  if (!adjustment.ok) throw new Error(adjustment.message)
  return { state: adjustment.state, shotId: shot.eventIds[0], adjustmentId: adjustment.eventIds[0] }
}

function legacyNegativeScoreState(): ReturnType<typeof madeThreeWithOffset> {
  const captured = madeThreeWithOffset()
  return {
    ...captured,
    state: {
      ...captured.state,
      eventStream: captured.state.eventStream && {
        ...captured.state.eventStream,
        events: captured.state.eventStream.events.map(raw =>
          isGameEventEnvelope(raw) && raw.id === captured.shotId
            ? {
                ...raw,
                revision: raw.revision + 1,
                updatedAt: '2026-08-11T14:09:20.000Z',
                payload: { ...raw.payload, made: false },
              }
            : raw
        ),
      },
    },
  }
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
    if (manualState.sportGameState?.sportId !== 'basketball' ||
        manualState.sportGameState.setup.version !== 1) {
      throw new Error('Expected a version-1 Basketball setup fixture.')
    }
    const legacyRules = manualState.sportGameState?.sportId === 'basketball'
      ? manualState.sportGameState.setup.rulesSnapshot as BasketballMatchRulesV1
      : null
    const anchored: GameState = {
      ...manualState,
      sportGameState: manualState.sportGameState?.sportId === 'basketball'
        ? {
            ...manualState.sportGameState,
            setup: {
              ...manualState.sportGameState.setup,
              rulesSnapshot: {
                ...legacyRules!,
                clockModel: 'anchored',
              },
            },
          }
        : null,
    }
    expect(buildBasketballHistoricalValueEventDraft(anchored, 'basketball.minutes_adjustment'))
      .toMatchObject({ ok: false, message: expect.stringContaining('clock is authoritative') })
  })

  it('keeps newly introduced negative-score histories blocked', () => {
    const captured = madeThreeWithOffset()
    const draft = buildBasketballShotEditDraft(captured.state, captured.shotId)
    if (!draft.ok) throw new Error(draft.message)
    expect(previewBasketballShotEdit(captured.state, {
      ...draft.value,
      made: false,
    }, 'recorder-1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('invalid or incomplete match history'),
    })
  })

  it('lets an existing negative-score adjustment be edited or removed to repair the stream', () => {
    const legacy = legacyNegativeScoreState()
    const review = buildBasketballTimelineReview(legacy.state)
    expect(review.complete).toBe(false)
    expect(review.globalWarnings).toContain(
      'Basketball score history is below zero. Edit or remove the flagged score adjustment to repair this game.'
    )
    expect(review.eventById.get(legacy.adjustmentId)?.warnings).toContain(
      'Basketball score cannot project below zero.'
    )
    expect(basketballRecoverableScoreAdjustmentId(legacy.state, review.diagnostics))
      .toBe(legacy.adjustmentId)

    const draft = buildBasketballValueEventEditDraft(legacy.state, legacy.adjustmentId)
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballValueEventEdit(legacy.state, {
      ...draft.value,
      delta: 1,
    }, 'recorder-1', '2026-08-11T14:10:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const edited = applyBasketballValueEvent(legacy.state, preview.value)
    if (!edited.ok || edited.state.sportGameState?.sportId !== 'basketball') throw new Error('Recovery edit failed')
    expect(buildBasketballTimelineReview(edited.state).complete).toBe(true)
    expect(edited.state.sportGameState.projection.score.tracked).toBe(1)

    const removalPreview = previewBasketballTimelineRemoval(
      legacy.state,
      legacy.adjustmentId
    )
    if (!removalPreview.ok) throw new Error(removalPreview.message)
    const removed = removeBasketballTimelineEvents(
      legacy.state,
      removalPreview.value,
      '2026-08-11T14:10:10.000Z'
    )
    if (!removed.ok || removed.state.sportGameState?.sportId !== 'basketball') throw new Error('Recovery removal failed')
    expect(buildBasketballTimelineReview(removed.state).complete).toBe(true)
    expect(removed.state.sportGameState.projection.score.tracked).toBe(0)
  })

  it('omits unresolved participants from manual-minutes choices', () => {
    const state = startedState()
    if (state.sportGameState?.sportId !== 'basketball') throw new Error('Basketball state unavailable')
    const unresolvedId = '7a000000-0000-4000-8000-000000000101'
    const unresolved: GameState = {
      ...state,
      sportGameState: {
        ...state.sportGameState,
        projection: {
          ...state.sportGameState.projection,
          participants: {
            ...state.sportGameState.projection.participants,
            [unresolvedId]: {
              ...state.sportGameState.projection.participants[unresolvedId],
              playerId: null,
            },
          },
        },
      },
    }
    expect(basketballMinutesActorOptions(unresolved, 'tracked').map(option => option.selection))
      .not.toContainEqual({ kind: 'participant', participantId: unresolvedId })
  })
})

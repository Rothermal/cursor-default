import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { addGameEvent } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createGameEventStream } from '../gameEvents/stream'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import {
  addBasketballLateParticipant,
  endBasketballPeriod,
  startNextBasketballPeriod,
} from './commands'
import {
  pauseBasketballClock,
  setBasketballClock,
  startBasketballClock,
} from './clockCommands'
import { createBasketballLifecycleEvent } from './events'
import { createBasketballLineupEvent } from './lineupEvents'
import {
  changeBasketballParticipantRoles,
  confirmBasketballBoundaryLineup,
  substituteBasketballLineup,
  updateBasketballLineup,
} from './lineupCommands'
import { getBasketballRulesProfile, upgradeBasketballRulesDraftToV3 } from './profiles'
import { createBasketballSportGameState } from './state'
import type {
  BasketballEqualPlayPolicy,
  BasketballMatchEvent,
  BasketballMatchParticipant,
  BasketballMatchRulesV3,
  BasketballMatchSetupV2,
} from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorderUserId = 'recorder-1'
const baseTime = '2026-08-27T14:00:00.000Z'

describe('BKE-6A3 Basketball lineup and participation projection', () => {
  it('derives exact participation from running intervals and leaves manual minutes inert', () => {
    const state = anchoredState()
    const started = requireState(startBasketballClock(state, {
      recorderUserId,
      occurredAt: baseTime,
      eventId: uuid(2),
    }))
    const paused = requireState(pauseBasketballClock(started, {
      recorderUserId,
      occurredAt: after(12_345),
      eventId: uuid(3),
    }))
    const lineup = trackedLineup(paused)
    expect(lineup.currentParticipantIds).toEqual(trackedStarterIds())
    expect(lineup.participationByParticipantId['tracked-1']).toMatchObject({
      appeared: true,
      participationMs: 12_345,
      participationSeconds: 12.345,
      creditedPeriodIds: [periodId(paused)],
    })
    expect(lineup.participationByParticipantId['tracked-6'].participationMs).toBe(0)
    expect(basketballProjection(paused).sideStats.tracked.min).toBeCloseTo(1.02875)

    const event = createBasketballAdministrativeEvent({
      id: uuid(4),
      eventType: 'basketball.minutes_adjustment',
      payload: { deltaMinutes: 3, captureCommandId: null },
      recorderUserId,
      sequence: 4,
      period: currentPeriod(paused),
      elapsedMs: 12_345,
      occurredAt: after(13_000),
      teamSide: 'tracked',
      actors: [playerActor(paused, 'tracked-1', 'player')],
    })
    const appended = addGameEvent(paused, event, gameEventRegistry, gameEventProjectors)
    expect(appended.ok).toBe(true)
    if (appended.ok) {
      expect(trackedLineup(appended.state).participationByParticipantId['tracked-1'].participationMs)
        .toBe(12_345)
    }
  })

  it('attributes multi-player substitutions and role changes to stable participants', () => {
    const firstPause = runAndPause(anchoredState(), 0, 10_000, 10)
    const substituted = requireState(substituteBasketballLineup(firstPause, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      mode: 'balanced',
      occurredAt: after(11_000),
      eventId: uuid(12),
    }))
    const roles = requireState(changeBasketballParticipantRoles(substituted, {
      recorderUserId,
      teamSide: 'tracked',
      changes: [{ participantId: 'tracked-6', position: 'Center', captain: true }],
      occurredAt: after(12_000),
      eventId: uuid(13),
    }))
    const secondPause = runAndPause(roles, 20_000, 25_000, 14)
    const lineup = trackedLineup(secondPause)
    expect(lineup.participationByParticipantId['tracked-1'].participationMs).toBe(10_000)
    expect(lineup.participationByParticipantId['tracked-2'].participationMs).toBe(15_000)
    expect(lineup.participationByParticipantId['tracked-6'].participationMs).toBe(5_000)
    expect(basketballProjection(secondPause).participants['tracked-6']).toMatchObject({
      position: 'Center',
      captain: true,
    })
    const roleHistory = lineup.roleHistoryByParticipantId['tracked-6']
    expect(roleHistory[roleHistory.length - 1]).toMatchObject({
      position: 'Center',
      captain: true,
    })
  })

  it('commits substitution then role changes in one atomic capture group', () => {
    const state = anchoredState()
    const result = updateBasketballLineup(state, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      roleChanges: [
        { participantId: 'tracked-2', position: 'PG', captain: true },
        { participantId: 'tracked-6', position: 'Stretch Five', captain: true },
      ],
      occurredAt: after(1_000),
      eventId: uuid(905),
      captureCommandId: uuid(906),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const events = result.state.eventStream!.events.slice(-2) as BasketballMatchEvent[]
    expect(events.map(event => event.eventType)).toEqual([
      'basketball.substitution',
      'basketball.role_changed',
    ])
    expect(events.map(event => event.payload.captureCommandId)).toEqual([uuid(906), uuid(906)])
    expect(events.map(event => event.occurredAt)).toEqual([after(1_000), after(1_000)])
    expect(events[1].sequence).toBe(events[0].sequence + 1)
    expect(basketballProjection(result.state).participants['tracked-2']).toMatchObject({
      position: 'PG',
      captain: true,
    })
    expect(basketballProjection(result.state).participants['tracked-6']).toMatchObject({
      position: 'Stretch Five',
      captain: true,
    })
  })

  it('supports role-only preset, custom, none, and zero or multiple captains', () => {
    const state = requireState(changeBasketballParticipantRoles(anchoredState(), {
      recorderUserId,
      teamSide: 'tracked',
      changes: [
        { participantId: 'tracked-1', position: 'PG', captain: true },
        { participantId: 'tracked-2', position: 'Point Forward', captain: true },
        { participantId: 'tracked-3', position: null, captain: false },
      ],
      occurredAt: after(1_000),
    }))
    expect(basketballProjection(state).participants['tracked-1']).toMatchObject({ position: 'PG', captain: true })
    expect(basketballProjection(state).participants['tracked-2']).toMatchObject({ position: 'Point Forward', captain: true })
    expect(basketballProjection(state).participants['tracked-3']).toMatchObject({ position: null, captain: false })

    const cleared = requireState(changeBasketballParticipantRoles(state, {
      recorderUserId,
      teamSide: 'tracked',
      changes: [
        { participantId: 'tracked-1', position: null, captain: false },
        { participantId: 'tracked-2', position: null, captain: false },
      ],
      occurredAt: after(2_000),
    }))
    expect(Object.values(basketballProjection(cleared).participants)
      .filter(participant => participant.teamSide === 'tracked' && participant.captain)).toHaveLength(0)
  })

  it('derives the live transition mode, stores one structured event, and clears quick Undo', () => {
    const state = anchoredState()
    if (state.sportGameState?.sportId !== 'basketball') throw new Error('Expected Basketball state')
    state.sportGameState.capturePreferences.lastCourtUndo = {
      kind: 'capture_undo',
      createdAt: baseTime,
      entries: [{
        eventId: uuid(900),
        expectedRevision: 2,
        action: 'restore',
        previousRelatedEventId: null,
        previousAttemptNumber: null,
      }],
    }
    const beforeCount = state.eventStream!.events.length
    const result = substituteBasketballLineup(state, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      occurredAt: after(1_000),
      eventId: uuid(901),
      captureCommandId: uuid(902),
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.state.sportGameState?.sportId !== 'basketball') return
    expect(result.state.eventStream!.events).toHaveLength(beforeCount + 1)
    const appendedEvent = result.state.eventStream!.events[result.state.eventStream!.events.length - 1]
    expect(appendedEvent).toMatchObject({
      id: uuid(901),
      eventType: 'basketball.substitution',
      occurredAt: after(1_000),
      payload: {
        captureCommandId: uuid(902),
        mode: 'balanced',
        reasonCode: null,
        reasonNote: null,
      },
    })
    expect(result.state.sportGameState.capturePreferences.lastCourtUndo).toBeNull()
  })

  it('supports reasoned short-handed exit and entry transitions', () => {
    const state = anchoredState()
    expect(substituteBasketballLineup(state, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4'],
      mode: 'exit_only',
      occurredAt: after(1_000),
    }).ok).toBe(false)
    const shortHanded = requireState(substituteBasketballLineup(state, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4'],
      mode: 'exit_only',
      reasonCode: 'injury',
      reasonNote: 'Player receiving treatment',
      occurredAt: after(2_000),
    }))
    expect(trackedLineup(shortHanded)).toMatchObject({
      currentParticipantIds: ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4'],
      currentShortHandedReasonCode: 'injury',
      currentShortHandedReasonNote: 'Player receiving treatment',
    })
    const restored = requireState(substituteBasketballLineup(shortHanded, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: trackedStarterIds(),
      mode: 'entry_only',
      reasonCode: 'recovery',
      reasonNote: 'Player cleared to return',
      occurredAt: after(3_000),
    }))
    expect(trackedLineup(restored)).toMatchObject({
      currentParticipantIds: trackedStarterIds(),
      currentShortHandedReasonCode: null,
      currentShortHandedReasonNote: null,
    })
  })

  it('captures unequal mixed entries and exits as one truthful substitution', () => {
    const state = anchoredState()
    const beforeCount = state.eventStream!.events.length
    const mixed = requireState(substituteBasketballLineup(state, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-6'],
      reasonCode: 'injury',
      reasonNote: 'One ejection and one injury at the same dead ball',
      occurredAt: after(1_000),
      eventId: uuid(903),
      captureCommandId: uuid(904),
    }))

    expect(mixed.eventStream!.events).toHaveLength(beforeCount + 1)
    expect(mixed.eventStream!.events[mixed.eventStream!.events.length - 1]).toMatchObject({
      id: uuid(903),
      eventType: 'basketball.substitution',
      payload: {
        captureCommandId: uuid(904),
        participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-6'],
        mode: 'mixed',
        reasonCode: 'injury',
        reasonNote: 'One ejection and one injury at the same dead ball',
      },
    })
    expect(trackedLineup(mixed).currentParticipantIds)
      .toEqual(['tracked-2', 'tracked-3', 'tracked-4', 'tracked-6'])
  })

  it('rejects duplicate, wrong-side, and impossible substitution lineups', () => {
    const state = anchoredState({ opponent: true })
    const common = {
      recorderUserId,
      teamSide: 'tracked' as const,
      mode: 'balanced' as const,
      occurredAt: after(1_000),
    }
    expect(substituteBasketballLineup(state, {
      ...common,
      participantIds: ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4', 'tracked-4'],
    })).toMatchObject({ ok: false, code: 'invalid_participant' })
    expect(substituteBasketballLineup(state, {
      ...common,
      participantIds: ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4', 'opponent-1'],
    })).toMatchObject({ ok: false, code: 'invalid_participant' })
    expect(substituteBasketballLineup(state, {
      ...common,
      participantIds: [
        'tracked-1',
        'tracked-2',
        'tracked-3',
        'tracked-4',
        'tracked-5',
        'tracked-6',
      ],
    }).ok).toBe(false)
  })

  it('rolls derived intervals back at a reasoned backward clock adjustment', () => {
    const firstPause = runAndPause(anchoredState(), 0, 10_000, 20)
    const adjusted = requireState(setBasketballClock(firstPause, {
      recorderUserId,
      elapsedMs: 3_000,
      reason: 'Correct scoreboard',
      occurredAt: after(11_000),
      eventId: uuid(22),
    }))
    expect(trackedLineup(adjusted).participationByParticipantId['tracked-1'].participationMs)
      .toBe(3_000)
    expect(basketballProjection(adjusted).lineup?.runningClockIntervals).toMatchObject([
      { startElapsedMs: 0, endElapsedMs: 3_000 },
    ])
    const substituted = requireState(substituteBasketballLineup(adjusted, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      mode: 'balanced',
      occurredAt: after(12_000),
      eventId: uuid(23),
    }))
    const secondPause = runAndPause(substituted, 20_000, 24_000, 24)
    const lineup = trackedLineup(secondPause)
    expect(lineup.onCourtIntervals).toMatchObject([
      { startElapsedMs: 0, endElapsedMs: 3_000 },
      {
        participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
        startElapsedMs: 3_000,
      },
    ])
    expect(lineup.participationByParticipantId['tracked-1'].participationMs).toBe(3_000)
    expect(lineup.participationByParticipantId['tracked-2'].participationMs).toBe(7_000)
    expect(lineup.participationByParticipantId['tracked-6'].participationMs).toBe(4_000)
    expect(basketballProjection(secondPause).sideStats.tracked.min).toBeCloseTo(35_000 / 60_000)
  })

  it('requires boundary confirmation and invalidates it after a pre-start substitution', () => {
    const secondPeriod = nextPeriodState(anchoredState({ boundaries: true }))
    expect(trackedLineup(secondPeriod).boundaryConfirmationRequired).toBe(true)
    expect(startBasketballClock(secondPeriod, {
      recorderUserId,
      occurredAt: after(20_000),
    })).toMatchObject({ ok: false, state: secondPeriod })

    const confirmed = requireState(confirmTrackedBoundary(secondPeriod, {
      occurredAt: after(21_000),
      eventId: uuid(31),
    }))
    expect(trackedLineup(confirmed).boundaryConfirmationRequired).toBe(false)
    const changed = requireState(substituteBasketballLineup(confirmed, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      mode: 'boundary',
      occurredAt: after(22_000),
      eventId: uuid(32),
    }))
    expect(trackedLineup(changed).boundaryConfirmationRequired).toBe(true)
    const reconfirmed = requireState(confirmTrackedBoundary(changed, {
      occurredAt: after(23_000),
      eventId: uuid(33),
    }))
    expect(startBasketballClock(reconfirmed, {
      recorderUserId,
      occurredAt: after(24_000),
      eventId: uuid(34),
    }).ok).toBe(true)
  })

  it('blocks Clock Start until an ejected on-court participant is explicitly replaced', () => {
    const state = anchoredState()
    const ejection = createBasketballAdministrativeEvent({
      id: uuid(40),
      eventType: 'basketball.ejection',
      payload: {
        reason: 'Official ruling',
        source: 'official_ruling',
        relatedFoulEventId: null,
        captureCommandId: null,
      },
      recorderUserId,
      sequence: 2,
      period: currentPeriod(state),
      elapsedMs: 0,
      occurredAt: after(1_000),
      teamSide: 'tracked',
      actors: [playerActor(state, 'tracked-1', 'subject')],
    })
    const appended = addGameEvent(state, ejection, gameEventRegistry, gameEventProjectors)
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    expect(trackedLineup(appended.state).replacementRequiredParticipantIds).toEqual(['tracked-1'])
    expect(startBasketballClock(appended.state, {
      recorderUserId,
      occurredAt: after(2_000),
    }).ok).toBe(false)
    const replaced = requireState(substituteBasketballLineup(appended.state, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      mode: 'balanced',
      occurredAt: after(3_000),
    }))
    expect(startBasketballClock(replaced, {
      recorderUserId,
      occurredAt: after(4_000),
    }).ok).toBe(false)
    const confirmed = requireState(confirmTrackedBoundary(replaced, {
      occurredAt: after(5_000),
    }))
    expect(startBasketballClock(confirmed, {
      recorderUserId,
      occurredAt: after(6_000),
    }).ok).toBe(true)
  })

  it('supports paused late participants and marks current-lineup recovery incomplete', () => {
    const state = anchoredState()
    const added = requireState(addBasketballLateParticipant(state, {
      recorderUserId,
      teamSide: 'tracked',
      displayName: 'Late Player',
      participantId: 'tracked-late',
      playerId: 'player-late',
      occurredAt: after(1_000),
      eventId: uuid(50),
    }))
    expect(trackedLineup(added).participationByParticipantId['tracked-late']).toMatchObject({
      started: false,
      participationMs: 0,
    })
    const recovered = requireState(substituteBasketballLineup(added, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-late'],
      mode: 'current_lineup_recovery',
      reasonCode: 'recovery',
      reasonNote: 'Recovered operator state',
      occurredAt: after(2_000),
      eventId: uuid(51),
    }))
    expect(trackedLineup(recovered).incompletePeriodIds).toEqual([periodId(recovered)])
    expect(trackedLineup(recovered).onCourtIntervals[0].complete).toBe(true)
    expect(trackedLineup(recovered).onCourtIntervals[1].complete).toBe(false)
    expect(Object.values(trackedLineup(recovered).participationByParticipantId)
      .every(value => !value.complete)).toBe(true)
  })

  it('keeps a late participant on the bench until an ordinary substitution enters them', () => {
    const state = anchoredState()
    const beforeCount = state.eventStream!.events.length
    const added = requireState(addBasketballLateParticipant(state, {
      recorderUserId,
      teamSide: 'tracked',
      displayName: 'Late Bench Player',
      participantId: 'tracked-late-bench',
      playerId: 'player-late-bench',
      occurredAt: after(1_000),
      eventId: uuid(907),
    }))
    expect(added.eventStream!.events).toHaveLength(beforeCount + 1)
    expect(trackedLineup(added).currentParticipantIds).toEqual(trackedStarterIds())
    expect(trackedLineup(added).participationByParticipantId['tracked-late-bench'].started).toBe(false)

    const entered = requireState(substituteBasketballLineup(added, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-late-bench'],
      occurredAt: after(2_000),
    }))
    expect(trackedLineup(entered).currentParticipantIds).toContain('tracked-late-bench')
  })

  it('reasserts the same current five without degrading earlier periods or the other side', () => {
    const secondPeriod = nextPeriodState(anchoredState({ opponent: true }))
    const currentId = periodId(secondPeriod)
    const recovered = requireState(updateBasketballLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      participantIds: trackedStarterIds(),
      mode: 'current_lineup_recovery',
      reasonCode: 'recovery',
      reasonNote: 'Recorder resumed after an uncertain stoppage',
      occurredAt: after(21_000),
      eventId: uuid(908),
    }))
    const tracked = trackedLineup(recovered)
    const opponent = basketballProjection(recovered).lineup!.sides.opponent!
    expect(tracked.incompletePeriodIds).toEqual([currentId])
    expect(tracked.onCourtIntervals.filter(interval => interval.periodId !== currentId)
      .every(interval => interval.complete)).toBe(true)
    expect(opponent.incompletePeriodIds).toEqual([])
    expect(opponent.onCourtIntervals.every(interval => interval.complete)).toBe(true)
  })

  it('keeps opponent authority optional and derives it independently when supplied', () => {
    expect(basketballProjection(anchoredState()).lineup?.sides.opponent).toBeNull()
    const withOpponent = anchoredState({ opponent: true })
    expect(basketballProjection(withOpponent).lineup?.sides.opponent?.currentParticipantIds)
      .toEqual(opponentStarterIds())
    const paused = runAndPause(withOpponent, 0, 5_000, 60)
    expect(basketballProjection(paused).lineup?.sides.opponent
      ?.participationByParticipantId['opponent-1'].participationMs).toBe(5_000)
  })

  it('records advisory equal-play violations but permits confirmation', () => {
    const secondPeriod = nextPeriodState(anchoredState({
      boundaries: true,
      equalPlayPolicy: strictPolicy('advisory'),
    }))
    const result = confirmTrackedBoundary(secondPeriod, {
      occurredAt: after(30_000),
      eventId: uuid(70),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const reviews = basketballProjection(result.state).lineup?.equalPlayReviews ?? []
    const review = reviews[reviews.length - 1]
    expect(review?.violations.map(value => value.code)).toEqual([
      'minimum_periods',
      'maximum_consecutive_periods',
      'maximum_period_imbalance',
    ])
    expect(basketballProjection(result.state).lineup?.equalPlayCompliant).toBe(false)
  })

  it('records a clean boundary review when equal play is off', () => {
    const secondPeriod = nextPeriodState(anchoredState({ boundaries: true }))
    const result = confirmTrackedBoundary(secondPeriod, {
      occurredAt: after(30_000),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(basketballProjection(result.state).lineup).toMatchObject({
      equalPlayCompliant: true,
      enforcedOverridesComplete: true,
      equalPlayReviews: [expect.objectContaining({ violations: [] })],
    })
  })

  it('requires and atomically consumes an exact enforced equal-play override', () => {
    const secondPeriod = nextPeriodState(anchoredState({
      boundaries: true,
      equalPlayPolicy: strictPolicy('enforced'),
    }))
    expect(confirmTrackedBoundary(secondPeriod, {
      overrideAuthorized: true,
      occurredAt: after(30_000),
    })).toMatchObject({ ok: false, state: secondPeriod })

    const result = confirmTrackedBoundary(secondPeriod, {
      overrideReason: 'Approved rotation exception',
      overrideAuthorized: true,
      occurredAt: after(31_000),
      overrideEventId: uuid(80),
      eventId: uuid(81),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.eventStream?.events.slice(-2).map(value =>
      (value as { eventType: string }).eventType
    )).toEqual([
      'basketball.equal_play_override',
      'basketball.lineup_confirmed',
    ])
    expect(basketballProjection(result.state).lineup).toMatchObject({
      enforcedOverridesComplete: true,
      pendingEqualPlayOverride: null,
    })
  })

  it('atomically changes and confirms a reviewed boundary lineup', () => {
    const secondPeriod = nextPeriodState(anchoredState({ boundaries: true }))
    expect(confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: trackedStarterIds(),
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      reasonCode: 'recovery',
      occurredAt: after(34_000),
    })).toMatchObject({ ok: false, state: secondPeriod })
    const result = confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: trackedStarterIds(),
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      occurredAt: after(35_000),
      substitutionEventId: uuid(84),
      eventId: uuid(85),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const events = result.state.eventStream!.events.slice(-2) as Array<{
      eventType: string
      occurredAt: string
      elapsedMs: number
      payload: { captureCommandId: string }
    }>
    expect(events.map(event => event.eventType)).toEqual([
      'basketball.substitution',
      'basketball.lineup_confirmed',
    ])
    expect(events.map(event => event.occurredAt)).toEqual([after(35_000), after(35_000)])
    expect(events.map(event => event.elapsedMs)).toEqual([0, 0])
    expect(events.map(event => event.payload.captureCommandId)).toEqual([
      events[0].payload.captureCommandId,
      events[0].payload.captureCommandId,
    ])
    expect(trackedLineup(result.state)).toMatchObject({
      currentParticipantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      boundaryConfirmationRequired: false,
    })

    const shortResult = confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: trackedStarterIds(),
      participantIds: ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4'],
      reasonCode: 'injury',
      reasonNote: 'Player unavailable at the boundary',
      occurredAt: after(35_500),
    })
    expect(shortResult.ok).toBe(true)
    if (!shortResult.ok) return
    expect(shortResult.state.eventStream?.events.slice(-2)[0]).toMatchObject({
      eventType: 'basketball.substitution',
      payload: {
        mode: 'boundary',
        reasonCode: 'injury',
        reasonNote: 'Player unavailable at the boundary',
      },
    })
  })

  it('rejects stale boundary candidates and unauthorized enforced overrides', () => {
    const secondPeriod = nextPeriodState(anchoredState({
      boundaries: true,
      equalPlayPolicy: strictPolicy('enforced'),
    }))
    expect(confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: [
        'tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6',
      ],
      participantIds: trackedStarterIds(),
      overrideAuthorized: true,
      overrideReason: 'Approved exception',
      occurredAt: after(36_000),
    })).toMatchObject({ ok: false, state: secondPeriod })
    expect(confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: trackedStarterIds(),
      participantIds: trackedStarterIds(),
      overrideAuthorized: false,
      overrideReason: 'Approved exception',
      occurredAt: after(37_000),
    })).toMatchObject({ ok: false, state: secondPeriod })
    expect(confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: trackedStarterIds(),
      participantIds: trackedStarterIds(),
      overrideAuthorized: true,
      overrideReason: ' '.repeat(2),
      occurredAt: after(38_000),
    })).toMatchObject({ ok: false, state: secondPeriod })
    expect(confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: trackedStarterIds(),
      participantIds: trackedStarterIds(),
      overrideAuthorized: true,
      overrideReason: 'x'.repeat(241),
      occurredAt: after(39_000),
    })).toMatchObject({ ok: false, state: secondPeriod })
  })

  it('groups an enforced changed boundary with its override and confirmation', () => {
    const secondPeriod = nextPeriodState(anchoredState({
      boundaries: true,
      equalPlayPolicy: strictPolicy('enforced'),
    }))
    const result = confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'tracked',
      expectedCurrentParticipantIds: trackedStarterIds(),
      participantIds: ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      overrideAuthorized: true,
      overrideReason: 'Approved rotation exception',
      occurredAt: after(38_000),
      substitutionEventId: uuid(86),
      overrideEventId: uuid(87),
      eventId: uuid(88),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const events = result.state.eventStream!.events.slice(-3) as Array<{
      eventType: string
      occurredAt: string
      payload: { captureCommandId: string }
    }>
    expect(events.map(event => event.eventType)).toEqual([
      'basketball.substitution',
      'basketball.equal_play_override',
      'basketball.lineup_confirmed',
    ])
    expect(new Set(events.map(event => event.payload.captureCommandId)).size).toBe(1)
    expect(new Set(events.map(event => event.occurredAt)).size).toBe(1)
  })

  it('confirms optional opponent boundary authority independently', () => {
    const secondPeriod = nextPeriodState(anchoredState({ boundaries: true, opponent: true }))
    const result = confirmBasketballBoundaryLineup(secondPeriod, {
      recorderUserId,
      teamSide: 'opponent',
      expectedCurrentParticipantIds: opponentStarterIds(),
      participantIds: opponentStarterIds(),
      occurredAt: after(40_000),
      eventId: uuid(89),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(basketballProjection(result.state).lineup?.sides).toMatchObject({
      tracked: { boundaryConfirmationRequired: true },
      opponent: { boundaryConfirmationRequired: false },
    })
    const events = result.state.eventStream?.events ?? []
    expect(events[events.length - 1]).toMatchObject({
      eventType: 'basketball.lineup_confirmed',
      teamSide: 'opponent',
    })
  })

  it('reports an unresolved enforced override as incomplete projection evidence', () => {
    const secondPeriod = nextPeriodState(anchoredState({
      boundaries: true,
      equalPlayPolicy: strictPolicy('enforced'),
    }))
    const captureCommandId = uuid(82)
    const override = createBasketballLineupEvent({
      id: uuid(83),
      eventType: 'basketball.equal_play_override',
      payload: {
        captureCommandId,
        boundaryPeriodId: periodId(secondPeriod),
        candidateParticipantIds: trackedStarterIds(),
        violationCodes: [
          'minimum_periods',
          'maximum_consecutive_periods',
          'maximum_period_imbalance',
        ],
        reason: 'Pending authorization record',
      },
      recorderUserId,
      sequence: secondPeriod.eventStream!.events.length + 1,
      period: currentPeriod(secondPeriod),
      elapsedMs: 0,
      occurredAt: after(32_000),
      teamSide: 'tracked',
    })
    const rebuilt = rebuildGameEventProjection({
      ...secondPeriod,
      eventStream: {
        ...secondPeriod.eventStream!,
        events: [...secondPeriod.eventStream!.events, override],
      },
    }, gameEventRegistry, gameEventProjectors)

    expect(rebuilt.inspection.complete).toBe(false)
    expect(basketballProjection(rebuilt.state).lineup).toMatchObject({
      enforcedOverridesComplete: false,
      pendingEqualPlayOverride: expect.objectContaining({ eventId: override.id }),
    })
  })
})

interface FixtureOptions {
  boundaries?: boolean
  opponent?: boolean
  equalPlayPolicy?: BasketballEqualPlayPolicy
}

function anchoredState(options: FixtureOptions = {}): GameState {
  const baseRules = getBasketballRulesProfile('nfhs', 1)!.rules
  const upgraded = upgradeBasketballRulesDraftToV3(baseRules, 'nfhs')
  const rules: BasketballMatchRulesV3 = {
    ...upgraded,
    regulationSegments: upgraded.regulationSegments.map(value => ({
      ...value,
      lineupChangeBoundary: options.boundaries ?? value.lineupChangeBoundary,
    })),
    equalPlayPolicy: options.equalPlayPolicy ?? upgraded.equalPlayPolicy,
  }
  const tracked = trackedParticipants()
  const opponent = options.opponent ? opponentParticipants() : []
  const participants = [...tracked, ...opponent]
  const setup: BasketballMatchSetupV2 = {
    version: 2,
    trackedTeamDesignation: 'home',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSource: {
      profileId: 'nfhs',
      profileVersion: 1,
      personalRevision: null,
      teamRevision: null,
      hasExplicitMatchOverrides: false,
    },
    rulesSnapshot: rules,
    participants,
    openingLineups: {
      tracked: { participantIds: trackedStarterIds(), shortHandedReason: null },
      opponent: options.opponent
        ? { participantIds: opponentStarterIds(), shortHandedReason: null }
        : null,
    },
  }
  const players: Player[] = participants.map(value => ({
    id: value.playerId!,
    name: value.displayName,
    number: value.number ?? '',
    stats: {},
  }))
  const state: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    eventStream: createGameEventStream(),
    sportGameState: createBasketballSportGameState(setup),
    players,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-27',
    },
  }
  const segment = rules.regulationSegments[0]
  const started = addGameEvent(state, createBasketballLifecycleEvent({
    id: uuid(1),
    eventType: 'basketball.period_started',
    payload: { periodId: segment.id, captureCommandId: null },
    recorderUserId,
    sequence: 1,
    period: { id: segment.id, order: segment.order },
    elapsedMs: 0,
    occurredAt: baseTime,
  }), gameEventRegistry, gameEventProjectors)
  if (!started.ok) throw new Error(started.error.message)
  return started.state
}

function nextPeriodState(state: GameState): GameState {
  const paused = runAndPause(state, 0, 5_000, 90)
  const ended = requireState(endBasketballPeriod(paused, {
    recorderUserId,
    occurredAt: after(6_000),
    eventId: uuid(92),
  }))
  return requireState(startNextBasketballPeriod(ended, {
    recorderUserId,
    occurredAt: after(7_000),
    eventId: uuid(93),
  }))
}

function runAndPause(
  state: GameState,
  startOffsetMs: number,
  pauseOffsetMs: number,
  idBase: number
): GameState {
  const started = requireState(startBasketballClock(state, {
    recorderUserId,
    occurredAt: after(startOffsetMs),
    eventId: uuid(idBase),
  }))
  return requireState(pauseBasketballClock(started, {
    recorderUserId,
    occurredAt: after(pauseOffsetMs),
    eventId: uuid(idBase + 1),
  }))
}

function trackedParticipants(): BasketballMatchParticipant[] {
  return Array.from({ length: 6 }, (_, index) => ({
    id: `tracked-${index + 1}`,
    playerId: `tracked-player-${index + 1}`,
    displayName: `Tracked ${index + 1}`,
    number: String(index + 1),
    teamSide: 'tracked',
    initialStatus: index < 5 ? 'starter' : 'bench',
    position: null,
    captain: index === 0,
  }))
}

function opponentParticipants(): BasketballMatchParticipant[] {
  return Array.from({ length: 5 }, (_, index) => ({
    id: `opponent-${index + 1}`,
    playerId: `opponent-player-${index + 1}`,
    displayName: `Opponent ${index + 1}`,
    number: String(index + 1),
    teamSide: 'opponent',
    initialStatus: 'starter',
    position: null,
    captain: index === 0,
  }))
}

function strictPolicy(mode: 'advisory' | 'enforced'): BasketballEqualPlayPolicy {
  return {
    mode,
    minimumPeriods: 3,
    maximumConsecutivePeriods: 1,
    maximumPeriodImbalance: 1,
  }
}

function trackedStarterIds(): string[] {
  return ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4', 'tracked-5']
}

function opponentStarterIds(): string[] {
  return ['opponent-1', 'opponent-2', 'opponent-3', 'opponent-4', 'opponent-5']
}

function basketballProjection(state: GameState) {
  if (state.sportGameState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
  return state.sportGameState.projection
}

function trackedLineup(state: GameState) {
  const lineup = basketballProjection(state).lineup?.sides.tracked
  if (!lineup) throw new Error('Missing tracked lineup')
  return lineup
}

function currentPeriod(state: GameState) {
  const periods = basketballProjection(state).periods
  const segment = periods[periods.length - 1]
  if (!segment) throw new Error('Missing period')
  return { id: segment.id, order: segment.order }
}

function periodId(state: GameState): string {
  return currentPeriod(state).id
}

function playerActor(state: GameState, participantId: string, role: string) {
  const participant = basketballProjection(state).participants[participantId]
  return {
    role,
    kind: 'player' as const,
    participantId,
    playerId: participant.playerId!,
    label: participant.displayName,
  }
}

function requireState(result: { ok: true; state: GameState } | { ok: false; message: string }): GameState {
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function confirmTrackedBoundary(
  state: GameState,
  options: {
    occurredAt: string
    eventId?: string
    overrideReason?: string
    overrideAuthorized?: boolean
    overrideEventId?: string
  }
) {
  const participantIds = trackedLineup(state).currentParticipantIds
  return confirmBasketballBoundaryLineup(state, {
    recorderUserId,
    teamSide: 'tracked',
    expectedCurrentParticipantIds: participantIds,
    participantIds,
    ...options,
  })
}

function after(deltaMs: number): string {
  return new Date(Date.parse(baseTime) + deltaMs).toISOString()
}

function uuid(value: number): string {
  return `61000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

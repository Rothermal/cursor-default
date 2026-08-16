import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { BasketballTeamStatsConfig, GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { addGameEvents } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import {
  addBasketballLateParticipant,
  basketballActorForSelection,
  endBasketballPeriod,
  getBasketballCommandContext,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
} from './commands'
import {
  canDecrementBasketballFoul,
  decrementBasketballDirectStat,
  decrementBasketballFoul,
  previewBasketballFoulDecrement,
  previewBasketballDirectDecrement,
  previewBasketballFreeThrowTripRemoval,
  removeBasketballFreeThrowTrip,
  restoreLastBasketballCourtUndo,
} from './courtCorrections'
import {
  basketballFreeThrowTripStatuses,
  captureBasketballFoul,
  captureBasketballFreeThrowAttempt,
  type BasketballFoulCaptureOptions,
} from './foulFreeThrowCommands'
import { normalizeBasketballCourtUndoReceipt } from './state'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name = id, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(
  teamStatsOverrides: Partial<BasketballTeamStatsConfig> = {}
): GameState {
  const teamStatsConfig = {
    periodsPerGame: 4,
    periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
    bonusThreshold: 5,
    doubleBonusThreshold: 5,
    hasOneAndOne: false,
    overtimeLabel: 'OT',
    overtimeFoulsReset: true,
    timeoutsPerPeriod: null,
    timeoutsPerOvertime: null,
    ...teamStatsOverrides,
  }
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-08',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig,
  }
}

function startedState(
  teamStatsOverrides: Partial<BasketballTeamStatsConfig> = {}
): GameState {
  const result = prepareBasketballGameStart(setupState(teamStatsOverrides), {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-08T12:00:00.000Z',
    eventId: id(1),
    participantIds: [id(101), id(102)],
  })
  if (!result.ok) throw new Error(result.message)
  return withOpponent(result.state)
}

function withOpponent(state: GameState): GameState {
  const result = addBasketballLateParticipant(state, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Nine',
    number: '9',
    occurredAt: '2026-08-08T12:01:00.000Z',
    eventId: id(201),
    participantId: id(202),
    playerId: 'opponent-9',
    captureCommandId: id(203),
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function id(value: number): string {
  return `73000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

function captureFoul(
  state: GameState,
  index: number,
  overrides: Partial<BasketballFoulCaptureOptions> = {}
) {
  return captureBasketballFoul(state, {
    recorderUserId: 'recorder-1',
    teamSide: 'tracked',
    offender: { kind: 'player', playerId: 'player-1' },
    class: 'personal',
    context: 'common',
    occurredAt: `2026-08-08T12:${String(index + 1).padStart(2, '0')}:00.000Z`,
    eventIds: [id(300 + index), id(400 + index)],
    captureCommandId: id(500 + index),
    ...overrides,
  })
}

function oneAndOneState(teamFoulCount = 4): GameState {
  let state = startedState({ hasOneAndOne: true, doubleBonusThreshold: 10 })
  for (let index = 0; index < teamFoulCount; index += 1) {
    const foul = captureFoul(state, 2 + index, { offender: { kind: 'team' } })
    if (!foul.ok) throw new Error(foul.message)
    state = foul.state
  }
  return state
}

describe('BKE-2C1 Basketball foul and free-throw commands', () => {
  it('atomically records a structured foul and awarded trip, then projects stable attempts', () => {
    const captured = captureFoul(startedState(), 1, {
      drawnBy: { kind: 'player', playerId: 'opponent-9' },
      context: 'shooting',
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    expect(captured.ok).toBe(true)
    if (!captured.ok || !captured.tripEventId) return
    expect(captured.state.players.find(candidate => candidate.id === 'player-1')?.stats.pf).toBe(1)
    expect(captured.state.players.find(candidate => candidate.id === TEAM_PLAYER_HOME_ID)?.stats)
      .toMatchObject({ team_foul_p1: 1 })
    expect(captured.state.eventStream?.events.slice(-2)).toMatchObject([
      {
        eventType: 'basketball.foul',
        teamSide: 'tracked',
        actors: [
          { role: 'committed_by', kind: 'player', playerId: 'player-1' },
          { role: 'drawn_by', kind: 'player', playerId: 'opponent-9' },
        ],
        payload: { captureCommandId: id(501) },
      },
      {
        eventType: 'basketball.free_throw_trip',
        teamSide: 'opponent',
        payload: { sourceFoulEventId: id(301), captureCommandId: id(501) },
      },
    ])
    expect(basketballFreeThrowTripStatuses(captured.state)).toMatchObject([{
      eventId: captured.tripEventId,
      attempts: [],
      nextAttemptNumber: 1,
      open: true,
      closedReason: null,
    }])

    const first = captureBasketballFreeThrowAttempt(captured.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      occurredAt: '2026-08-08T12:03:00.000Z',
      eventId: id(601),
    })
    expect(first).toMatchObject({ ok: true, attemptNumber: 1, tripComplete: false })
    if (!first.ok) return
    expect(basketballFreeThrowTripStatuses(first.state)).toMatchObject([{
      eventId: captured.tripEventId,
      attempts: [{ attemptNumber: 1, made: true, deleted: false, shooterPlayerId: 'opponent-9' }],
      nextAttemptNumber: 2,
      open: true,
    }])
    const second = captureBasketballFreeThrowAttempt(first.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: false,
      occurredAt: '2026-08-08T12:04:00.000Z',
      eventId: id(602),
    })
    expect(second).toMatchObject({ ok: true, attemptNumber: 2, tripComplete: true })
    if (!second.ok) return
    expect(second.state.players.find(candidate => candidate.id === 'opponent-9')?.stats)
      .toMatchObject({ ft: 1, ft_miss: 1 })
    expect(second.state.opponentScore).toBe(1)
    expect(second.state.shotChart).toHaveLength(0)
    expect(basketballFreeThrowTripStatuses(second.state)[0]).toMatchObject({
      nextAttemptNumber: null,
      open: false,
      closedReason: 'positions_complete',
    })
  })

  it('closes a one-and-one after a first miss and preserves the rejected state', () => {
    const captured = captureFoul(oneAndOneState(), 6, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: true,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!captured.ok || !captured.tripEventId) throw new Error('Trip fixture failed.')
    const first = captureBasketballFreeThrowAttempt(captured.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: false,
      eventId: id(610),
    })
    expect(first).toMatchObject({ ok: true, attemptNumber: 1, tripComplete: true })
    if (!first.ok) return
    expect(previewBasketballDirectDecrement(first.state, 'opponent-9', 'ft_miss'))
      .toMatchObject({
        ok: true,
        value: {
          consumesFreeThrowTripPosition: true,
          requiresConfirmation: true,
        },
      })
    expect(captureBasketballFreeThrowAttempt(first.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
    })).toMatchObject({
      ok: false,
      state: first.state,
      code: 'command_failed',
    })
    const removed = decrementBasketballDirectStat(first.state, 'opponent-9', 'ft_miss')
    if (!removed.ok) throw new Error(removed.message)
    expect(basketballFreeThrowTripStatuses(removed.state)[0]).toMatchObject({
      attempts: [{ attemptNumber: 1, made: false, deleted: true }],
      nextAttemptNumber: null,
      open: false,
      closedReason: 'first_attempt_ended',
    })
    expect(captureBasketballFreeThrowAttempt(removed.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
    })).toMatchObject({ ok: false, state: removed.state, code: 'command_failed' })
  })

  it('does not allow a bonus attempt after deleting a made one-and-one first attempt', () => {
    const captured = captureFoul(oneAndOneState(), 6, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: true,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!captured.ok || !captured.tripEventId) throw new Error('Trip fixture failed.')
    const first = captureBasketballFreeThrowAttempt(captured.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      eventId: id(611),
    })
    if (!first.ok) throw new Error(first.message)
    const removed = decrementBasketballDirectStat(first.state, 'opponent-9', 'ft')
    if (!removed.ok) throw new Error(removed.message)
    expect(captureBasketballFreeThrowAttempt(removed.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
    })).toMatchObject({ ok: false, state: removed.state, code: 'command_failed' })
  })

  it('supports one- and three-attempt trips and rejects exhausted awards', () => {
    for (const [caseIndex, maximumAttempts] of ([1, 3] as const).entries()) {
      const captured = captureFoul(startedState(), 31 + caseIndex, {
        class: maximumAttempts === 1 ? 'technical' : 'personal',
        context: maximumAttempts === 1 ? 'administrative' : 'shooting',
        freeThrows: {
          maximumAttempts,
          oneAndOne: false,
          technical: maximumAttempts === 1,
          possessionRetained: maximumAttempts === 1,
        },
      })
      if (!captured.ok || !captured.tripEventId) throw new Error('Trip fixture failed.')
      let current = captured.state
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        const result = captureBasketballFreeThrowAttempt(current, {
          recorderUserId: 'recorder-1',
          tripEventId: captured.tripEventId,
          shooterPlayerId: 'opponent-9',
          made: attempt % 2 === 1,
          occurredAt: `2026-08-08T12:${40 + caseIndex * 5 + attempt}:00.000Z`,
          eventId: id(650 + caseIndex * 10 + attempt),
        })
        expect(result).toMatchObject({
          ok: true,
          attemptNumber: attempt,
          tripComplete: attempt === maximumAttempts,
        })
        if (!result.ok) throw new Error(result.message)
        current = result.state
      }
      expect(captureBasketballFreeThrowAttempt(current, {
        recorderUserId: 'recorder-1',
        tripEventId: captured.tripEventId,
        shooterPlayerId: 'opponent-9',
        made: true,
      })).toMatchObject({ ok: false, state: current, code: 'command_failed' })
    }
  })

  it('accepts every foul class/context and player, team, staff, and unknown actors', () => {
    const classes: BasketballFoulCaptureOptions['class'][] = [
      'personal',
      'technical',
      'flagrant',
      'intentional',
      'double',
    ]
    const contexts: BasketballFoulCaptureOptions['context'][] = [
      'common',
      'shooting',
      'offensive',
      'loose_ball',
      'away_from_play',
      'administrative',
    ]
    let state = startedState()
    for (const [index, value] of [...classes, ...contexts].entries()) {
      const result = captureFoul(state, 40 + index, {
        offender: index % 2 === 0
          ? { kind: 'team' }
          : { kind: 'staff', label: 'Bench coach' },
        class: index < classes.length ? value as BasketballFoulCaptureOptions['class'] : 'technical',
        context: index < classes.length ? 'common' : value as BasketballFoulCaptureOptions['context'],
        drawnBy: index === 0 ? { kind: 'unknown', label: 'Unknown opponent' } : null,
        countingOverride: index === 1
          ? {
              personalFoul: false,
              teamFoul: true,
              technical: true,
              reason: 'Bench technical',
            }
          : null,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.message)
      state = result.state
    }
  })

  it('does not reuse a tombstoned attempt position', () => {
    const captured = captureFoul(startedState(), 3, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!captured.ok || !captured.tripEventId) throw new Error('Trip fixture failed.')
    const first = captureBasketballFreeThrowAttempt(captured.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      eventId: id(620),
    })
    if (!first.ok) throw new Error(first.message)
    const removed = decrementBasketballDirectStat(first.state, 'opponent-9', 'ft')
    if (!removed.ok) throw new Error(removed.message)
    const next = captureBasketballFreeThrowAttempt(removed.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      eventId: id(621),
    })
    expect(next).toMatchObject({ ok: true, attemptNumber: 2, tripComplete: true })
  })

  it('rejects wrong-side actors, invalid overrides, offensive control, breaks, and cloud games', () => {
    const state = startedState()
    expect(captureFoul(state, 4, {
      drawnBy: { kind: 'player', playerId: 'player-2' },
    })).toMatchObject({ ok: false, state, code: 'invalid_actor' })
    expect(captureFoul(state, 5, {
      countingOverride: {
        personalFoul: false,
        teamFoul: false,
        technical: true,
        reason: '   ',
      },
    })).toMatchObject({ ok: false, state, code: 'command_failed' })
    expect(captureFoul(state, 6, {
      context: 'offensive',
      teamControlSide: 'opponent',
    })).toMatchObject({ ok: false, state, code: 'command_failed' })
    expect(captureFoul(state, 9, {
      context: 'offensive',
      teamControlSide: null,
    })).toMatchObject({ ok: true })
    expect(captureFoul(state, 10, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: true,
        technical: false,
        possessionRetained: false,
      },
    })).toMatchObject({ ok: false, state, code: 'command_failed' })
    expect(captureFoul(state, 11, {
      freeThrows: {
        maximumAttempts: 1,
        oneAndOne: false,
        technical: true,
        possessionRetained: true,
      },
    })).toMatchObject({ ok: false, state, code: 'command_failed' })
    const supportedOneAndOneState = startedState({ hasOneAndOne: true, doubleBonusThreshold: 10 })
    expect(captureFoul(supportedOneAndOneState, 12, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: true,
        technical: false,
        possessionRetained: false,
      },
    })).toMatchObject({ ok: false, state: supportedOneAndOneState, code: 'command_failed' })
    const bonusState = oneAndOneState(5)
    expect(captureFoul(bonusState, 13, {
      offender: { kind: 'team' },
      countingOverride: {
        personalFoul: false,
        teamFoul: false,
        technical: false,
        reason: 'Does not count toward the bonus',
      },
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: true,
        technical: false,
        possessionRetained: false,
      },
    })).toMatchObject({ ok: false, state: bonusState, code: 'command_failed' })

    const ended = endBasketballPeriod(state, {
      recorderUserId: 'recorder-1',
      eventId: id(630),
    })
    if (!ended.ok) throw new Error(ended.message)
    expect(captureFoul(ended.state, 7)).toMatchObject({
      ok: false,
      state: ended.state,
      code: 'invalid_period',
    })
    const cloud = {
      ...state,
      cloudSync: { ...state.cloudSync, gameId: 'game-1', gameStatus: 'final' as const },
    }
    expect(captureFoul(cloud, 8)).toMatchObject({
      ok: false,
      state: cloud,
      code: 'cloud_flow_unsupported',
    })
  })
})

describe('BKE-2C1 Basketball foul and trip corrections', () => {
  it('removes a consequential foul, unlinks dependents, and restores the exact batch', () => {
    let state = startedState()
    for (let index = 1; index <= 4; index += 1) {
      const result = captureFoul(state, 10 + index)
      if (!result.ok) throw new Error(result.message)
      state = result.state
    }
    for (let index = 0; index < 5; index += 1) {
      const result = captureFoul(state, 50 + index, {
        offender: { kind: 'player', playerId: 'player-2' },
        countingOverride: {
          personalFoul: true,
          teamFoul: false,
          technical: false,
          reason: 'Personal-only fixture',
        },
      })
      if (!result.ok) throw new Error(result.message)
      state = result.state
    }
    const fifth = captureFoul(state, 15, {
      freeThrows: {
        maximumAttempts: 1,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!fifth.ok || !fifth.tripEventId || !fifth.foulEventId) throw new Error('Fifth foul failed.')
    state = fifth.state

    const context = getBasketballCommandContext(state, 'recorder-1', '2026-08-08T12:20:00.000Z')
    if (!context.ok) throw new Error(context.message)
    const participant = Object.values(context.value.sportState.projection.participants)
      .find(candidate => candidate.playerId === 'player-1')
    if (!participant) throw new Error('Participant fixture missing.')
    const subject = basketballActorForSelection(
      state,
      'subject',
      'tracked',
      { kind: 'participant', participantId: participant.participantId },
      { allowUnavailable: true }
    )
    if (!subject.ok) throw new Error(subject.message)
    const otherParticipant = Object.values(context.value.sportState.projection.participants)
      .find(candidate => candidate.playerId === 'player-2')
    if (!otherParticipant) throw new Error('Other participant fixture missing.')
    const otherSubject = basketballActorForSelection(
      state,
      'subject',
      'tracked',
      { kind: 'participant', participantId: otherParticipant.participantId },
      { allowUnavailable: true }
    )
    if (!otherSubject.ok) throw new Error(otherSubject.message)
    const ejection = createBasketballAdministrativeEvent({
      id: id(700),
      eventType: 'basketball.ejection',
      payload: {
        reason: 'Official ruling',
        source: 'official_ruling',
        relatedFoulEventId: fifth.foulEventId,
        captureCommandId: null,
      },
      recorderUserId: 'recorder-1',
      sequence: context.value.nextSequence,
      period: context.value.period,
      occurredAt: context.value.occurredAt,
      teamSide: 'tracked',
      actors: [subject.value],
    })
    const automaticEjection = createBasketballAdministrativeEvent({
      id: id(701),
      eventType: 'basketball.ejection',
      payload: {
        reason: 'Automatic threshold',
        source: 'automatic_threshold',
        relatedFoulEventId: fifth.foulEventId,
        captureCommandId: null,
      },
      recorderUserId: 'recorder-1',
      sequence: context.value.nextSequence + 1,
      period: context.value.period,
      occurredAt: context.value.occurredAt,
      teamSide: 'tracked',
      actors: [subject.value],
    })
    const staleAutomaticEjection = createBasketballAdministrativeEvent({
      id: id(702),
      eventType: 'basketball.ejection',
      payload: {
        reason: 'Threshold on another participant',
        source: 'automatic_threshold',
        relatedFoulEventId: fifth.foulEventId,
        captureCommandId: null,
      },
      recorderUserId: 'recorder-1',
      sequence: context.value.nextSequence + 2,
      period: context.value.period,
      occurredAt: context.value.occurredAt,
      teamSide: 'tracked',
      actors: [otherSubject.value],
    })
    const appended = addGameEvents(
      state,
      [ejection, automaticEjection, staleAutomaticEjection],
      gameEventRegistry,
      gameEventProjectors
    )
    if (!appended.ok || !appended.inspection.complete) throw new Error('Ejection fixtures failed.')
    state = appended.state

    expect(previewBasketballFoulDecrement(state, { kind: 'player', playerId: 'player-1' }))
      .toMatchObject({
        ok: true,
        value: {
          targetEventId: fifth.foulEventId,
          removesPersonalFoul: true,
          removesTeamFoul: true,
          unlinkedTripCount: 1,
          unlinkedEjectionCount: 2,
          removedAutomaticEjectionCount: 1,
          clearsDisqualification: true,
          bonusStatusBefore: 'double_bonus',
          bonusStatusAfter: 'none',
        },
      })
    expect(canDecrementBasketballFoul(state, { kind: 'player', playerId: 'player-1' })).toBe(true)
    const removed = decrementBasketballFoul(
      state,
      { kind: 'player', playerId: 'player-1' },
      '2026-08-08T12:21:00.000Z'
    )
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.state.players.find(candidate => candidate.id === 'player-1')?.stats.pf).toBe(4)
    expect(removed.state.sportGameState?.sportId === 'basketball'
      ? removed.state.sportGameState.projection.participants[participant.participantId].disqualified
      : true).toBe(false)
    expect(removed.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === fifth.tripEventId
    )).toMatchObject({ payload: { sourceFoulEventId: null } })
    expect(removed.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === ejection.id
    )).toMatchObject({ payload: { relatedFoulEventId: null } })
    expect(removed.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === automaticEjection.id
    )).toMatchObject({ deletedAt: '2026-08-08T12:21:00.000Z' })
    expect(removed.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === staleAutomaticEjection.id
    )).toMatchObject({ deletedAt: null, payload: { relatedFoulEventId: null } })

    const restored = restoreLastBasketballCourtUndo(removed.state, '2026-08-08T12:22:00.000Z')
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.players.find(candidate => candidate.id === 'player-1')?.stats.pf).toBe(5)
    expect(restored.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === fifth.tripEventId
    )).toMatchObject({ payload: { sourceFoulEventId: fifth.foulEventId } })
    expect(restored.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === ejection.id
    )).toMatchObject({ payload: { relatedFoulEventId: fifth.foulEventId } })
    expect(restored.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === automaticEjection.id
    )).toMatchObject({
      deletedAt: null,
      payload: { source: 'automatic_threshold', relatedFoulEventId: fifth.foulEventId },
    })
    expect(restored.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event && event.id === staleAutomaticEjection.id
    )).toMatchObject({
      deletedAt: null,
      payload: { source: 'automatic_threshold', relatedFoulEventId: fifth.foulEventId },
    })
  })

  it('removes a trip without changing free-throw totals and restores stable positions', () => {
    const captured = captureFoul(startedState(), 20, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!captured.ok || !captured.tripEventId) throw new Error('Trip fixture failed.')
    const first = captureBasketballFreeThrowAttempt(captured.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      occurredAt: '2026-08-08T12:22:00.000Z',
      eventId: id(801),
    })
    if (!first.ok) throw new Error(first.message)
    const second = captureBasketballFreeThrowAttempt(first.state, {
      recorderUserId: 'recorder-1',
      tripEventId: captured.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: false,
      occurredAt: '2026-08-08T12:23:00.000Z',
      eventId: id(802),
    })
    if (!second.ok) throw new Error(second.message)
    expect(previewBasketballFreeThrowTripRemoval(second.state, captured.tripEventId))
      .toMatchObject({ ok: true, value: { unlinkedAttemptCount: 2 } })

    const removed = removeBasketballFreeThrowTrip(
      second.state,
      captured.tripEventId,
      '2026-08-08T12:30:00.000Z'
    )
    if (!removed.ok) throw new Error(removed.message)
    expect(removed.state.players.find(candidate => candidate.id === 'opponent-9')?.stats)
      .toMatchObject({ ft: 1, ft_miss: 1 })
    expect(removed.state.eventStream?.events.filter(event =>
      typeof event === 'object' && event && 'eventType' in event &&
      event.eventType === 'basketball.shot' && 'payload' in event
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ freeThrowTripId: null, tripAttemptNumber: null }) }),
    ]))

    const basketballState = removed.state.sportGameState?.sportId === 'basketball'
      ? removed.state.sportGameState
      : null
    if (!basketballState) throw new Error('Basketball state fixture failed.')
    const persistedReceipt = normalizeBasketballCourtUndoReceipt(
      JSON.parse(JSON.stringify(basketballState.capturePreferences.lastCourtUndo))
    )
    expect(persistedReceipt?.entries.filter(entry => entry.action === 'relink_attempt_trip'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ previousAttemptNumber: 1 }),
        expect.objectContaining({ previousAttemptNumber: 2 }),
      ]))
    const reloaded = {
      ...removed.state,
      sportGameState: {
        ...basketballState,
        capturePreferences: {
          ...basketballState.capturePreferences,
          lastCourtUndo: persistedReceipt,
        },
      },
    }
    const restored = restoreLastBasketballCourtUndo(reloaded, '2026-08-08T12:31:00.000Z')
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.eventStream?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: id(801),
        payload: expect.objectContaining({ freeThrowTripId: captured.tripEventId, tripAttemptNumber: 1 }),
      }),
      expect.objectContaining({
        id: id(802),
        payload: expect.objectContaining({ freeThrowTripId: captured.tripEventId, tripAttemptNumber: 2 }),
      }),
    ]))
  })

  it('does not cross a period boundary for foul or trip correction', () => {
    const captured = captureFoul(startedState(), 30, {
      freeThrows: {
        maximumAttempts: 1,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!captured.ok || !captured.tripEventId) throw new Error('Trip fixture failed.')
    const ended = endBasketballPeriod(captured.state, {
      recorderUserId: 'recorder-1',
      eventId: id(901),
    })
    if (!ended.ok) throw new Error(ended.message)
    const next = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      eventId: id(902),
    })
    if (!next.ok) throw new Error(next.message)
    expect(previewBasketballFoulDecrement(next.state, { kind: 'player', playerId: 'player-1' }))
      .toMatchObject({ ok: false, code: 'nothing_to_undo' })
    expect(canDecrementBasketballFoul(next.state, { kind: 'player', playerId: 'player-1' })).toBe(false)
    expect(previewBasketballFreeThrowTripRemoval(next.state, captured.tripEventId))
      .toMatchObject({ ok: false, code: 'nothing_to_undo' })
  })

  it('preserves carried overtime bonus status after removing the current overtime foul', () => {
    let state = startedState({
      periodsPerGame: 1,
      periodLabels: ['H1'],
      bonusThreshold: 1,
      doubleBonusThreshold: 2,
      hasOneAndOne: true,
      overtimeFoulsReset: false,
    })
    const regulationEnded = endBasketballPeriod(state, {
      recorderUserId: 'recorder-1',
      eventId: id(950),
    })
    if (!regulationEnded.ok) throw new Error(regulationEnded.message)
    const overtimeOne = startNextBasketballPeriod(regulationEnded.state, {
      recorderUserId: 'recorder-1',
      eventId: id(951),
    })
    if (!overtimeOne.ok) throw new Error(overtimeOne.message)
    const firstFoul = captureFoul(overtimeOne.state, 20, { offender: { kind: 'team' } })
    if (!firstFoul.ok) throw new Error(firstFoul.message)
    const overtimeOneEnded = endBasketballPeriod(firstFoul.state, {
      recorderUserId: 'recorder-1',
      eventId: id(952),
    })
    if (!overtimeOneEnded.ok) throw new Error(overtimeOneEnded.message)
    const overtimeTwo = startNextBasketballPeriod(overtimeOneEnded.state, {
      recorderUserId: 'recorder-1',
      eventId: id(953),
    })
    if (!overtimeTwo.ok) throw new Error(overtimeTwo.message)
    expect(overtimeTwo.state.sportGameState?.sportId === 'basketball'
      ? overtimeTwo.state.sportGameState.projection.bonusStatusByPeriod['overtime-2']?.tracked
      : null).toBe('one_and_one')
    state = overtimeTwo.state
    const secondFoul = captureFoul(state, 21, { offender: { kind: 'team' } })
    if (!secondFoul.ok) throw new Error(secondFoul.message)
    expect(previewBasketballFoulDecrement(secondFoul.state, {
      kind: 'team_foul',
      teamSide: 'tracked',
    })).toMatchObject({
      ok: true,
      value: {
        bonusStatusBefore: 'double_bonus',
        bonusStatusAfter: 'one_and_one',
      },
    })
  })

  it('rejects foul and trip corrections on a cloud-bound event game', () => {
    const captured = captureFoul(startedState(), 35, {
      freeThrows: {
        maximumAttempts: 1,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!captured.ok || !captured.tripEventId) throw new Error('Trip fixture failed.')
    const cloud = {
      ...captured.state,
      cloudSync: { ...captured.state.cloudSync, gameId: 'game-1', gameStatus: 'final' },
    }
    expect(previewBasketballFoulDecrement(cloud, { kind: 'player', playerId: 'player-1' }))
      .toMatchObject({ ok: false, code: 'cloud_flow_unsupported' })
    expect(decrementBasketballFoul(cloud, { kind: 'player', playerId: 'player-1' }))
      .toMatchObject({ ok: false, state: cloud, code: 'cloud_flow_unsupported' })
    expect(previewBasketballFreeThrowTripRemoval(cloud, captured.tripEventId))
      .toMatchObject({ ok: false, code: 'cloud_flow_unsupported' })
    expect(removeBasketballFreeThrowTrip(cloud, captured.tripEventId))
      .toMatchObject({ ok: false, state: cloud, code: 'cloud_flow_unsupported' })
  })
})

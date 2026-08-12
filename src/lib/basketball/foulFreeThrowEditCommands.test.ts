import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { BasketballTeamStatsConfig, GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  addBasketballLateParticipant,
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
} from './commands'
import { captureBasketballOfficialEjection } from './ejectionCommands'
import {
  applyBasketballFoulFreeThrowChange,
  buildBasketballFoulFreeThrowEditDraft,
  buildBasketballHistoricalFoulFreeThrowDraft,
  previewBasketballFoulFreeThrowEdit,
  previewBasketballHistoricalFoulFreeThrow,
} from './foulFreeThrowEditCommands'
import {
  captureBasketballFoul,
  captureBasketballFreeThrowAttempt,
  type BasketballFoulCaptureOptions,
} from './foulFreeThrowCommands'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name = id, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(overrides: Partial<BasketballTeamStatsConfig> = {}): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-12',
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
      ...overrides,
    },
  }
}

function startedState(overrides: Partial<BasketballTeamStatsConfig> = {}): GameState {
  const started = prepareBasketballGameStart(setupState(overrides), {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-12T12:00:00.000Z',
    eventId: id(1),
    participantIds: [id(101), id(102)],
  })
  if (!started.ok) throw new Error(started.message)
  const opponent = addBasketballLateParticipant(started.state, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Nine',
    number: '9',
    occurredAt: '2026-08-12T12:00:30.000Z',
    eventId: id(2),
    participantId: id(103),
    playerId: 'opponent-9',
    captureCommandId: id(3),
  })
  if (!opponent.ok) throw new Error(opponent.message)
  const opponentBackup = addBasketballLateParticipant(opponent.state, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Eight',
    number: '8',
    occurredAt: '2026-08-12T12:00:40.000Z',
    eventId: id(4),
    participantId: id(104),
    playerId: 'opponent-8',
    captureCommandId: id(5),
  })
  if (!opponentBackup.ok) throw new Error(opponentBackup.message)
  return opponentBackup.state
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
    context: 'shooting',
    occurredAt: `2026-08-12T12:${String(index).padStart(2, '0')}:00.000Z`,
    eventIds: [id(200 + index), id(300 + index)],
    captureCommandId: id(400 + index),
    ...overrides,
  })
}

function id(value: number): string {
  return `7b000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

describe('BKE-3D3 foul and free-throw event editing', () => {
  it('atomically repairs trip and ejection links made incompatible by a foul edit', () => {
    const foul = captureFoul(startedState(), 2, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!foul.ok || !foul.foulEventId || !foul.tripEventId) throw new Error('Foul fixture failed')
    const ejection = captureBasketballOfficialEjection(foul.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'player', playerId: 'player-1' },
      reason: 'Official ruling',
      relatedFoulEventId: foul.foulEventId,
      occurredAt: '2026-08-12T12:03:00.000Z',
      eventId: id(501),
    })
    if (!ejection.ok) throw new Error(ejection.message)

    const draft = buildBasketballFoulFreeThrowEditDraft(ejection.state, foul.foulEventId)
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballFoulFreeThrowEdit(ejection.state, {
      ...draft.value,
      offender: { kind: 'team' },
      foulClass: 'technical',
    }, 'recorder-1', '2026-08-12T12:04:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.value.consequenceLines).toEqual(expect.arrayContaining([
      expect.stringContaining('free-throw award'),
      expect.stringContaining('official ejection'),
    ]))
    const applied = applyBasketballFoulFreeThrowChange(ejection.state, preview.value)
    if (!applied.ok) throw new Error(applied.message)

    expect(activeEvent(applied.state, foul.tripEventId)).toMatchObject({
      payload: { sourceFoulEventId: null },
    })
    expect(activeEvent(applied.state, ejection.eventId)).toMatchObject({
      payload: { relatedFoulEventId: null },
    })
    expect(activeEvent(applied.state, foul.foulEventId)).toMatchObject({
      revision: 2,
      actors: [{ kind: 'team', role: 'committed_by' }],
      payload: { class: 'technical' },
    })
  })

  it('shrinks an award without renumbering and ungroups only incompatible attempts', () => {
    const foul = captureFoul(startedState(), 5, {
      freeThrows: {
        maximumAttempts: 3,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!foul.ok || !foul.tripEventId) throw new Error('Trip fixture failed')
    const first = captureBasketballFreeThrowAttempt(foul.state, {
      recorderUserId: 'recorder-1',
      tripEventId: foul.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      eventId: id(601),
      occurredAt: '2026-08-12T12:06:00.000Z',
    })
    if (!first.ok) throw new Error(first.message)
    const second = captureBasketballFreeThrowAttempt(first.state, {
      recorderUserId: 'recorder-1',
      tripEventId: foul.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: false,
      eventId: id(602),
      occurredAt: '2026-08-12T12:07:00.000Z',
    })
    if (!second.ok) throw new Error(second.message)

    const draft = buildBasketballFoulFreeThrowEditDraft(second.state, foul.tripEventId)
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballFoulFreeThrowEdit(second.state, {
      ...draft.value,
      maximumAttempts: 1,
    }, 'recorder-1', '2026-08-12T12:08:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballFoulFreeThrowChange(second.state, preview.value)
    if (!applied.ok) throw new Error(applied.message)

    expect(activeEvent(applied.state, id(601))).toMatchObject({
      payload: { freeThrowTripId: foul.tripEventId, tripAttemptNumber: 1 },
    })
    expect(activeEvent(applied.state, id(602))).toMatchObject({
      payload: { freeThrowTripId: null, tripAttemptNumber: null },
    })
  })

  it('edits attempt result and shooter, repairs a one-and-one second attempt, and rejects collisions', () => {
    let state = startedState({ hasOneAndOne: true, bonusThreshold: 2, doubleBonusThreshold: 4 })
    const firstTeamFoul = captureFoul(state, 10, { offender: { kind: 'team' }, context: 'common' })
    if (!firstTeamFoul.ok) throw new Error(firstTeamFoul.message)
    const awarded = captureFoul(firstTeamFoul.state, 11, {
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: true,
        technical: false,
        possessionRetained: false,
      },
    })
    if (!awarded.ok || !awarded.tripEventId) throw new Error('One-and-one fixture failed')
    const first = captureBasketballFreeThrowAttempt(awarded.state, {
      recorderUserId: 'recorder-1',
      tripEventId: awarded.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      eventId: id(701),
      occurredAt: '2026-08-12T12:13:00.000Z',
    })
    if (!first.ok) throw new Error(first.message)
    const second = captureBasketballFreeThrowAttempt(first.state, {
      recorderUserId: 'recorder-1',
      tripEventId: awarded.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      eventId: id(702),
      occurredAt: '2026-08-12T12:14:00.000Z',
    })
    if (!second.ok) throw new Error(second.message)
    state = second.state

    const secondDraft = buildBasketballFoulFreeThrowEditDraft(state, id(702))
    if (!secondDraft.ok) throw new Error(secondDraft.message)
    expect(previewBasketballFoulFreeThrowEdit(state, {
      ...secondDraft.value,
      tripAttemptNumber: 1,
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('consumed') })

    const firstDraft = buildBasketballFoulFreeThrowEditDraft(state, id(701))
    if (!firstDraft.ok) throw new Error(firstDraft.message)
    const preview = previewBasketballFoulFreeThrowEdit(state, {
      ...firstDraft.value,
      shooter: { kind: 'participant', participantId: id(104) },
      made: false,
    }, 'recorder-1', '2026-08-12T12:15:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballFoulFreeThrowChange(state, preview.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(activeEvent(applied.state, id(701))).toMatchObject({
      actors: [{ playerId: 'opponent-8' }],
      payload: { made: false },
    })
    expect(activeEvent(applied.state, id(702))).toMatchObject({
      payload: { freeThrowTripId: null, tripAttemptNumber: null },
    })
  })

  it('adds a recorded-later foul and linked one-and-one award to a completed period', () => {
    const base = startedState({ hasOneAndOne: true, bonusThreshold: 2, doubleBonusThreshold: 4 })
    const firstFoul = captureFoul(base, 20, { offender: { kind: 'team' }, context: 'common' })
    if (!firstFoul.ok) throw new Error(firstFoul.message)
    const ended = endBasketballPeriod(firstFoul.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-12T12:21:00.000Z',
      eventId: id(801),
    })
    if (!ended.ok) throw new Error(ended.message)
    const q2 = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-12T12:22:00.000Z',
      eventId: id(802),
    })
    if (!q2.ok || q2.state.sportGameState?.sportId !== 'basketball') throw new Error('Q2 fixture failed')
    const q1 = q2.state.sportGameState.projection.periods[0]
    const draft = buildBasketballHistoricalFoulFreeThrowDraft(q2.state, 'basketball.foul')
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballHistoricalFoulFreeThrow(q2.state, {
      ...draft.value,
      eventId: id(803),
      newTripEventId: id(804),
      period: { id: q1.id, order: q1.order },
      offender: { kind: 'team' },
      addLinkedTrip: true,
      maximumAttempts: 2,
      oneAndOne: true,
      technical: false,
    }, 'recorder-1', '2026-08-12T12:23:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballFoulFreeThrowChange(q2.state, preview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Historical add failed')

    expect(applied.state.sportGameState.projection.periodTeamFouls[q1.id].tracked).toBe(2)
    expect(activeEvent(applied.state, id(804))).toMatchObject({
      period: { id: q1.id },
      teamSide: 'opponent',
      payload: { sourceFoulEventId: id(803), oneAndOne: true },
    })
  })

  it('adds standalone awards and grouped attempts through the historical editor path', () => {
    const base = startedState()
    const tripDraft = buildBasketballHistoricalFoulFreeThrowDraft(base, 'basketball.free_throw_trip')
    if (!tripDraft.ok) throw new Error(tripDraft.message)
    const tripPreview = previewBasketballHistoricalFoulFreeThrow(base, {
      ...tripDraft.value,
      eventId: id(850),
      teamSide: 'tracked',
      maximumAttempts: 2,
      sourceFoulEventId: null,
    }, 'recorder-1', '2026-08-12T12:25:00.000Z')
    if (!tripPreview.ok) throw new Error(tripPreview.message)
    const tripApplied = applyBasketballFoulFreeThrowChange(base, tripPreview.value)
    if (!tripApplied.ok) throw new Error(tripApplied.message)

    const attemptDraft = buildBasketballHistoricalFoulFreeThrowDraft(
      tripApplied.state,
      'basketball.free_throw_attempt'
    )
    if (!attemptDraft.ok) throw new Error(attemptDraft.message)
    const attemptPreview = previewBasketballHistoricalFoulFreeThrow(tripApplied.state, {
      ...attemptDraft.value,
      eventId: id(851),
      freeThrowTripId: id(850),
      tripAttemptNumber: 1,
      made: true,
    }, 'recorder-1', '2026-08-12T12:26:00.000Z')
    if (!attemptPreview.ok) throw new Error(attemptPreview.message)
    const applied = applyBasketballFoulFreeThrowChange(tripApplied.state, attemptPreview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Attempt add failed')

    expect(activeEvent(applied.state, id(850))).toMatchObject({ payload: { sourceFoulEventId: null } })
    expect(activeEvent(applied.state, id(851))).toMatchObject({
      payload: { freeThrowTripId: id(850), tripAttemptNumber: 1, made: true },
    })
    expect(applied.state.sportGameState.projection.score.tracked).toBe(1)
  })

  it('rejects stale previews and terminal or cloud-bound editing', () => {
    const foul = captureFoul(startedState(), 30)
    if (!foul.ok || !foul.foulEventId) throw new Error('Foul fixture failed')
    const draft = buildBasketballFoulFreeThrowEditDraft(foul.state, foul.foulEventId)
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballFoulFreeThrowEdit(foul.state, {
      ...draft.value,
      foulContext: 'loose_ball',
    }, 'recorder-1')
    if (!preview.ok) throw new Error(preview.message)
    const changed = captureFoul(foul.state, 31, { offender: { kind: 'team' } })
    if (!changed.ok) throw new Error(changed.message)
    expect(applyBasketballFoulFreeThrowChange(changed.state, preview.value)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Timeline changed'),
    })
    expect(buildBasketballFoulFreeThrowEditDraft({
      ...foul.state,
      cloudSync: { ...foul.state.cloudSync, gameId: 'cloud-game' },
    }, foul.foulEventId)).toMatchObject({ ok: false, code: 'cloud_flow_unsupported' })
  })
})

function activeEvent(state: GameState, eventId: string) {
  return state.eventStream?.events.find(event =>
    isGameEventEnvelope(event) && event.id === eventId && event.deletedAt === null
  )
}

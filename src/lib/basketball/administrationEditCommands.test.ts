import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { BasketballTeamStatsConfig, GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  applyBasketballAdministrationChange,
  basketballEjectionFoulOptions,
  basketballEjectionParticipantOptions,
  buildBasketballAdministrationEditDraft,
  buildBasketballHistoricalAdministrationDraft,
  previewBasketballAdministrationEdit,
  previewBasketballHistoricalAdministration,
} from './administrationEditCommands'
import {
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
  suspendBasketballMatch,
} from './commands'
import { captureBasketballOfficialEjection } from './ejectionCommands'
import { captureBasketballFoul } from './foulFreeThrowCommands'
import { captureBasketballTimeout } from './timeoutCommands'

const basketball = sports.find(sport => sport.id === 'basketball')!

function id(value: number): string {
  return `7c000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

function player(playerId: string, name: string, number = ''): Player {
  return { id: playerId, name, number, stats: {} }
}

function startedState(overrides: Partial<BasketballTeamStatsConfig> = {}): GameState {
  const initial: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-13',
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
      timeoutsPerPeriod: 2,
      timeoutsPerOvertime: 1,
      ...overrides,
    },
  }
  const started = prepareBasketballGameStart(initial, {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-13T12:00:00.000Z',
    eventId: id(1),
    participantIds: [id(101), id(102)],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

function foul(state: GameState, index: number, staff = false) {
  return captureBasketballFoul(state, {
    recorderUserId: 'recorder-1',
    teamSide: 'tracked',
    offender: staff
      ? { kind: 'staff', label: 'Head Coach' }
      : { kind: 'player', playerId: 'player-1' },
    class: staff ? 'technical' : 'personal',
    context: staff ? 'administrative' : 'common',
    occurredAt: `2026-08-13T12:${String(index).padStart(2, '0')}:00.000Z`,
    eventIds: [id(200 + index), id(300 + index)],
    captureCommandId: id(400 + index),
  })
}

describe('BKE-3D4 Basketball administration editing', () => {
  it('edits an official player ejection into a reasoned staff ruling and clears attribution', () => {
    const recordedFoul = foul(startedState(), 2)
    if (!recordedFoul.ok || !recordedFoul.foulEventId) throw new Error('Foul fixture failed')
    const ejection = captureBasketballOfficialEjection(recordedFoul.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'player', playerId: 'player-1' },
      reason: 'Initial ruling',
      relatedFoulEventId: recordedFoul.foulEventId,
      occurredAt: '2026-08-13T12:03:00.000Z',
      eventId: id(501),
    })
    if (!ejection.ok) throw new Error(ejection.message)

    const draft = buildBasketballAdministrationEditDraft(ejection.state, ejection.eventId)
    if (!draft.ok) throw new Error(draft.message)
    expect(basketballEjectionFoulOptions(ejection.state, {
      eventId: draft.value.eventId,
      periodId: draft.value.period.id,
      teamSide: 'tracked',
      subject: draft.value.subject,
    }).map(option => option.eventId)).toContain(recordedFoul.foulEventId)

    const preview = previewBasketballAdministrationEdit(ejection.state, {
      ...draft.value,
      subject: { kind: 'staff', label: 'Assistant Coach' },
      reason: 'Bench conduct',
      relatedFoulEventId: null,
    }, 'recorder-1', '2026-08-13T12:04:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballAdministrationChange(ejection.state, preview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Edit failed')

    expect(activeEvent(applied.state, ejection.eventId)).toMatchObject({
      revision: 2,
      actors: [{ kind: 'staff', label: 'Assistant Coach' }],
      payload: { reason: 'Bench conduct', relatedFoulEventId: null },
    })
    expect(Object.values(applied.state.sportGameState.projection.participants)
      .find(participant => participant.playerId === 'player-1')?.ejected).toBe(false)
  })

  it('adds official staff and valid automatic player ejections as recorded-later events', () => {
    let state = startedState()
    for (let index = 1; index <= 5; index += 1) {
      const result = foul(state, 10 + index)
      if (!result.ok) throw new Error(result.message)
      state = result.state
    }
    const automaticDraft = buildBasketballHistoricalAdministrationDraft(state, 'basketball.ejection')
    if (!automaticDraft.ok) throw new Error(automaticDraft.message)
    const automaticPreview = previewBasketballHistoricalAdministration(state, {
      ...automaticDraft.value,
      eventId: id(520),
      subject: { kind: 'participant', participantId: id(101) },
      reason: 'Personal foul limit',
      ejectionSource: 'automatic_threshold',
    }, 'recorder-1', '2026-08-13T12:20:00.000Z')
    if (!automaticPreview.ok) throw new Error(automaticPreview.message)
    const automatic = applyBasketballAdministrationChange(state, automaticPreview.value)
    if (!automatic.ok) throw new Error(automatic.message)

    const staffDraft = buildBasketballHistoricalAdministrationDraft(automatic.state, 'basketball.ejection')
    if (!staffDraft.ok) throw new Error(staffDraft.message)
    const staffPreview = previewBasketballHistoricalAdministration(automatic.state, {
      ...staffDraft.value,
      eventId: id(521),
      subject: { kind: 'staff', label: 'Head Coach' },
      reason: 'Second technical',
      ejectionSource: 'official_ruling',
    }, 'recorder-1', '2026-08-13T12:21:00.000Z')
    if (!staffPreview.ok) throw new Error(staffPreview.message)
    const staff = applyBasketballAdministrationChange(automatic.state, staffPreview.value)
    if (!staff.ok) throw new Error(staff.message)

    expect(activeEvent(staff.state, id(520))).toMatchObject({ payload: { source: 'automatic_threshold' } })
    expect(activeEvent(staff.state, id(521))).toMatchObject({ actors: [{ kind: 'staff', label: 'Head Coach' }] })
  })

  it('links staff ejections to matching fouls regardless of label casing or padding', () => {
    const recordedFoul = foul(startedState(), 22, true)
    if (!recordedFoul.ok || !recordedFoul.foulEventId) throw new Error('Staff foul fixture failed')
    const draft = buildBasketballHistoricalAdministrationDraft(recordedFoul.state, 'basketball.ejection')
    if (!draft.ok) throw new Error(draft.message)
    const changedSubject = { kind: 'staff' as const, label: '  head coach  ' }

    expect(basketballEjectionFoulOptions(recordedFoul.state, {
      eventId: draft.value.eventId,
      periodId: draft.value.period.id,
      teamSide: 'tracked',
      subject: changedSubject,
    }).map(option => option.eventId)).toContain(recordedFoul.foulEventId)

    const preview = previewBasketballHistoricalAdministration(recordedFoul.state, {
      ...draft.value,
      eventId: id(522),
      subject: changedSubject,
      reason: 'Second technical',
      relatedFoulEventId: recordedFoul.foulEventId,
    }, 'recorder-1', '2026-08-13T12:23:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballAdministrationChange(recordedFoul.state, preview.value)
    if (!applied.ok) throw new Error(applied.message)

    expect(activeEvent(applied.state, id(522))).toMatchObject({
      actors: [{ kind: 'staff', label: 'head coach' }],
      payload: { relatedFoulEventId: recordedFoul.foulEventId },
    })
  })

  it('edits charged timeouts without double-counting their slot and rejects exhausted additions', () => {
    const first = captureBasketballTimeout(startedState({ timeoutsPerPeriod: 1 }), {
      recorderUserId: 'recorder-1',
      timeout: { mode: 'charged', teamSide: 'tracked', kind: 'full' },
      occurredAt: '2026-08-13T12:02:00.000Z',
      eventId: id(601),
    })
    if (!first.ok) throw new Error(first.message)
    const editDraft = buildBasketballAdministrationEditDraft(first.state, first.eventId)
    if (!editDraft.ok) throw new Error(editDraft.message)
    const editPreview = previewBasketballAdministrationEdit(first.state, {
      ...editDraft.value,
      timeoutKind: 'thirty_second',
    }, 'recorder-1', '2026-08-13T12:03:00.000Z')
    if (!editPreview.ok) throw new Error(editPreview.message)
    const edited = applyBasketballAdministrationChange(first.state, editPreview.value)
    if (!edited.ok) throw new Error(edited.message)
    expect(activeEvent(edited.state, id(601))).toMatchObject({
      payload: { kind: 'thirty_second', chargedSide: 'tracked', label: '30-second timeout' },
    })

    const addDraft = buildBasketballHistoricalAdministrationDraft(edited.state, 'basketball.timeout')
    if (!addDraft.ok) throw new Error(addDraft.message)
    expect(previewBasketballHistoricalAdministration(edited.state, {
      ...addDraft.value,
      eventId: id(602),
      teamSide: 'tracked',
      timeoutKind: 'full',
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('exhausted') })
  })

  it('adds neutral and prior-period charged timeouts without mixing inventory', () => {
    const ended = endBasketballPeriod(startedState({ timeoutsPerPeriod: 2 }), {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-13T12:30:00.000Z',
      eventId: id(701),
    })
    if (!ended.ok) throw new Error(ended.message)
    if (ended.state.sportGameState?.sportId !== 'basketball') throw new Error('Period-break fixture failed')
    const q1 = ended.state.sportGameState.projection.periods[0]
    const draft = buildBasketballHistoricalAdministrationDraft(ended.state, 'basketball.timeout')
    if (!draft.ok) throw new Error(draft.message)
    const chargedPreview = previewBasketballHistoricalAdministration(ended.state, {
      ...draft.value,
      eventId: id(703),
      period: { id: q1.id, order: q1.order },
      teamSide: 'opponent',
      timeoutKind: 'full',
    }, 'recorder-1', '2026-08-13T12:32:00.000Z')
    if (!chargedPreview.ok) throw new Error(chargedPreview.message)
    const charged = applyBasketballAdministrationChange(ended.state, chargedPreview.value)
    if (!charged.ok) throw new Error(charged.message)

    const q2 = startNextBasketballPeriod(charged.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-13T12:32:30.000Z',
      eventId: id(702),
    })
    if (!q2.ok) throw new Error(q2.message)

    const neutralDraft = buildBasketballHistoricalAdministrationDraft(q2.state, 'basketball.timeout')
    if (!neutralDraft.ok) throw new Error(neutralDraft.message)
    const neutralPreview = previewBasketballHistoricalAdministration(q2.state, {
      ...neutralDraft.value,
      eventId: id(704),
      period: { id: q1.id, order: q1.order },
      teamSide: 'neutral',
      timeoutKind: 'media',
      timeoutLabel: 'Broadcast media timeout',
    }, 'recorder-1', '2026-08-13T12:33:00.000Z')
    if (!neutralPreview.ok) throw new Error(neutralPreview.message)
    const neutral = applyBasketballAdministrationChange(q2.state, neutralPreview.value)
    if (!neutral.ok || neutral.state.sportGameState?.sportId !== 'basketball') throw new Error('Neutral timeout failed')

    expect(neutral.state.sportGameState.projection.periodTimeouts[q1.id]).toMatchObject({ opponent: 1, tracked: 0 })
    expect(neutral.state.sportGameState.projection.neutralTimeouts).toBe(1)
    expect(activeEvent(neutral.state, id(704))).toMatchObject({
      teamSide: 'neutral',
      actors: [],
      payload: { kind: 'media', chargedSide: null, label: 'Broadcast media timeout' },
    })
  })

  it('rejects unresolved subjects, incompatible foul links, stale previews, and cloud editing', () => {
    const state = startedState()
    if (state.sportGameState?.sportId !== 'basketball') throw new Error('Basketball state unavailable')
    const unresolved: GameState = {
      ...state,
      sportGameState: {
        ...state.sportGameState,
        projection: {
          ...state.sportGameState.projection,
          participants: {
            ...state.sportGameState.projection.participants,
            [id(101)]: { ...state.sportGameState.projection.participants[id(101)], playerId: null },
          },
        },
      },
    }
    expect(basketballEjectionParticipantOptions(unresolved, 'tracked').map(option => option.selection))
      .not.toContainEqual({ kind: 'participant', participantId: id(101) })

    const recordedFoul = foul(state, 40)
    if (!recordedFoul.ok || !recordedFoul.foulEventId) throw new Error('Foul fixture failed')
    const draft = buildBasketballHistoricalAdministrationDraft(recordedFoul.state, 'basketball.ejection')
    if (!draft.ok) throw new Error(draft.message)
    expect(previewBasketballHistoricalAdministration(recordedFoul.state, {
      ...draft.value,
      eventId: id(801),
      subject: { kind: 'participant', participantId: id(102) },
      reason: 'Wrong subject link',
      relatedFoulEventId: recordedFoul.foulEventId,
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('same-period foul') })

    const goodPreview = previewBasketballHistoricalAdministration(recordedFoul.state, {
      ...draft.value,
      eventId: id(802),
      reason: 'Official ruling',
    }, 'recorder-1', '2026-08-13T12:42:00.000Z')
    if (!goodPreview.ok) throw new Error(goodPreview.message)
    const changed = captureBasketballTimeout(recordedFoul.state, {
      recorderUserId: 'recorder-1',
      timeout: { mode: 'neutral', kind: 'official' },
      occurredAt: '2026-08-13T12:43:00.000Z',
      eventId: id(803),
    })
    if (!changed.ok) throw new Error(changed.message)
    expect(applyBasketballAdministrationChange(changed.state, goodPreview.value)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Timeline changed'),
    })
    expect(buildBasketballHistoricalAdministrationDraft({
      ...state,
      cloudSync: { ...state.cloudSync, gameId: 'cloud-game', gameStatus: 'final' },
    }, 'basketball.timeout')).toMatchObject({ ok: false, code: 'cloud_flow_unsupported' })

    const suspended = suspendBasketballMatch(state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-13T12:44:00.000Z',
      eventId: id(804),
    })
    if (!suspended.ok) throw new Error(suspended.message)
    expect(buildBasketballHistoricalAdministrationDraft(suspended.state, 'basketball.timeout'))
      .toMatchObject({ ok: false, code: 'invalid_period' })
  })
})

function activeEvent(state: GameState, eventId: string) {
  return state.eventStream?.events.find(event =>
    isGameEventEnvelope(event) && event.id === eventId && event.deletedAt === null
  )
}

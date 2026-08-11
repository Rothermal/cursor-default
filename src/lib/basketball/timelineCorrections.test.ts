import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import type { GameEvent } from '../gameEvents/types'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  addBasketballLateParticipant,
  captureBasketballCourtEvent,
  prepareBasketballGameStart,
} from './commands'
import { captureBasketballStealTurnover } from './directCommands'
import {
  captureBasketballFoul,
  captureBasketballFreeThrowAttempt,
} from './foulFreeThrowCommands'
import {
  previewBasketballTimelineRemoval,
  previewBasketballTimelineRestore,
  removeBasketballTimelineEvents,
  restoreBasketballTimelineEvent,
} from './timelineCorrections'

const basketball = sports.find(sport => sport.id === 'basketball')!
const shotId = '75000000-0000-4000-8000-000000000201'
const assistId = '75000000-0000-4000-8000-000000000202'
const captureId = '75000000-0000-4000-8000-000000000299'

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
      date: '2026-08-10',
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
  const result = prepareBasketballGameStart(setupState(), {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-10T15:00:00.000Z',
    eventId: '75000000-0000-4000-8000-000000000001',
    participantIds: [
      '75000000-0000-4000-8000-000000000101',
      '75000000-0000-4000-8000-000000000102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function madeShotWithAssist(state = startedState()): GameState {
  const result = captureBasketballCourtEvent(state, {
    recorderUserId: 'recorder-1',
    playerId: 'player-1',
    point: { x: 0, y: 8 },
    event: { kind: 'shot', made: true, shotType: '2pt', assistPlayerId: 'player-2' },
    occurredAt: '2026-08-10T15:01:00.000Z',
    eventIds: [shotId, assistId],
    captureCommandId: captureId,
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function withOpponent(state = startedState()): GameState {
  const result = addBasketballLateParticipant(state, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Nine',
    number: '9',
    occurredAt: '2026-08-10T15:00:30.000Z',
    eventId: '75000000-0000-4000-8000-000000000151',
    participantId: '75000000-0000-4000-8000-000000000152',
    playerId: 'opponent-9',
    captureCommandId: '75000000-0000-4000-8000-000000000159',
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function event(state: GameState, eventId: string): GameEvent | undefined {
  const raw = state.eventStream?.events.find(candidate =>
    isGameEventEnvelope(candidate) && candidate.id === eventId
  )
  return isGameEventEnvelope(raw) ? raw as GameEvent : undefined
}

describe('BKE-3B Basketball Timeline corrections', () => {
  it('removes a shot with linked dependents and clears the quick-Undo receipt', () => {
    const captured = madeShotWithAssist()
    if (captured.sportGameState?.sportId !== 'basketball') throw new Error('Expected Basketball state')
    const state: GameState = {
      ...captured,
      sportGameState: {
        ...captured.sportGameState,
        capturePreferences: {
          ...captured.sportGameState.capturePreferences,
          lastCourtUndo: {
            kind: 'capture_undo',
            createdAt: '2026-08-10T15:01:30.000Z',
            entries: [],
          },
        },
      },
    }
    const preview = previewBasketballTimelineRemoval(state, shotId)

    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.affectedEventIds).toEqual(expect.arrayContaining([shotId, assistId]))
    expect(preview.value.consequenceLines).toEqual(expect.arrayContaining([
      '1 linked assist will also be removed.',
      'Tracked team score: 2 to 0.',
      'Alex One made 2-pointers: 1 to 0.',
      'Blake Two assists: 1 to 0.',
    ]))

    const removed = removeBasketballTimelineEvents(
      state,
      preview.value,
      '2026-08-10T15:02:00.000Z'
    )

    expect(removed.ok).toBe(true)
    if (!removed.ok || removed.state.sportGameState?.sportId !== 'basketball') return
    expect(event(removed.state, shotId)).toMatchObject({ deletedAt: '2026-08-10T15:02:00.000Z' })
    expect(event(removed.state, assistId)).toMatchObject({ deletedAt: '2026-08-10T15:02:00.000Z' })
    expect(removed.state.sportGameState.capturePreferences.lastCourtUndo).toBeNull()
    expect(removed.state.homeTeamScore).toBe(0)
  })

  it('removes a complete persisted capture when launched from one companion', () => {
    const state = madeShotWithAssist()
    const preview = previewBasketballTimelineRemoval(state, assistId, 'capture_group')

    expect(preview).toMatchObject({
      ok: true,
      value: {
        captureCommandId: captureId,
        affectedEventIds: expect.arrayContaining([shotId, assistId]),
      },
    })
    if (!preview.ok) return
    const removed = removeBasketballTimelineEvents(state, preview.value)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(event(removed.state, shotId)?.deletedAt).not.toBeNull()
    expect(event(removed.state, assistId)?.deletedAt).not.toBeNull()
  })

  it('restores only the selected source by default and offers compatible dependents opt-in', () => {
    const state = madeShotWithAssist()
    const removePreview = previewBasketballTimelineRemoval(state, shotId)
    if (!removePreview.ok) throw new Error(removePreview.message)
    const removed = removeBasketballTimelineEvents(state, removePreview.value)
    if (!removed.ok) throw new Error(removed.message)

    const defaultPreview = previewBasketballTimelineRestore(removed.state, shotId)
    expect(defaultPreview).toMatchObject({
      ok: true,
      value: {
        selectedDependentIds: [],
        restoreOptions: [{ eventId: assistId, label: 'Assist' }],
      },
    })
    if (!defaultPreview.ok) return
    const sourceOnly = restoreBasketballTimelineEvent(removed.state, defaultPreview.value)
    expect(sourceOnly.ok).toBe(true)
    if (!sourceOnly.ok) return
    expect(event(sourceOnly.state, shotId)?.deletedAt).toBeNull()
    expect(event(sourceOnly.state, assistId)?.deletedAt).not.toBeNull()

    const withAssistPreview = previewBasketballTimelineRestore(removed.state, shotId, [assistId])
    if (!withAssistPreview.ok) throw new Error(withAssistPreview.message)
    const restored = restoreBasketballTimelineEvent(removed.state, withAssistPreview.value)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(event(restored.state, shotId)?.deletedAt).toBeNull()
    expect(event(restored.state, assistId)?.deletedAt).toBeNull()
    expect(restored.state.homeTeamScore).toBe(2)
    expect(restored.state.players.find(candidate => candidate.id === 'player-2')?.stats.ast).toBe(1)
  })

  it('rejects a stale preview by identity after any later Timeline change', () => {
    const state = madeShotWithAssist()
    const preview = previewBasketballTimelineRemoval(state, shotId)
    if (!preview.ok) throw new Error(preview.message)
    const later = captureBasketballCourtEvent(state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 1, y: 7 },
      event: { kind: 'shot', made: false, shotType: '2pt' },
      occurredAt: '2026-08-10T15:03:00.000Z',
      eventIds: ['75000000-0000-4000-8000-000000000301'],
    })
    if (!later.ok) throw new Error(later.message)

    const rejected = removeBasketballTimelineEvents(later.state, preview.value)

    expect(rejected).toMatchObject({
      ok: false,
      state: later.state,
      message: expect.stringContaining('Timeline changed'),
    })
    expect(rejected.state).toBe(later.state)
  })

  it('keeps a steal but clears its source when an individual turnover is removed', () => {
    const captured = captureBasketballStealTurnover(startedState(), {
      recorderUserId: 'recorder-1',
      stealerPlayerId: 'player-1',
      turnoverTarget: { kind: 'team' },
      occurredAt: '2026-08-10T15:04:00.000Z',
      eventIds: [
        '75000000-0000-4000-8000-000000000401',
        '75000000-0000-4000-8000-000000000402',
      ],
      captureCommandId: '75000000-0000-4000-8000-000000000499',
    })
    if (!captured.ok) throw new Error(captured.message)
    const preview = previewBasketballTimelineRemoval(captured.state, captured.eventIds[0])
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.value.consequenceLines).toContain(
      '1 surviving steal will keep its stat and lose the turnover link.'
    )

    const removed = removeBasketballTimelineEvents(captured.state, preview.value)
    if (!removed.ok) throw new Error(removed.message)
    expect(event(removed.state, captured.eventIds[1])).toMatchObject({
      deletedAt: null,
      payload: { relatedEventId: null },
    })
    expect(removed.state.players.find(candidate => candidate.id === 'player-1')?.stats.stl).toBe(1)
  })

  it('unlinks a surviving free-throw trip when its source foul is removed', () => {
    const captured = captureBasketballFoul(startedState(), {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      offender: { kind: 'player', playerId: 'player-1' },
      class: 'personal',
      context: 'shooting',
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
      occurredAt: '2026-08-10T15:05:00.000Z',
      eventIds: [
        '75000000-0000-4000-8000-000000000501',
        '75000000-0000-4000-8000-000000000502',
      ],
      captureCommandId: '75000000-0000-4000-8000-000000000599',
    })
    if (!captured.ok || !captured.foulEventId || !captured.tripEventId) {
      throw new Error('Expected foul and trip fixture')
    }
    const preview = previewBasketballTimelineRemoval(captured.state, captured.foulEventId)
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.value.consequenceLines).toContain(
      '1 surviving free-throw trip will lose its source-foul link.'
    )

    const removed = removeBasketballTimelineEvents(captured.state, preview.value)
    if (!removed.ok) throw new Error(removed.message)
    expect(event(removed.state, captured.tripEventId)).toMatchObject({
      deletedAt: null,
      payload: { sourceFoulEventId: null },
    })
  })

  it('ungroups surviving free throws when a trip is removed and does not re-link on restore', () => {
    const foul = captureBasketballFoul(withOpponent(), {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      offender: { kind: 'player', playerId: 'player-1' },
      class: 'personal',
      context: 'shooting',
      freeThrows: {
        maximumAttempts: 2,
        oneAndOne: false,
        technical: false,
        possessionRetained: false,
      },
      occurredAt: '2026-08-10T15:06:00.000Z',
      eventIds: [
        '75000000-0000-4000-8000-000000000601',
        '75000000-0000-4000-8000-000000000602',
      ],
      captureCommandId: '75000000-0000-4000-8000-000000000699',
    })
    if (!foul.ok || !foul.tripEventId) throw new Error('Expected free-throw trip')
    const attempt = captureBasketballFreeThrowAttempt(foul.state, {
      recorderUserId: 'recorder-1',
      tripEventId: foul.tripEventId,
      shooterPlayerId: 'opponent-9',
      made: true,
      occurredAt: '2026-08-10T15:06:30.000Z',
      eventId: '75000000-0000-4000-8000-000000000603',
    })
    if (!attempt.ok) throw new Error(attempt.message)
    const preview = previewBasketballTimelineRemoval(attempt.state, foul.tripEventId)
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.value.consequenceLines).toContain(
      '1 surviving free throw will become ungrouped without renumbering other attempts.'
    )
    const removed = removeBasketballTimelineEvents(attempt.state, preview.value)
    if (!removed.ok) throw new Error(removed.message)
    expect(event(removed.state, attempt.eventIds[0])).toMatchObject({
      deletedAt: null,
      payload: { freeThrowTripId: null, tripAttemptNumber: null },
    })
    expect(removed.state.players.find(candidate => candidate.id === 'opponent-9')?.stats.ft).toBe(1)

    const restorePreview = previewBasketballTimelineRestore(removed.state, foul.tripEventId)
    if (!restorePreview.ok) throw new Error(restorePreview.message)
    const restored = restoreBasketballTimelineEvent(removed.state, restorePreview.value)
    if (!restored.ok) throw new Error(restored.message)
    expect(event(restored.state, attempt.eventIds[0])).toMatchObject({
      payload: { freeThrowTripId: null, tripAttemptNumber: null },
    })
  })

  it('allows an unused late roster addition to be removed but rejects surviving participant history', () => {
    const state = withOpponent()
    const rosterEventId = '75000000-0000-4000-8000-000000000151'
    expect(previewBasketballTimelineRemoval(state, rosterEventId).ok).toBe(true)
    const shot = captureBasketballCourtEvent(state, {
      recorderUserId: 'recorder-1',
      playerId: 'opponent-9',
      point: { x: 0, y: 6 },
      event: { kind: 'shot', made: false, shotType: '2pt' },
      occurredAt: '2026-08-10T15:07:00.000Z',
      eventIds: ['75000000-0000-4000-8000-000000000701'],
    })
    if (!shot.ok) throw new Error(shot.message)

    expect(previewBasketballTimelineRemoval(shot.state, rosterEventId)).toMatchObject({
      ok: false,
      message: expect.stringContaining('later participant history'),
    })
  })

  it('keeps lifecycle boundaries read-only', () => {
    const state = startedState()
    const periodStart = state.eventStream?.events.find(raw =>
      isGameEventEnvelope(raw) && raw.eventType === 'basketball.period_started'
    )
    const periodStartId = isGameEventEnvelope(periodStart) ? periodStart.id : null
    if (!periodStartId) throw new Error('Expected period start')

    expect(previewBasketballTimelineRemoval(state, periodStartId)).toMatchObject({
      ok: false,
      message: expect.stringContaining('read-only'),
    })
  })
})

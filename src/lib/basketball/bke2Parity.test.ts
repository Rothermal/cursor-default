import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  addBasketballLateParticipant,
  captureBasketballCourtEvent,
  endBasketballPeriod,
  prepareBasketballGameStart,
  reopenBasketballMatch,
  startNextBasketballPeriod,
  suspendBasketballMatch,
} from './commands'
import { captureBasketballDirectStat } from './directCommands'
import {
  basketballOfficialEjectionStatuses,
  captureBasketballOfficialEjection,
} from './ejectionCommands'
import { captureBasketballFoul } from './foulFreeThrowCommands'
import { basketballTimeoutInventory, captureBasketballTimeout } from './timeoutCommands'
import { buildBasketballAdministrationEditDraft } from './administrationEditCommands'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function id(value: number): string {
  return `76000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

function startedState(): GameState {
  const initial: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-09',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig: {
      periodsPerGame: 2,
      periodLabels: ['H1', 'H2'],
      bonusThreshold: 1,
      doubleBonusThreshold: 1,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: 2,
      timeoutsPerOvertime: 1,
    },
  }
  const started = prepareBasketballGameStart(initial, {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-09T18:00:00.000Z',
    eventId: id(1),
    participantIds: [id(101), id(102)],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

describe('BKE-2D complete event-tracker parity', () => {
  it('round-trips a mixed capture and lifecycle history without enabling legacy authority', () => {
    let state = startedState()
    const opponent = addBasketballLateParticipant(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'opponent',
      displayName: 'Bears Seven',
      number: '7',
      occurredAt: '2026-08-09T18:01:00.000Z',
      eventId: id(2),
      participantId: id(103),
      playerId: 'opponent-7',
      captureCommandId: id(202),
    })
    if (!opponent.ok) throw new Error(opponent.message)
    state = opponent.state

    const court = captureBasketballCourtEvent(state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt', assistPlayerId: 'player-2' },
      occurredAt: '2026-08-09T18:02:00.000Z',
      eventIds: [id(3), id(4)],
      captureCommandId: id(203),
    })
    if (!court.ok) throw new Error(court.message)
    state = court.state

    const opponentScore = captureBasketballDirectStat(state, {
      recorderUserId: 'recorder-1',
      playerId: 'opponent-7',
      statId: '2pt',
      occurredAt: '2026-08-09T18:03:00.000Z',
      eventId: id(5),
    })
    if (!opponentScore.ok) throw new Error(opponentScore.message)
    state = opponentScore.state

    const teamTurnover = captureBasketballDirectStat(state, {
      recorderUserId: 'recorder-1',
      playerId: TEAM_PLAYER_HOME_ID,
      statId: 'team_turnover',
      occurredAt: '2026-08-09T18:04:00.000Z',
      eventId: id(6),
    })
    if (!teamTurnover.ok) throw new Error(teamTurnover.message)
    state = teamTurnover.state

    const foul = captureBasketballFoul(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      offender: { kind: 'team' },
      class: 'personal',
      context: 'common',
      occurredAt: '2026-08-09T18:05:00.000Z',
      eventIds: [id(7)],
      captureCommandId: id(207),
    })
    if (!foul.ok) throw new Error(foul.message)
    state = foul.state

    const timeout = captureBasketballTimeout(state, {
      recorderUserId: 'recorder-1',
      timeout: { mode: 'charged', teamSide: 'tracked', kind: 'full' },
      occurredAt: '2026-08-09T18:06:00.000Z',
      eventId: id(8),
    })
    if (!timeout.ok) throw new Error(timeout.message)
    state = timeout.state

    const ejection = captureBasketballOfficialEjection(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'opponent',
      subject: { kind: 'staff', label: 'Assistant Coach' },
      reason: 'Official ruling',
      occurredAt: '2026-08-09T18:07:00.000Z',
      eventId: id(9),
    })
    if (!ejection.ok) throw new Error(ejection.message)
    state = ejection.state

    if (state.sportGameState?.sportId !== 'basketball') throw new Error('Basketball state missing.')
    expect(state.sportGameState.projection).toMatchObject({
      score: { tracked: 2, opponent: 2 },
      periodTeamFouls: { 'regulation-1': { tracked: 1, opponent: 0 } },
      bonusStatusByPeriod: {
        'regulation-1': { tracked: 'double_bonus', opponent: 'none' },
      },
    })
    expect(state.players.find(candidate => candidate.id === 'player-2')?.stats.ast).toBe(1)
    expect(state.players.find(candidate => candidate.id === TEAM_PLAYER_HOME_ID)?.stats.team_turnover).toBe(1)
    expect(basketballTimeoutInventory(state)?.tracked).toMatchObject({ used: 1, remaining: 1 })
    expect(basketballOfficialEjectionStatuses(state)[0]).toMatchObject({
      subjectLabel: 'Assistant Coach',
      teamSide: 'opponent',
    })
    expect(buildBasketballAdministrationEditDraft(state, timeout.eventId)).toMatchObject({
      ok: true,
      value: { eventType: 'basketball.timeout', timeoutKind: 'full' },
    })
    expect(buildBasketballAdministrationEditDraft(state, ejection.eventId)).toMatchObject({
      ok: true,
      value: { eventType: 'basketball.ejection', reason: 'Official ruling' },
    })

    const suspended = suspendBasketballMatch(state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-09T18:08:00.000Z',
      eventId: id(10),
    })
    if (!suspended.ok) throw new Error(suspended.message)
    const reopened = reopenBasketballMatch(suspended.state, {
      recorderUserId: 'recorder-1',
      reason: 'Resume after delay',
      occurredAt: '2026-08-09T18:09:00.000Z',
      eventId: id(11),
    })
    if (!reopened.ok) throw new Error(reopened.message)
    const ended = endBasketballPeriod(reopened.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-09T18:10:00.000Z',
      eventId: id(12),
    })
    if (!ended.ok) throw new Error(ended.message)
    const next = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-09T18:11:00.000Z',
      eventId: id(13),
    })
    if (!next.ok || next.state.sportGameState?.sportId !== 'basketball') {
      throw new Error(next.ok ? 'Basketball state missing.' : next.message)
    }
    expect(next.state.sportGameState.projection).toMatchObject({
      status: 'in_progress',
      currentPeriodId: 'regulation-2',
      bonusStatusByPeriod: {
        'regulation-2': { tracked: 'none', opponent: 'none' },
      },
    })
    expect(next.state.sportGameState.projection.periodTeamFouls['regulation-2'])
      .toBeUndefined()
    expect(basketballTimeoutInventory(next.state)?.tracked).toMatchObject({ used: 0, remaining: 2 })

    const persisted = JSON.parse(JSON.stringify(next.state)) as GameState
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: persisted })
    const rebuilt = rebuildGameEventProjection(hydrated, gameEventRegistry, gameEventProjectors)
    expect(rebuilt.inspection.complete).toBe(true)
    expect(rebuilt.state.sportGameState).toEqual(next.state.sportGameState)
    expect(rebuilt.state.players).toEqual(next.state.players)
    expect(rebuilt.state.shotChart).toEqual(next.state.shotChart)

    const legacyAttempt = gameReducer(rebuilt.state, {
      type: 'INCREMENT_STAT',
      playerId: 'player-1',
      statId: '2pt',
    })
    expect(legacyAttempt).toBe(rebuilt.state)
  })
})

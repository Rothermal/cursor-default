import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  captureBasketballCourtEvent,
  endBasketballPeriod,
  prepareBasketballGameStart,
} from './commands'
import {
  decrementBasketballDirectStat,
  previewBasketballDirectDecrement,
  restoreLastBasketballCourtUndo,
} from './courtCorrections'
import { captureBasketballDirectStat } from './directCommands'
import {
  basketballEjectionFoulCandidates,
  basketballOfficialEjectionStatuses,
  captureBasketballOfficialEjection,
  previewBasketballEjectionRemoval,
  removeBasketballOfficialEjection,
} from './ejectionCommands'
import { captureBasketballFoul } from './foulFreeThrowCommands'

const basketball = sports.find(sport => sport.id === 'basketball')!

function id(value: number): string {
  return `74000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

function player(playerId: string, name: string, number = ''): Player {
  return { id: playerId, name, number, stats: {} }
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
      date: '2026-08-08',
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
  const result = prepareBasketballGameStart(initial, {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-08T12:00:00.000Z',
    eventId: id(1),
    participantIds: [id(101), id(102)],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function playerFoul(state: GameState, index: number): GameState {
  const result = captureBasketballFoul(state, {
    recorderUserId: 'recorder-1',
    teamSide: 'tracked',
    offender: { kind: 'player', playerId: 'player-1' },
    class: 'personal',
    context: 'common',
    occurredAt: `2026-08-08T12:${String(index + 1).padStart(2, '0')}:00.000Z`,
    eventIds: [id(200 + index), id(300 + index)],
    captureCommandId: id(400 + index),
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('BKE-2C3 Basketball official ejections', () => {
  it('captures a reasoned player ejection and blocks every ordinary new player stat', () => {
    const existingStat = captureBasketballDirectStat(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: '2pt',
      occurredAt: '2026-08-08T12:04:00.000Z',
      eventId: id(500),
    })
    if (!existingStat.ok) throw new Error(existingStat.message)
    const captured = captureBasketballOfficialEjection(existingStat.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'player', playerId: 'player-1' },
      reason: 'Fighting',
      occurredAt: '2026-08-08T12:05:00.000Z',
      eventId: id(501),
    })

    expect(captured.ok).toBe(true)
    if (!captured.ok || captured.state.sportGameState?.sportId !== 'basketball') return
    const participant = Object.values(captured.state.sportGameState.projection.participants)
      .find(candidate => candidate.playerId === 'player-1')!
    expect(participant).toMatchObject({ ejected: true, disqualified: false })
    expect(basketballOfficialEjectionStatuses(captured.state)[0]).toMatchObject({
      eventId: id(501),
      subjectLabel: '#4 Alex One',
      reason: 'Fighting',
      removable: true,
    })
    expect(captureBasketballDirectStat(captured.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: '2pt',
      occurredAt: '2026-08-08T12:06:00.000Z',
    })).toMatchObject({ ok: false, code: 'invalid_actor', state: captured.state })
    expect(captureBasketballCourtEvent(captured.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-08T12:07:00.000Z',
    })).toMatchObject({ ok: false, code: 'invalid_actor', state: captured.state })

    expect(previewBasketballDirectDecrement(captured.state, 'player-1', '2pt')).toMatchObject({ ok: true })
    const corrected = decrementBasketballDirectStat(captured.state, 'player-1', '2pt')
    expect(corrected.ok).toBe(true)
    if (corrected.ok) {
      expect(corrected.state.players.find(candidate => candidate.id === 'player-1')?.stats['2pt']).toBe(0)
    }
  })

  it('links only a current-period foul for the same player or staff subject', () => {
    let state = playerFoul(playerFoul(startedState(), 1), 2)
    const playerCandidates = basketballEjectionFoulCandidates(state).filter(candidate =>
      candidate.subject.kind === 'player' && candidate.subject.playerId === 'player-1'
    )
    expect(playerCandidates.map(candidate => candidate.label)).toEqual([
      'Personal foul - Common - most recent',
      'Personal foul - Common - 2nd most recent',
    ])
    const playerCandidate = playerCandidates[0]
    const wrongPlayer = captureBasketballOfficialEjection(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'player', playerId: 'player-2' },
      reason: 'Official ruling',
      relatedFoulEventId: playerCandidate.eventId,
      occurredAt: '2026-08-08T12:04:00.000Z',
    })
    expect(wrongPlayer).toMatchObject({ ok: false, code: 'command_failed', state })

    const staffFoul = captureBasketballFoul(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      offender: { kind: 'staff', label: 'Head Coach' },
      class: 'technical',
      context: 'administrative',
      occurredAt: '2026-08-08T12:05:00.000Z',
      eventIds: [id(510), id(511)],
      captureCommandId: id(512),
    })
    if (!staffFoul.ok) throw new Error(staffFoul.message)
    state = staffFoul.state
    const staffCandidate = basketballEjectionFoulCandidates(state).find(candidate =>
      candidate.subject.kind === 'staff'
    )!
    const captured = captureBasketballOfficialEjection(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'staff', label: ' head coach ' },
      reason: 'Second technical',
      relatedFoulEventId: staffCandidate.eventId,
      occurredAt: '2026-08-08T12:06:00.000Z',
      eventId: id(513),
    })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return
    expect(basketballOfficialEjectionStatuses(captured.state)[0]).toMatchObject({
      subject: { kind: 'staff', label: 'head coach' },
      relatedFoulEventId: staffCandidate.eventId,
    })
  })

  it('keeps threshold disqualification distinct across official ejection removal and restore', () => {
    let state = startedState()
    for (let index = 1; index <= 5; index += 1) state = playerFoul(state, index)
    if (state.sportGameState?.sportId !== 'basketball') throw new Error('Basketball state missing.')
    let participant = Object.values(state.sportGameState.projection.participants)
      .find(candidate => candidate.playerId === 'player-1')!
    expect(participant).toMatchObject({ disqualified: true, ejected: false })

    const captured = captureBasketballOfficialEjection(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'player', playerId: 'player-1' },
      reason: 'Official escalation',
      occurredAt: '2026-08-08T12:10:00.000Z',
      eventId: id(520),
    })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return
    const preview = previewBasketballEjectionRemoval(captured.state, captured.eventId)
    expect(preview).toMatchObject({
      ok: true,
      value: { playerRemainsDisqualified: true, linkedFoulKept: false },
    })

    const removed = removeBasketballOfficialEjection(
      captured.state,
      captured.eventId,
      '2026-08-08T12:11:00.000Z'
    )
    expect(removed.ok).toBe(true)
    if (!removed.ok || removed.state.sportGameState?.sportId !== 'basketball') return
    participant = Object.values(removed.state.sportGameState.projection.participants)
      .find(candidate => candidate.playerId === 'player-1')!
    expect(participant).toMatchObject({ disqualified: true, ejected: false })

    const restored = restoreLastBasketballCourtUndo(
      structuredClone(removed.state),
      '2026-08-08T12:12:00.000Z'
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok || restored.state.sportGameState?.sportId !== 'basketball') return
    participant = Object.values(restored.state.sportGameState.projection.participants)
      .find(candidate => candidate.playerId === 'player-1')!
    expect(participant).toMatchObject({ disqualified: true, ejected: true })
  })

  it('rejects blank, duplicate, inactive-period, and cloud-bound rulings without mutation', () => {
    const state = startedState()
    expect(captureBasketballOfficialEjection(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'staff', label: 'Coach' },
      reason: '   ',
    })).toMatchObject({ ok: false, state })

    const first = captureBasketballOfficialEjection(state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'staff', label: 'Coach' },
      reason: 'Official ruling',
      occurredAt: '2026-08-08T12:05:00.000Z',
      eventId: id(530),
    })
    if (!first.ok) throw new Error(first.message)
    expect(captureBasketballOfficialEjection(first.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'staff', label: ' coach ' },
      reason: 'Duplicate',
    })).toMatchObject({ ok: false, code: 'invalid_actor', state: first.state })

    const cloud = {
      ...state,
      cloudSync: { ...state.cloudSync, gameId: 'cloud-game' },
    }
    expect(captureBasketballOfficialEjection(cloud, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'player', playerId: 'player-1' },
      reason: 'Official ruling',
    })).toMatchObject({ ok: false, code: 'cloud_flow_unsupported', state: cloud })

    const ended = endBasketballPeriod(state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-08T12:20:00.000Z',
      eventId: id(531),
    })
    if (!ended.ok) throw new Error(ended.message)
    expect(captureBasketballOfficialEjection(ended.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      subject: { kind: 'player', playerId: 'player-1' },
      reason: 'Official ruling',
    })).toMatchObject({ ok: false, code: 'invalid_period', state: ended.state })
  })
})

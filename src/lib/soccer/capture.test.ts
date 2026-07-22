import { describe, expect, it } from 'vitest'
import type { SoccerMatchEvent, SoccerProjectedParticipant } from './types'
import {
  soccerDisciplineCaptureChoice,
  soccerParticipantRoleAt,
  soccerParticipantWasOnFieldAt,
  soccerShotSourceCandidates,
} from './capture'

describe('soccer capture helpers', () => {
  it('suggests only compatible earlier restart events', () => {
    const period = { id: 'regulation-1', order: 1 }
    const events = [
      candidate('corner', 1, 'soccer.team_event', 'tracked', 500, { kind: 'corner' }),
      candidate('foul', 2, 'soccer.foul', 'opponent', 700, { restart: 'penalty' }),
      candidate('late', 3, 'soccer.foul', 'opponent', 1_500, { restart: 'penalty' }),
    ] as SoccerMatchEvent[]

    expect(soccerShotSourceCandidates(events, {
      teamSide: 'tracked', situation: 'corner_sequence', period, elapsedMs: 1_000,
    }).map(item => item.eventId)).toEqual(['corner'])
    expect(soccerShotSourceCandidates(events, {
      teamSide: 'tracked', situation: 'penalty', period, elapsedMs: 1_000,
    }).map(item => item.eventId)).toEqual(['foul'])
    expect(soccerShotSourceCandidates(events, {
      teamSide: 'opponent', situation: 'penalty', period, elapsedMs: 1_000,
    })).toEqual([])
  })

  it('rebuilds restart candidates when time, side, or the edited event changes', () => {
    const period = { id: 'regulation-1', order: 1 }
    const events = [
      candidate('early', 1, 'soccer.team_event', 'tracked', 500, { kind: 'corner' }),
      candidate('late', 2, 'soccer.team_event', 'tracked', 900, { kind: 'corner' }),
    ] as SoccerMatchEvent[]

    expect(soccerShotSourceCandidates(events, {
      teamSide: 'tracked', situation: 'corner_sequence', period, elapsedMs: 800,
    }).map(item => item.eventId)).toEqual(['early'])
    expect(soccerShotSourceCandidates(events, {
      teamSide: 'opponent', situation: 'corner_sequence', period, elapsedMs: 1_000,
    })).toEqual([])
    expect(soccerShotSourceCandidates(events, {
      teamSide: 'tracked', situation: 'corner_sequence', period, elapsedMs: 1_000, excludeEventId: 'late',
    }).map(item => item.eventId)).toEqual(['early'])
  })

  it('uses event-time availability and the latest prior role for historical actors', () => {
    const participant = projectedParticipant()

    expect(soccerParticipantWasOnFieldAt(participant, 'regulation-1', 250)).toBe(true)
    expect(soccerParticipantWasOnFieldAt(participant, 'regulation-1', 700)).toBe(false)
    expect(soccerParticipantRoleAt(
      participant,
      'regulation-1',
      700,
      { group: 'defender', label: null }
    ).group).toBe('defender')
    expect(soccerParticipantRoleAt(
      participant,
      'regulation-1',
      1_200,
      { group: 'defender', label: null }
    ).group).toBe('goalkeeper')
  })

  it('requires an immediate goalkeeper replacement for a must-leave yellow', () => {
    expect(soccerDisciplineCaptureChoice('yellow', 'must_leave_may_replace', true, 'short')).toBe('replace')
    expect(soccerDisciplineCaptureChoice('yellow', 'must_leave_may_replace', false, 'stay')).toBe('short')
    expect(soccerDisciplineCaptureChoice('yellow', 'stay_on', true, 'replace')).toBe('stay')
    expect(soccerDisciplineCaptureChoice('straight_red', 'stay_on', true, 'stay')).toBe('keeper_handoff')
  })
})

function projectedParticipant(): SoccerProjectedParticipant {
  return {
    participantId: 'player-1',
    playerId: null,
    displayName: 'Player One',
    number: '1',
    status: 'on_field',
    role: { group: 'goalkeeper', label: null },
    started: true,
    appearances: 2,
    totalActiveMs: 0,
    activeSinceElapsedMs: null,
    onFieldIntervals: [
      { periodId: 'regulation-1', startElapsedMs: 0, endElapsedMs: 500 },
      { periodId: 'regulation-1', startElapsedMs: 1_000, endElapsedMs: null },
    ],
    roleIntervals: [
      { periodId: 'regulation-1', startElapsedMs: 0, endElapsedMs: 500, role: { group: 'defender', label: null } },
      { periodId: 'regulation-1', startElapsedMs: 1_000, endElapsedMs: null, role: { group: 'goalkeeper', label: null } },
    ],
    hasExited: false,
  }
}

function candidate(id: string, sequence: number, eventType: string, teamSide: 'tracked' | 'opponent', elapsedMs: number, payload: object) {
  return {
    id,
    sportId: 'soccer',
    eventType,
    schemaVersion: 1,
    recorderUserId: null,
    sequence,
    period: { id: 'regulation-1', order: 1 },
    elapsedMs,
    occurredAt: '2026-07-21T12:00:00.000Z',
    teamSide,
    location: null,
    actors: [],
    payload,
    revision: 1,
    createdAt: '2026-07-21T12:00:00.000Z',
    updatedAt: '2026-07-21T12:00:00.000Z',
    deletedAt: null,
  }
}

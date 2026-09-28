import { describe, expect, it } from 'vitest'
import type { SoccerMatchEvent, SoccerProjectedParticipant } from './types'
import {
  soccerDisciplineCaptureChoice,
  soccerParticipantRoleAt,
  soccerParticipantWasOnFieldAt,
  soccerShotSourceCandidates,
  soccerLivePenaltyFoul,
  suggestSoccerShotSource,
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

  it('suggests the newest eligible restart for a live shot', () => {
    const period = { id: 'regulation-1', order: 1 }
    const corner = candidate('corner', 1, 'soccer.team_event', 'tracked', 10_000, { kind: 'corner' })
    const penalty = candidate('penalty', 1, 'soccer.foul', 'opponent', 10_000, { restart: 'penalty' })
    const freeKick = candidate('fk', 1, 'soccer.foul', 'opponent', 10_000, { restart: 'direct_free_kick' })
    const at = (events: object[], teamSide: 'tracked' | 'opponent' = 'tracked', elapsedMs = 20_000) =>
      suggestSoccerShotSource(events as SoccerMatchEvent[], { teamSide, period, elapsedMs })

    expect(at([corner])).toEqual({ situation: 'corner_sequence', sourceEventId: 'corner' })
    expect(at([penalty])).toEqual({ situation: 'penalty', sourceEventId: 'penalty' })
    expect(at([freeKick])).toEqual({ situation: 'direct_free_kick', sourceEventId: 'fk' })
    expect(at([corner], 'opponent')).toBeNull()
    expect(at([penalty], 'opponent')).toBeNull()
    expect(at([candidate('ifk', 1, 'soccer.foul', 'opponent', 10_000, { restart: 'indirect_free_kick' })])).toBeNull()
    expect(at([])).toBeNull()
  })

  it('drops the suggestion outside the window or once play has moved on', () => {
    const period = { id: 'regulation-1', order: 1 }
    const corner = candidate('corner', 1, 'soccer.team_event', 'tracked', 10_000, { kind: 'corner' })
    const at = (events: object[], elapsedMs = 20_000) =>
      suggestSoccerShotSource(events as SoccerMatchEvent[], { teamSide: 'tracked', period, elapsedMs })

    expect(at([corner], 70_000)).toEqual({ situation: 'corner_sequence', sourceEventId: 'corner' })
    expect(at([corner], 70_001)).toBeNull()
    expect(at([corner], 5_000)).toBeNull()
    expect(at([corner, candidate('saved', 2, 'soccer.shot', 'tracked', 12_000, { outcome: 'saved' })]))
      .toEqual({ situation: 'corner_sequence', sourceEventId: 'corner' })
    expect(at([corner, candidate('card', 2, 'soccer.card', 'opponent', 12_000, {})]))
      .toEqual({ situation: 'corner_sequence', sourceEventId: 'corner' })
    expect(at([corner, candidate('sub', 2, 'soccer.lineup_transition', 'tracked', 12_000, {})]))
      .toEqual({ situation: 'corner_sequence', sourceEventId: 'corner' })
    expect(at([corner, candidate('goal', 2, 'soccer.shot', 'tracked', 12_000, { outcome: 'goal' })])).toBeNull()
    expect(at([corner, candidate('other', 2, 'soccer.shot', 'opponent', 12_000, { outcome: 'saved' })])).toBeNull()
    expect(at([corner, candidate('tackle', 2, 'soccer.defensive_action', 'opponent', 12_000, {})])).toBeNull()
    expect(at([corner, candidate('throw', 2, 'soccer.team_event', 'tracked', 12_000, { kind: 'throw_in' })])).toBeNull()
    expect(at([{ ...corner, period: { id: 'regulation-2', order: 2 } }])).toBeNull()
  })

  it('keeps a corner through a rebound but consumes penalties and free kicks', () => {
    const period = { id: 'regulation-1', order: 1 }
    const at = (events: object[]) =>
      suggestSoccerShotSource(events as SoccerMatchEvent[], { teamSide: 'tracked', period, elapsedMs: 20_000 })
    const olderCorner = candidate('older-corner', 1, 'soccer.team_event', 'tracked', 5_000, { kind: 'corner' })

    expect(at([
      candidate('corner', 2, 'soccer.team_event', 'tracked', 10_000, { kind: 'corner' }),
      candidate('save', 3, 'soccer.shot', 'tracked', 12_000, { outcome: 'saved' }),
    ])).toEqual({ situation: 'corner_sequence', sourceEventId: 'corner' })
    expect(at([
      olderCorner,
      candidate('penalty', 2, 'soccer.foul', 'opponent', 10_000, { restart: 'penalty' }),
      candidate('kick', 3, 'soccer.shot', 'tracked', 12_000, { outcome: 'saved' }),
    ])).toBeNull()
    for (const outcome of ['blocked', 'saved']) {
      expect(at([
        olderCorner,
        candidate('fk', 2, 'soccer.foul', 'opponent', 10_000, { restart: 'direct_free_kick' }),
        candidate('free-kick', 3, 'soccer.shot', 'tracked', 12_000, { outcome }),
      ])).toBeNull()
    }
  })

  it('prompts the fouled side only for a newly appended penalty foul', () => {
    const existing = candidate('old', 1, 'soccer.foul', 'opponent', 1_000, { restart: 'penalty' })
    const penalty = candidate('penalty', 2, 'soccer.foul', 'opponent', 2_000, { restart: 'penalty' })
    const trackedFoul = candidate('tracked-penalty', 2, 'soccer.foul', 'tracked', 2_000, { restart: 'penalty' })
    const freeKick = candidate('fk', 2, 'soccer.foul', 'opponent', 2_000, { restart: 'direct_free_kick' })
    const run = (before: object[], after: object[]) =>
      soccerLivePenaltyFoul(before as SoccerMatchEvent[], after as SoccerMatchEvent[])

    expect(run([existing], [existing, penalty])).toEqual({ foulId: 'penalty', teamSide: 'tracked' })
    expect(run([], [trackedFoul])).toEqual({ foulId: 'tracked-penalty', teamSide: 'opponent' })
    expect(run([existing], [existing])).toBeNull()
    expect(run([], [freeKick])).toBeNull()
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

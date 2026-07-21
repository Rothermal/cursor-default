import { describe, expect, it } from 'vitest'
import type { SoccerMatchEvent } from './types'
import { soccerShotSourceCandidates } from './capture'

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
})

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

import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../gameEvents/types'
import { soccerRecentUndoCandidates } from './recentUndo'

function event(sequence: number, eventType: string): GameEvent {
  const timestamp = `2026-07-23T12:${String(sequence).padStart(2, '0')}:00.000Z`
  return {
    id: `event-${sequence}`,
    sportId: 'soccer',
    eventType,
    schemaVersion: 1,
    recorderUserId: 'recorder-1',
    sequence,
    period: { id: 'regulation-1', order: 1 },
    elapsedMs: sequence * 1_000,
    occurredAt: timestamp,
    teamSide: 'tracked',
    location: null,
    actors: [],
    payload: {},
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

const open = { lineupBlockedReason: null }

describe('soccer recent undo candidates', () => {
  it('lists user-recorded families newest first by recording order and stops at match control', () => {
    const events = [
      event(1, 'soccer.opening_lineup'),
      event(2, 'soccer.period_started'),
      event(3, 'soccer.clock_started'),
      event(4, 'soccer.team_event'),
      event(5, 'soccer.shot'),
      event(6, 'soccer.foul'),
    ]
    const recent = soccerRecentUndoCandidates(events, open)
    expect(recent.rows.map(row => [row.event.id, row.kind])).toEqual([
      ['event-6', 'event'],
      ['event-5', 'event'],
      ['event-4', 'event'],
      ['event-3', 'stop'],
    ])
    expect(recent.target?.id).toBe('event-6')
  })

  it('uses sequence, not match time, so a historical add is the newest', () => {
    const late = { ...event(7, 'soccer.card'), elapsedMs: 500 }
    const recent = soccerRecentUndoCandidates([event(1, 'soccer.period_started'), event(5, 'soccer.shot'), late], open)
    expect(recent.target?.id).toBe('event-7')
  })

  it('covers every included family and caps the list at five', () => {
    const families = [
      'soccer.shot', 'soccer.own_goal', 'soccer.score_adjustment', 'soccer.defensive_action',
      'soccer.foul', 'soccer.card', 'soccer.team_event', 'soccer.substitution_window',
      'soccer.lineup_transition', 'soccer.role_changed',
    ]
    const events = families.map((type, index) => event(index + 1, type))
    const recent = soccerRecentUndoCandidates(events, open)
    expect(recent.rows).toHaveLength(5)
    expect(recent.rows.every(row => row.kind === 'event')).toBe(true)
    for (const type of families) {
      expect(soccerRecentUndoCandidates([event(1, type)], open).target?.eventType).toBe(type)
    }
  })

  it('has no target when the newest event is a stop line', () => {
    for (const type of [
      'soccer.period_ended', 'soccer.clock_paused', 'soccer.clock_adjusted', 'soccer.match_rules_changed',
      'soccer.attacking_direction_changed', 'soccer.match_ended', 'soccer.match_reopened',
      'soccer.shootout_started', 'soccer.shootout_kick', 'soccer.match_roster_added',
    ]) {
      const recent = soccerRecentUndoCandidates([event(1, 'soccer.shot'), event(2, type)], open)
      expect(recent.target).toBeNull()
      expect(recent.rows).toEqual([{ event: expect.objectContaining({ eventType: type }), kind: 'stop' }])
    }
    expect(soccerRecentUndoCandidates([], open)).toEqual({ rows: [], target: null, targetBlockedReason: null })
  })

  it('blocks only lineup targets with the given reason', () => {
    const blocked = { lineupBlockedReason: 'Pause the clock to undo.' }
    expect(soccerRecentUndoCandidates([event(1, 'soccer.lineup_transition')], blocked).targetBlockedReason)
      .toBe('Pause the clock to undo.')
    expect(soccerRecentUndoCandidates([event(1, 'soccer.substitution_window')], blocked).targetBlockedReason)
      .toBe('Pause the clock to undo.')
    expect(soccerRecentUndoCandidates([event(1, 'soccer.shot')], blocked).targetBlockedReason).toBeNull()
  })
})

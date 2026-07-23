import { describe, expect, it } from 'vitest'
import {
  formatSoccerInputTime,
  isSoccerAttackingEventType,
  isSoccerScoringEvent,
  parseSoccerInputTime,
  soccerEventMatchesTimelineFilter,
  soccerEventTimeLabel,
} from './timeline'

describe('soccer timeline helpers', () => {
  it('classifies attacking vs match-control event types for Timeline filters', () => {
    expect(isSoccerAttackingEventType('soccer.shot')).toBe(true)
    expect(isSoccerAttackingEventType('soccer.own_goal')).toBe(true)
    expect(isSoccerAttackingEventType('soccer.score_adjustment')).toBe(true)
    expect(isSoccerAttackingEventType('soccer.clock_paused')).toBe(false)

    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.shot' }, 'all')).toBe(true)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.shot' }, 'attacking')).toBe(true)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.shot' }, 'match_control')).toBe(false)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.period_ended' }, 'match_control')).toBe(true)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.period_ended' }, 'attacking')).toBe(false)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.defensive_action' }, 'defensive')).toBe(true)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.foul' }, 'discipline')).toBe(true)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.card' }, 'discipline')).toBe(true)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.team_event' }, 'team_events')).toBe(true)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.foul' }, 'match_control')).toBe(false)
    expect(soccerEventMatchesTimelineFilter({ eventType: 'soccer.shootout_kick' }, 'all')).toBe(true)
  })

  it('treats only goals, own goals, and score adjustments as scoring history rows', () => {
    expect(isSoccerScoringEvent({ eventType: 'soccer.own_goal', payload: {} })).toBe(true)
    expect(isSoccerScoringEvent({
      eventType: 'soccer.score_adjustment',
      payload: { delta: 1, reason: 'Official' },
    })).toBe(true)
    expect(isSoccerScoringEvent({
      eventType: 'soccer.shot',
      payload: { outcome: 'goal', situation: 'open_play' },
    })).toBe(true)
    expect(isSoccerScoringEvent({
      eventType: 'soccer.shot',
      payload: { outcome: 'saved', situation: 'open_play' },
    })).toBe(false)
    expect(isSoccerScoringEvent({ eventType: 'soccer.clock_paused', payload: { elapsedMs: 1 } })).toBe(false)
  })

  it('renders period-local MM:SS labels and falls back when timing is missing', () => {
    const timings = [{
      period: { id: 'regulation-1', order: 1 },
      label: 'First Half',
      startElapsedMs: 0,
      endElapsedMs: 45 * 60_000,
    }]
    expect(soccerEventTimeLabel({
      elapsedMs: 65_000,
      period: { id: 'regulation-1', order: 1 },
    }, timings)).toBe('First Half · 01:05')
    expect(soccerEventTimeLabel({
      elapsedMs: 65_000,
      period: { id: 'regulation-2', order: 2 },
    }, timings)).toBe('01:05')
    expect(soccerEventTimeLabel({
      elapsedMs: null,
      period: { id: 'regulation-1', order: 1 },
    }, timings)).toBe('No match time')
    expect(soccerEventTimeLabel({
      elapsedMs: 5_000,
      period: { id: 'regulation-1', order: 1 },
    }, [{
      ...timings[0],
      startElapsedMs: 10_000,
    }])).toBe('First Half · 00:00')
  })

  it('round-trips clock input times and rejects invalid seconds', () => {
    expect(formatSoccerInputTime(65_000)).toBe('1:05')
    expect(formatSoccerInputTime(0)).toBe('0:00')
    expect(formatSoccerInputTime(3_661_000)).toBe('61:01')

    expect(parseSoccerInputTime('1:05')).toBe(65_000)
    expect(parseSoccerInputTime(' 61:01 ')).toBe(3_661_000)
    expect(parseSoccerInputTime('0:00')).toBe(0)

    expect(parseSoccerInputTime('1:60')).toBeNull()
    expect(parseSoccerInputTime('1:5')).toBeNull()
    expect(parseSoccerInputTime('abc')).toBeNull()
    expect(parseSoccerInputTime('')).toBeNull()
  })
})

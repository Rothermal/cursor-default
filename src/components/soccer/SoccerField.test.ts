import { describe, expect, it } from 'vitest'
import {
  clusterSoccerMarkerPoints,
  isSoccerLocatedEditableEvent,
  soccerFieldLocation,
  soccerFieldReviewEvents,
} from '../../lib/soccer/field'

describe('soccer field coordinates', () => {
  it('stores normalized recorder-view coordinates without a display flip', () => {
    expect(soccerFieldLocation(0.82, 0.35, false, 'left_to_right')).toEqual({
      x: 0.82,
      y: 0.35,
      attackingDirection: 'left_to_right',
    })
  })

  it('undoes a 180-degree display flip before persisting the location', () => {
    const location = soccerFieldLocation(0.18, 0.65, true, 'left_to_right')
    expect(location.x).toBeCloseTo(0.82)
    expect(location.y).toBeCloseTo(0.35)
    expect(location.attackingDirection).toBe('left_to_right')
  })

  it('clamps taps to the normalized field boundary', () => {
    expect(soccerFieldLocation(-0.2, 1.4, false, 'right_to_left')).toEqual({
      x: 0,
      y: 1,
      attackingDirection: 'right_to_left',
    })
  })

  it('filters located attacking events by side and current period', () => {
    const events = [
      candidate('shot-1', 'soccer.shot', 'tracked', 'first'),
      candidate('shot-2', 'soccer.shot', 'opponent', 'first'),
      candidate('own-1', 'soccer.own_goal', 'tracked', 'second'),
      { ...candidate('control', 'soccer.clock_paused', 'tracked', 'first'), location: null },
      { ...candidate('unlocated', 'soccer.own_goal', 'opponent', 'first'), location: null },
    ]
    expect(soccerFieldReviewEvents(events, {
      side: 'tracked',
      scope: 'current',
      periodId: 'first',
    }).map(event => event.id)).toEqual(['shot-1'])
    expect(soccerFieldReviewEvents(events, {
      side: 'opponent',
      scope: 'current',
      periodId: 'first',
    }).map(event => event.id)).toEqual(['shot-2'])
    expect(soccerFieldReviewEvents(events, {
      side: 'all',
      scope: 'match',
      periodId: 'first',
    }).map(event => event.id)).toEqual(['shot-1', 'shot-2', 'own-1'])
    expect(soccerFieldReviewEvents(events, {
      side: 'all',
      scope: 'current',
      periodId: null,
    })).toEqual([])
  })

  it('filters all SOC-4B field families independently from capture mode', () => {
    const events = [
      candidate('shot', 'soccer.shot', 'tracked', 'first'),
      candidate('defense', 'soccer.defensive_action', 'tracked', 'first'),
      candidate('foul', 'soccer.foul', 'opponent', 'first'),
      candidate('corner', 'soccer.team_event', 'tracked', 'first'),
    ]
    const base = { side: 'all' as const, scope: 'match' as const, periodId: 'first' }
    expect(soccerFieldReviewEvents(events, { ...base, family: 'shots' }).map(item => item.id)).toEqual(['shot'])
    expect(soccerFieldReviewEvents(events, { ...base, family: 'defense' }).map(item => item.id)).toEqual(['defense'])
    expect(soccerFieldReviewEvents(events, { ...base, family: 'incidents' }).map(item => item.id)).toEqual(['foul', 'corner'])
  })

  it('clusters overlapping markers without changing stored coordinates', () => {
    const points = [
      { id: 'a', x: 0.5, y: 0.5 },
      { id: 'b', x: 0.52, y: 0.51 },
      { id: 'c', x: 0.8, y: 0.8 },
    ]
    expect(clusterSoccerMarkerPoints(points).map(cluster => cluster.map(item => item.id))).toEqual([
      ['a', 'b'], ['c'],
    ])
    expect(points[0]).toEqual({ id: 'a', x: 0.5, y: 0.5 })
  })

  it('clusters deterministically regardless of marker input order', () => {
    const points = [
      { id: 'c', x: 0.8, y: 0.8 },
      { id: 'b', x: 0.52, y: 0.51 },
      { id: 'a', x: 0.5, y: 0.5 },
    ]
    expect(clusterSoccerMarkerPoints(points).map(cluster => cluster.map(item => item.id))).toEqual([
      ['a', 'b'], ['c'],
    ])
  })

  it('keeps shootout cards out of the shared normal-match editor', () => {
    expect(isSoccerLocatedEditableEvent({
      eventType: 'soccer.card',
      period: { id: 'regulation-1', order: 1 },
    })).toBe(true)
    expect(isSoccerLocatedEditableEvent({
      eventType: 'soccer.card',
      period: { id: 'shootout', order: 99 },
    })).toBe(false)
  })
})

function candidate(
  id: string,
  eventType: string,
  teamSide: 'tracked' | 'opponent',
  periodId: string
) {
  return {
    id,
    eventType,
    teamSide,
    period: { id: periodId },
    location: { x: 0.5, y: 0.5, attackingDirection: 'left_to_right' as const },
  }
}

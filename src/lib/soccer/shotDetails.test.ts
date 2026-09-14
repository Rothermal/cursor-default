import { describe, expect, it } from 'vitest'
import type { GameEventLocation, JsonObject } from '../gameEvents/types'
import { preserveSoccerShotDetails, soccerShotApproach, validateSoccerShotDetails } from './shotDetails'
import { soccerEventDefinitions, createSoccerEvent } from './events'
import { serializeGameEventForCloud, deserializeGameEventFromCloud } from '../gameEvents/cloud'

describe('shot detail readers', () => {
  it('retains own-goal details through JSON and cloud mapping without reinterpreting fields', () => {
    const event = createSoccerEvent({ eventType: 'soccer.own_goal', occurredAt: '2026-09-13T12:00:00Z',
      payload: { bodyPart: 'left_foot', goalPlacement: { x: 0.25, y: 0.75 } }, recorderUserId: 'recorder',
      sequence: 0, period: { id: 'regulation-1', order: 1 }, elapsedMs: 0,
      actors: [{ kind: 'unknown', role: 'own_goal_by', label: 'Opponent' }] })
    const serialized = serializeGameEventForCloud('game', 'recorder', JSON.parse(JSON.stringify(event)), {})
    if (!serialized.ok) throw new Error(serialized.diagnostic.message)
    const row = Object.fromEntries(Object.entries(serialized.params).map(([key, value]) => [key.slice(2), value]))
    const restored = deserializeGameEventFromCloud({ ...row, recorded_by: 'recorder' }, {})
    if (!restored.ok) throw new Error(restored.diagnostic.message)
    expect(restored.event).toEqual(event)
    const current = soccerEventDefinitions.find(d => d.eventType === restored.event.eventType)!
    const preFoundationOwnGoalRule = (payload: JsonObject) => Object.keys(payload).length === 0
    expect(current.validate(restored.event).ok).toBe(true)
    expect(preFoundationOwnGoalRule(restored.event.payload)).toBe(false)
    const legacy = { ...restored.event, payload: {} }
    expect(current.validate(legacy).ok).toBe(true)
    expect(preFoundationOwnGoalRule(legacy.payload)).toBe(true)
  })
  for (const outcome of ['goal', 'saved', 'blocked', 'off_target', 'woodwork'] as const) {
    it.each(['left_foot', 'right_foot', 'header'] as const)(`reads %s on ${outcome}`, bodyPart => {
      const event = createSoccerEvent({ eventType: 'soccer.shot', occurredAt: '2026-09-13T12:00:00Z',
        payload: { outcome, situation: 'open_play', bodyPart },
        recorderUserId: null, sequence: 0, period: { id: 'regulation-1', order: 1 }, elapsedMs: 0,
        actors: [{ kind: 'team', role: 'shooter', label: 'Team' }] })
      expect(soccerEventDefinitions.find(d => d.eventType === event.eventType)!.validate(event).ok).toBe(true)
    })
  }
  it('accepts legacy empty own goals and new details, but not unrelated keys', () => {
    const event = createSoccerEvent({ eventType: 'soccer.own_goal', occurredAt: '2026-09-13T12:00:00Z', payload: {}, recorderUserId: null,
      sequence: 0, period: { id: 'regulation-1', order: 1 }, elapsedMs: 0,
      actors: [{ kind: 'unknown', role: 'own_goal_by', label: 'Opponent' }] })
    const definition = soccerEventDefinitions.find(d => d.eventType === event.eventType)!
    expect(definition.validate(event).ok).toBe(true)
    const detailed = { ...event, payload: { bodyPart: 'header', goalPlacement: { x: 0, y: 1 } } }
    expect(definition.validate(detailed).ok).toBe(true)
    expect(definition.validate({ ...event, payload: { other: true } }).ok).toBe(false)
  })
  it.each(['scored', 'saved', 'missed', 'woodwork', 'retake', 'forfeited'])('limits shootout %s detail', outcome => {
    for (const bodyPart of ['left_foot', 'right_foot']) {
      expect(validateSoccerShotDetails('soccer.shootout_kick', { outcome, bodyPart })).toBe(true)
    }
    expect(validateSoccerShotDetails('soccer.shootout_kick', { outcome, bodyPart: 'header' })).toBe(false)
    expect(validateSoccerShotDetails('soccer.shootout_kick', { outcome, goalPlacement: { x: 0.2, y: 0.4 } })).toBe(outcome === 'scored')
  })
  it.each([null, { x: -0.1, y: 0 }, { x: 1.1, y: 0 }, { x: NaN, y: 0 },
    { x: 0, y: Infinity }, { x: '0', y: 0 }, { x: 0 }, { x: 0, y: 0, z: 0 }, []])('rejects malformed placement %j', goalPlacement => {
    expect(validateSoccerShotDetails('soccer.shot', { outcome: 'goal', goalPlacement } as JsonObject)).toBe(false)
  })
  it.each([null, 'unspecified', 'foot', 1])('rejects invalid body part %j', bodyPart => {
    expect(validateSoccerShotDetails('soccer.shot', { outcome: 'goal', bodyPart })).toBe(false)
  })
})

describe('detail preservation', () => {
  it.each(['soccer.shot', 'soccer.own_goal', 'soccer.shootout_kick'])('preserves and explicitly clears %s metadata', type => {
    const previous = { bodyPart: 'left_foot', goalPlacement: { x: 0.2, y: 0.7 } }
    const replacement: JsonObject = type === 'soccer.own_goal' ? {} : { outcome: type === 'soccer.shot' ? 'goal' : 'scored' }
    const preserved = preserveSoccerShotDetails(type, previous, replacement)
    expect(preserved).toMatchObject(previous)
    expect(preserved.goalPlacement).not.toBe(previous.goalPlacement)
    expect(preserveSoccerShotDetails(type, previous, { ...replacement, bodyPart: null, goalPlacement: null })).toEqual(replacement)
    expect(previous.goalPlacement).toEqual({ x: 0.2, y: 0.7 })
  })
  it('clears placement on a non-goal but keeps body part', () => {
    expect(preserveSoccerShotDetails('soccer.shot', { bodyPart: 'header', goalPlacement: { x: 1, y: 0 } }, { outcome: 'woodwork' }))
      .toEqual({ outcome: 'woodwork', bodyPart: 'header' })
  })
})

describe('diagram-based approach angle', () => {
  const location = (x: number, y: number, attackingDirection: GameEventLocation['attackingDirection'] = 'left_to_right') => ({ x, y, attackingDirection })
  it('uses pitch proportions and mirrors goal ends', () => {
    expect(soccerShotApproach(location(0.5, 0.5))?.degrees).toBe(0)
    expect(soccerShotApproach(location(0.5, 0))?.degrees).toBe(33)
    expect(soccerShotApproach(location(0.5, 1, 'right_to_left'))?.degrees).toBe(33)
    expect(soccerShotApproach(location(1, 0))?.degrees).toBe(90)
  })
  it('suppresses coincident, unlocated, unknown and invalid geometry', () => {
    for (const input of [null, location(1, 0.5), location(0, 0.5, 'right_to_left'),
      location(0.5, 0.5, 'unknown'), location(NaN, 0), location(2, 0)]) {
      expect(soccerShotApproach(input)).toBeNull()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { soccerFieldLocation, suggestSoccerRestartKind } from './field'

describe('soccer restart suggestions', () => {
  it('suggests the awarded side attacking corners in both directions', () => {
    expect(suggestSoccerRestartKind(
      { x: 0.98, y: 0.02 },
      'tracked',
      'left_to_right'
    )).toBe('corner')
    expect(suggestSoccerRestartKind(
      { x: 0.02, y: 0.98 },
      'tracked',
      'right_to_left'
    )).toBe('corner')
    expect(suggestSoccerRestartKind(
      { x: 0.02, y: 0.02 },
      'opponent',
      'left_to_right'
    )).toBe('corner')
  })

  it('suggests touchline throw-ins outside the attacking corner threshold', () => {
    expect(suggestSoccerRestartKind(
      { x: 0.5, y: 0.01 },
      'tracked',
      'left_to_right'
    )).toBe('throw_in')
    expect(suggestSoccerRestartKind(
      { x: 0.25, y: 0.99 },
      'opponent',
      'right_to_left'
    )).toBe('throw_in')
    expect(suggestSoccerRestartKind(
      { x: 0.9, y: 0.02 },
      'tracked',
      'left_to_right'
    )).toBe('throw_in')
  })

  it('suggests goal kicks in the awarded side defending goal area', () => {
    expect(suggestSoccerRestartKind(
      { x: 0.04, y: 0.5 },
      'tracked',
      'left_to_right'
    )).toBe('goal_kick')
    expect(suggestSoccerRestartKind(
      { x: 0.96, y: 0.5 },
      'tracked',
      'right_to_left'
    )).toBe('goal_kick')
    expect(suggestSoccerRestartKind(
      { x: 0.96, y: 0.5 },
      'opponent',
      'left_to_right'
    )).toBe('goal_kick')
  })

  it('leaves ambiguous interior locations unselected', () => {
    expect(suggestSoccerRestartKind(
      { x: 0.5, y: 0.5 },
      'tracked',
      'left_to_right'
    )).toBeNull()
    expect(suggestSoccerRestartKind(
      { x: 0.04, y: 0.66 },
      'tracked',
      'left_to_right'
    )).toBeNull()
  })

  it('uses canonical coordinates after equivalent flipped display taps', () => {
    const normal = soccerFieldLocation(0.98, 0.02, false, 'left_to_right')
    const flipped = soccerFieldLocation(0.02, 0.98, true, 'left_to_right')

    expect(flipped.x).toBeCloseTo(normal.x)
    expect(flipped.y).toBeCloseTo(normal.y)
    expect(flipped.attackingDirection).toBe(normal.attackingDirection)
    expect(suggestSoccerRestartKind(normal, 'tracked', 'left_to_right')).toBe('corner')
    expect(suggestSoccerRestartKind(flipped, 'tracked', 'left_to_right')).toBe('corner')
  })
})

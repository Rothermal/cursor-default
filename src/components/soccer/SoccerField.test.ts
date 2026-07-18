import { describe, expect, it } from 'vitest'
import { soccerFieldLocation } from '../../lib/soccer/field'

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
})

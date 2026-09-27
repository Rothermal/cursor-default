import { describe, expect, it } from 'vitest'
import { soccerFieldLocation } from '../soccer/field'
import { surfaceLocation } from './location'

/** The Soccer body as it stood before the XS-5 extraction. */
function legacySoccerFieldLocation(displayX: number, displayY: number, flipped: boolean) {
  const x = Math.min(1, Math.max(0, displayX))
  const y = Math.min(1, Math.max(0, displayY))
  return { x: flipped ? 1 - x : x, y: flipped ? 1 - y : y }
}

describe('shared surface location (XS-5)', () => {
  const samples = [-0.3, 0, 0.12, 0.5, 0.875, 1, 1.4]

  it('keeps soccerFieldLocation output identical after the extraction', () => {
    for (const displayX of samples) {
      for (const displayY of samples) {
        for (const flipped of [false, true]) {
          for (const direction of ['left_to_right', 'right_to_left'] as const) {
            expect(soccerFieldLocation(displayX, displayY, flipped, direction)).toEqual({
              ...legacySoccerFieldLocation(displayX, displayY, flipped),
              attackingDirection: direction,
            })
          }
        }
      }
    }
  })

  it('round-trips display and canonical coordinates through a flip', () => {
    const canonical = surfaceLocation(0.2, 0.7, false, 'unknown')
    const viaFlip = surfaceLocation(1 - canonical.x, 1 - canonical.y, true, 'unknown')
    expect(viaFlip.x).toBeCloseTo(canonical.x)
    expect(viaFlip.y).toBeCloseTo(canonical.y)
    expect(viaFlip.attackingDirection).toBe('unknown')
  })
})

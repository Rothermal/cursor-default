import { describe, expect, it } from 'vitest'
import { surfacePoint } from './surfacePoint'

describe('surfacePoint', () => {
  it('maps a fitted surface without rounding', () => {
    expect(surfacePoint({ left: 10, top: 20, width: 400, height: 256 }, { clientX: 110, clientY: 148 }, 100, 64)).toEqual({ x: 0.25, y: 0.5 })
  })
  it('accounts for horizontal letterboxing', () => {
    const bounds = { left: 0, top: 0, width: 1000, height: 64 }
    expect(surfacePoint(bounds, { clientX: 450, clientY: 32 }, 100, 64)).toEqual({ x: 0, y: 0.5 })
    expect(surfacePoint(bounds, { clientX: 449, clientY: 32 }, 100, 64)).toBeNull()
  })
  it('accounts for vertical letterboxing', () => {
    const bounds = { left: 0, top: 0, width: 200, height: 185 }
    expect(surfacePoint(bounds, { clientX: 100, clientY: 50 }, 200, 85)).toEqual({ x: 0.5, y: 0 })
    expect(surfacePoint(bounds, { clientX: 100, clientY: 49 }, 200, 85)).toBeNull()
  })
  it('ignores surfaces with no measurable layout', () => {
    expect(surfacePoint({ left: 0, top: 0, width: 0, height: 0 }, { clientX: 0, clientY: 0 }, 100, 64)).toBeNull()
  })
})

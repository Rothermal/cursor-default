import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSurfaceGesture } from './surfaceGesture'

describe('capture-first surface gestures', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const point = { pointerId: 1, clientX: 100, clientY: 200 }
  function setup() {
    const onTap = vi.fn(), onHold = vi.fn()
    return { onTap, onHold, gesture: createSurfaceGesture({ onTap, onHold }) }
  }
  it('captures once on release at the original position, including ordinary finger drift', () => {
    const { gesture, onTap, onHold } = setup()
    gesture.start(point)
    vi.advanceTimersByTime(499)
    gesture.end({ ...point, clientX: 110 })
    gesture.end(point)
    vi.runAllTimers()
    expect(onTap.mock.calls).toEqual([[point]])
    expect(onHold).not.toHaveBeenCalled()
  })
  it('holds once and never also captures on release', () => {
    const { gesture, onTap, onHold } = setup()
    gesture.start(point)
    vi.advanceTimersByTime(5000)
    gesture.end(point)
    expect(onHold.mock.calls).toEqual([[point]])
    expect(onTap).not.toHaveBeenCalled()
  })
  it.each(['movement', 'release movement', 'cancel', 'other pointer', 'second start'])(
    'cancels both actions after %s', reason => {
      const { gesture, onTap, onHold } = setup()
      gesture.start(point)
      if (reason === 'movement') gesture.move({ ...point, clientY: 219 })
      else if (reason === 'release movement') gesture.end({ ...point, clientX: 119 })
      else if (reason === 'cancel') gesture.cancel()
      else if (reason === 'other pointer') gesture.otherPointer(2)
      else gesture.start({ ...point, pointerId: 2 })
      vi.runAllTimers()
      gesture.end(point)
      expect(onTap).not.toHaveBeenCalled()
      expect(onHold).not.toHaveBeenCalled()
    }
  )
  it('ignores unrelated move/up events and permits the active pointer', () => {
    const { gesture, onTap } = setup()
    gesture.start(point)
    gesture.otherPointer(1)
    gesture.move({ ...point, pointerId: 2, clientX: 500 })
    gesture.end({ ...point, pointerId: 2 })
    gesture.end(point)
    expect(onTap).toHaveBeenCalledExactlyOnceWith(point)
  })
  it('permits repeated independent captures at exactly the same coordinates', () => {
    const { gesture, onTap } = setup()
    for (let n = 0; n < 3; n++) { gesture.start(point); gesture.end(point) }
    expect(onTap.mock.calls).toEqual([[point], [point], [point]])
  })
  it('starts cleanly after a cancelled or held gesture', () => {
    const { gesture, onTap, onHold } = setup()
    gesture.start(point)
    gesture.cancel()
    gesture.start(point)
    vi.advanceTimersByTime(500)
    gesture.cancel()
    gesture.start(point)
    gesture.end(point)
    expect(onHold).toHaveBeenCalledTimes(1)
    expect(onTap).toHaveBeenCalledTimes(1)
  })
  it('supports tuning the hold threshold without changing coordinates', () => {
    const onHold = vi.fn()
    const gesture = createSurfaceGesture({ onTap: vi.fn(), onHold, holdMs: 700 })
    gesture.start(point)
    vi.advanceTimersByTime(699)
    expect(onHold).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onHold).toHaveBeenCalledExactlyOnceWith(point)
    gesture.cancel()
  })
})

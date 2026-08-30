import { describe, expect, it } from 'vitest'
import {
  basketballWholeSecondsFromMs,
  formatBasketballDurationMs,
  formatBasketballDurationSeconds,
} from './duration'

describe('Basketball duration presentation', () => {
  it('truncates once at whole-second precision and formats MM:SS', () => {
    expect(basketballWholeSecondsFromMs(12_999)).toBe(12)
    expect(formatBasketballDurationMs(12_999)).toBe('00:12')
    expect(formatBasketballDurationSeconds(65.99)).toBe('01:05')
  })

  it('supports totals beyond one hour and clamps invalid negative input', () => {
    expect(formatBasketballDurationMs(3_661_999)).toBe('1:01:01')
    expect(formatBasketballDurationMs(-1)).toBe('00:00')
    expect(formatBasketballDurationMs(Number.NaN)).toBe('00:00')
  })
})

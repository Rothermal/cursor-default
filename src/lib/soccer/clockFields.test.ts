import { describe, expect, it } from 'vitest'
import { parseSoccerClockFields } from './timeline'

describe('split clock correction fields', () => {
  it.each([
    ['0', '0', 0], ['45', '30', 2_730_000], ['120', '5', 7_205_000],
    ['00', '09', 9_000], ['1', '59', 119_000],
  ])('parses %s minutes and %s seconds', (minutes, seconds, expected) => {
    expect(parseSoccerClockFields(minutes, seconds)).toBe(expected)
  })
  it.each([
    ['', '0'], ['0', ''], ['-1', '0'], ['1.5', '0'], ['1', '60'],
    ['1', '-1'], ['1', '2.5'], ['1e2', '0'], ['1', '000'],
    ['99999999999999999999', '0'],
  ])('rejects %s minutes and %s seconds', (minutes, seconds) => {
    expect(parseSoccerClockFields(minutes, seconds)).toBeNull()
  })
})

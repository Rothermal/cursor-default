import { describe, expect, it } from 'vitest'
import { getBonusStatus } from './basketballBonus'

describe('getBonusStatus', () => {
  it('returns none below bonus threshold', () => {
    expect(getBonusStatus(6, 7, 10, true)).toBe('none')
  })

  it('returns one_and_one when enabled and at bonus threshold', () => {
    expect(getBonusStatus(7, 7, 10, true)).toBe('one_and_one')
    expect(getBonusStatus(9, 7, 10, true)).toBe('one_and_one')
  })

  it('returns double_bonus at or above double threshold', () => {
    expect(getBonusStatus(10, 7, 10, true)).toBe('double_bonus')
  })

  it('treats NBA-style bonus (no one-and-one) as double_bonus at threshold', () => {
    expect(getBonusStatus(7, 7, 10, false)).toBe('double_bonus')
  })
})

import { describe, expect, it } from 'vitest'
import { careerSportOptions } from './careerSportOptions'

describe('career sport options', () => {
  it('keeps canonical soccer available beside legacy sport history', () => {
    expect(careerSportOptions(
      ['basketball'],
      ['soccer', 'basketball'],
      'basketball'
    )).toEqual(['basketball', 'soccer'])
  })

  it('keeps non-soccer team sports available from a canonical soccer route', () => {
    expect(careerSportOptions([], ['soccer', 'basketball'], 'soccer'))
      .toEqual(['basketball', 'soccer'])
  })
})

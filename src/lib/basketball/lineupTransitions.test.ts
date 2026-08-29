import { describe, expect, it } from 'vitest'
import {
  BASKETBALL_SUBSTITUTION_REASON_OPTIONS,
  basketballSubstitutionRequiresReason,
  deriveBasketballLiveSubstitutionMode,
  formatBasketballSubstitutionReason,
  isBasketballSubstitutionMode,
  isBasketballSubstitutionReasonCode,
} from './lineupTransitions'

describe('BKE-6C1 lineup transition contracts', () => {
  it('derives every live transition mode without fabricating intermediate lineups', () => {
    expect(deriveBasketballLiveSubstitutionMode(1, 1)).toBe('balanced')
    expect(deriveBasketballLiveSubstitutionMode(2, 0)).toBe('exit_only')
    expect(deriveBasketballLiveSubstitutionMode(0, 1)).toBe('entry_only')
    expect(deriveBasketballLiveSubstitutionMode(2, 1)).toBe('mixed')
    expect(deriveBasketballLiveSubstitutionMode(0, 0)).toBeNull()
  })

  it('requires reasons for unbalanced and recovery authority but not a full-five boundary', () => {
    expect(basketballSubstitutionRequiresReason('balanced', 5)).toBe(false)
    expect(basketballSubstitutionRequiresReason('boundary', 5)).toBe(false)
    expect(basketballSubstitutionRequiresReason('boundary', 4)).toBe(true)
    expect(basketballSubstitutionRequiresReason('mixed', 4)).toBe(true)
    expect(basketballSubstitutionRequiresReason('entry_only', 5)).toBe(true)
    expect(basketballSubstitutionRequiresReason('current_lineup_recovery', 5)).toBe(true)
  })

  it('keeps runtime validation, options, and formatting on one exhaustive catalog', () => {
    expect(BASKETBALL_SUBSTITUTION_REASON_OPTIONS).toEqual([
      { value: 'injury', label: 'Injury' },
      { value: 'eligibility', label: 'Eligibility' },
      { value: 'short_handed', label: 'Short-handed' },
      { value: 'recovery', label: 'Recovery' },
      { value: 'other', label: 'Other' },
    ])
    expect(isBasketballSubstitutionReasonCode('short_handed')).toBe(true)
    expect(isBasketballSubstitutionReasonCode('technical')).toBe(false)
    expect(isBasketballSubstitutionMode('mixed')).toBe(true)
    expect(formatBasketballSubstitutionReason('short_handed', 'Four eligible players'))
      .toBe('Short-handed: Four eligible players')
  })
})

import { describe, expect, it } from 'vitest'
import type { BasketballTeamStatsConfig } from '../types'
import {
  buildPeriodSegmentLabels,
  getBonusFoulCountForPeriod,
  periodScopedStatKey,
} from './teamStatsPeriods'

const baseRules = (over: Partial<BasketballTeamStatsConfig> = {}): BasketballTeamStatsConfig => ({
  periodsPerGame: 4,
  periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
  bonusThreshold: 7,
  doubleBonusThreshold: 10,
  hasOneAndOne: true,
  overtimeLabel: 'OT',
  overtimeFoulsReset: true,
  timeoutsPerPeriod: 5,
  timeoutsPerOvertime: null,
  ...over,
})

describe('periodScopedStatKey', () => {
  it('suffixes base id with period index', () => {
    expect(periodScopedStatKey('team_foul', 2)).toBe('team_foul_p2')
  })
})

describe('getBonusFoulCountForPeriod', () => {
  it('returns zero for non-positive periods', () => {
    expect(getBonusFoulCountForPeriod({ team_foul_p1: 3 }, 'team_foul', 0, baseRules())).toBe(0)
  })

  it('uses only the regulation period bucket', () => {
    const stats = { team_foul_p1: 2, team_foul_p2: 5 }
    expect(getBonusFoulCountForPeriod(stats, 'team_foul', 2, baseRules())).toBe(5)
  })

  it('uses only current OT when overtimeFoulsReset is true', () => {
    const stats = { team_foul_p5: 3, team_foul_p6: 4 }
    expect(getBonusFoulCountForPeriod(stats, 'team_foul', 6, baseRules())).toBe(4)
  })

  it('sums OT buckets when overtimeFoulsReset is false', () => {
    const stats = { team_foul_p5: 3, team_foul_p6: 4 }
    expect(
      getBonusFoulCountForPeriod(stats, 'team_foul', 6, baseRules({ overtimeFoulsReset: false }))
    ).toBe(7)
  })
})

describe('buildPeriodSegmentLabels', () => {
  it('uses stored regulation labels and OT naming', () => {
    expect(buildPeriodSegmentLabels(baseRules(), 6)).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'OT',
      'OT 2',
    ])
  })

  it('falls back to defaults when stored labels are sparse', () => {
    expect(
      buildPeriodSegmentLabels(baseRules({ periodsPerGame: 2, periodLabels: [] }), 3)
    ).toEqual(['1st Half', '2nd Half', 'OT'])
  })
})

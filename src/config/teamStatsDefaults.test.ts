import { describe, expect, it } from 'vitest'
import { sports } from './sports'
import {
  getDefaultPeriodLabels,
  resolveTeamStatsConfig,
  seasonTeamStatsConfigToJson,
} from './teamStatsDefaults'

const basketball = sports.find(s => s.id === 'basketball')!

describe('getDefaultPeriodLabels', () => {
  it('uses halves for 2 periods and quarters otherwise', () => {
    expect(getDefaultPeriodLabels(2)).toEqual(['1st Half', '2nd Half'])
    expect(getDefaultPeriodLabels(4)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
  })
})

describe('resolveTeamStatsConfig', () => {
  it('returns null when sport has no team categories', () => {
    const baseball = sports.find(s => s.id === 'baseball')!
    expect(resolveTeamStatsConfig(baseball, {})).toBeNull()
  })

  it('returns NFHS defaults when season config is missing', () => {
    const resolved = resolveTeamStatsConfig(basketball, null)!
    expect(resolved.periodsPerGame).toBe(2)
    expect(resolved.bonusThreshold).toBe(7)
    expect(resolved.hasOneAndOne).toBe(true)
  })

  it('merges valid season overrides and ignores invalid numbers', () => {
    const resolved = resolveTeamStatsConfig(basketball, {
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 0,
      hasOneAndOne: false,
      overtimeLabel: 'Extra',
      overtimeFoulsReset: false,
      timeoutsPerPeriod: 3.9,
    })!
    expect(resolved.periodsPerGame).toBe(4)
    expect(resolved.periodLabels).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(resolved.bonusThreshold).toBe(5)
    expect(resolved.doubleBonusThreshold).toBe(10) // invalid override ignored
    expect(resolved.hasOneAndOne).toBe(false)
    expect(resolved.overtimeLabel).toBe('Extra')
    expect(resolved.overtimeFoulsReset).toBe(false)
    expect(resolved.timeoutsPerPeriod).toBe(3)
  })

  it('falls back to default labels when periodLabels length mismatches', () => {
    const resolved = resolveTeamStatsConfig(basketball, {
      periodsPerGame: 4,
      periodLabels: ['Only one'],
    })!
    expect(resolved.periodLabels).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
  })
})

describe('seasonTeamStatsConfigToJson', () => {
  it('omits null timeout fields', () => {
    const json = seasonTeamStatsConfigToJson({
      periodsPerGame: 2,
      periodLabels: ['1st Half', '2nd Half'],
      bonusThreshold: 7,
      doubleBonusThreshold: 10,
      hasOneAndOne: true,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: null,
      timeoutsPerOvertime: 1,
    })
    expect(json.timeoutsPerPeriod).toBeUndefined()
    expect(json.timeoutsPerOvertime).toBe(1)
  })
})

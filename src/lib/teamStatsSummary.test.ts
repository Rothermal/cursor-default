import { describe, expect, it } from 'vitest'
import { sports } from '../config/sports'
import type { BasketballTeamStatsConfig } from '../types'
import {
  deriveBonusEvents,
  foulCountForPeriod,
  hasTrackedTeamSide,
  maxTeamStatPeriodIndex,
  valueForTeamAction,
} from './teamStatsSummary'

const basketball = sports.find(s => s.id === 'basketball')!

const config = (over: Partial<BasketballTeamStatsConfig> = {}): BasketballTeamStatsConfig => ({
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

describe('foulCountForPeriod / maxTeamStatPeriodIndex', () => {
  it('reads period-scoped foul keys and finds the max period', () => {
    const home = { team_foul_p1: 2, team_foul_p3: 4 }
    const opp = { team_foul_p2: 1 }
    expect(foulCountForPeriod(home, 'team_foul', 3)).toBe(4)
    expect(foulCountForPeriod(home, 'team_foul', 2)).toBe(0)
    expect(maxTeamStatPeriodIndex(home, opp, 'team_foul')).toBe(3)
  })
})

describe('deriveBonusEvents', () => {
  it('emits one-and-one then double-bonus milestones for NFHS-style rules', () => {
    const events = deriveBonusEvents(
      { team_foul_p1: 10 },
      config(),
      'team_foul',
      1,
      'Home'
    )
    expect(events).toEqual([
      {
        periodIndex: 1,
        periodLabel: 'Q1',
        type: 'one_and_one',
        foulCount: 7,
        teamLabel: 'Home',
      },
      {
        periodIndex: 1,
        periodLabel: 'Q1',
        type: 'double_bonus',
        foulCount: 10,
        teamLabel: 'Home',
      },
    ])
  })

  it('emits NBA-style bonus_nba when hasOneAndOne is false', () => {
    const events = deriveBonusEvents(
      { team_foul_p1: 8 },
      config({ hasOneAndOne: false }),
      'team_foul',
      1,
      'Opp'
    )
    expect(events.map(e => e.type)).toEqual(['bonus_nba'])
  })
})

describe('valueForTeamAction / hasTrackedTeamSide', () => {
  it('sums period-scoped actions and reads flat actions', () => {
    const foulAction = basketball.teamCategories![0].actions[0]
    const techAction = basketball.teamCategories![1].actions.find(a => a.id === 'team_tech')!
    expect(valueForTeamAction({ team_foul_p1: 2, team_foul_p2: 3 }, foulAction)).toBe(5)
    expect(valueForTeamAction({ team_tech: 1 }, techAction)).toBe(1)
  })

  it('detects whether any team-side stats were tracked', () => {
    expect(hasTrackedTeamSide({}, basketball)).toBe(false)
    expect(hasTrackedTeamSide({ team_foul_p1: 0 }, basketball)).toBe(false)
    expect(hasTrackedTeamSide({ team_foul_p1: 2 }, basketball)).toBe(true)
    expect(hasTrackedTeamSide({ team_tech: 1 }, basketball)).toBe(true)
  })
})

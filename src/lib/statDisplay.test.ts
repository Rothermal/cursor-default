import { describe, expect, it } from 'vitest'
import { sports } from '../config/sports'
import type { SportConfig } from '../types'
import { formatCompactGameStatLine } from './statDisplay'

const basketball = sports.find(s => s.id === 'basketball')!

describe('formatCompactGameStatLine', () => {
  it('shows zero points when all stats are empty', () => {
    expect(formatCompactGameStatLine(basketball, {})).toBe('0 PTS')
  })

  it('formats points and key basketball stats', () => {
    // 2×2pt + 1×3pt = 7 PTS; 1 oreb + 2 dreb = 3 REB; keyStats ast/stl/blk
    expect(
      formatCompactGameStatLine(basketball, {
        '2pt': 2,
        '3pt': 1,
        oreb: 1,
        dreb: 2,
        ast: 4,
        stl: 1,
        blk: 0,
      })
    ).toBe('7 PTS · 3 REB · 4 AST · 1 STL')
  })

  it('omits zero rebound and key-stat segments', () => {
    expect(formatCompactGameStatLine(basketball, { ft: 3, ast: 0, stl: 0 })).toBe('3 PTS')
  })

  it('uses sport scoreLabel when not Points', () => {
    const soccerish: SportConfig = {
      ...basketball,
      id: 'soccer',
      scoreLabel: 'Goals',
      keyStatIds: ['s_goal'],
      categories: [
        {
          id: 'scoring',
          name: 'Scoring',
          color: 'green',
          actions: [{ id: 's_goal', label: 'Goal', shortLabel: 'G', pointValue: 1 }],
        },
      ],
    }
    expect(formatCompactGameStatLine(soccerish, { s_goal: 2 })).toBe('2 Goals · 2 G')
  })
})

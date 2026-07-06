import { describe, expect, it } from 'vitest'
import type { ActionLogEntry, Player, SportConfig } from '../types'
import { describeActionLogEntry, formatActionLogEntryLabel } from './actionLogLabels'
import { TEAM_PLAYER_HOME_ID } from './teamPlayers'

const sport: SportConfig = {
  id: 'basketball',
  name: 'Basketball',
  icon: 'ball',
  theme: {
    bg: '',
    bgLight: '',
    text: '',
    border: '',
    gradient: '',
  },
  scoreLabel: 'Points',
  categories: [
    {
      id: 'scoring',
      name: 'Scoring',
      color: 'amber',
      actions: [
        { id: '2pt', label: '2-Pointer', shortLabel: '2PT', pointValue: 2 },
        { id: '2pt_miss', label: '2PT Miss', shortLabel: '2 Miss', madeStatId: '2pt' },
      ],
    },
    {
      id: 'playmaking',
      name: 'Playmaking',
      color: 'emerald',
      actions: [{ id: 'ast', label: 'Assists', shortLabel: 'AST' }],
    },
  ],
  teamCategories: [
    {
      id: 'team_fouls',
      name: 'Fouls',
      color: 'rose',
      actions: [{ id: 'team_foul', label: 'Team Foul', shortLabel: 'TF', periodScoped: true }],
    },
  ],
}

const players: Player[] = [
  { id: 'p23', name: 'Player B', number: '23', stats: {} },
  { id: TEAM_PLAYER_HOME_ID, name: 'Wildcats', number: '*', stats: {}, isTeamPlayer: true },
]

function entry(overrides: Partial<ActionLogEntry>): ActionLogEntry {
  return {
    id: 'log_1',
    timestamp: 1,
    type: 'increment',
    previousValue: 0,
    ...overrides,
  }
}

describe('describeActionLogEntry', () => {
  it('labels a made shot increment in plain language', () => {
    expect(
      describeActionLogEntry(
        entry({ playerId: 'p23', statId: '2pt', shotId: 'shot_1' }),
        players,
        sport
      )
    ).toEqual({ who: '#23 Player B', what: '2PT made' })
  })

  it('labels a missed shot increment in plain language', () => {
    expect(
      describeActionLogEntry(
        entry({ playerId: 'p23', statId: '2pt_miss', shotId: 'shot_2' }),
        players,
        sport
      )
    ).toEqual({ who: '#23 Player B', what: '2PT miss' })
  })

  it('labels a player stat decrement with direction', () => {
    expect(
      describeActionLogEntry(
        entry({ type: 'decrement', playerId: 'p23', statId: 'ast', previousValue: 3 }),
        players,
        sport
      )
    ).toEqual({ who: '#23 Player B', what: 'AST -1' })
  })

  it('labels a scoring decrement with shot context and direction', () => {
    expect(
      describeActionLogEntry(
        entry({ type: 'decrement', playerId: 'p23', statId: '2pt', previousValue: 3 }),
        players,
        sport
      )
    ).toEqual({ who: '#23 Player B', what: '2PT made -1' })
  })

  it('labels opponent and home score events', () => {
    expect(
      describeActionLogEntry(entry({ type: 'opponent_score_up', previousValue: 7 }), players, sport)
    ).toEqual({ who: 'Opponent', what: '+1' })
    expect(
      describeActionLogEntry(entry({ type: 'home_team_score_down', previousValue: 8 }), players, sport)
    ).toEqual({ who: 'Home', what: '-1' })
  })

  it('labels period-scoped team stats by base stat id', () => {
    expect(
      describeActionLogEntry(
        entry({ playerId: TEAM_PLAYER_HOME_ID, statId: 'team_foul_p2' }),
        players,
        sport
      )
    ).toEqual({ who: 'Wildcats', what: 'TF +1' })
  })

  it('formats the display label as who - what', () => {
    expect(
      formatActionLogEntryLabel(entry({ playerId: 'p23', statId: 'ast' }), players, sport)
    ).toBe('#23 Player B - AST +1')
  })
})

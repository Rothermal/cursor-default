import type { SportConfig } from '../types'
import { soccerAggregateSportCategories } from '../lib/soccer/aggregateStats'

export const sports: SportConfig[] = [
  {
    id: 'basketball',
    name: 'Basketball',
    icon: '🏀',
    theme: {
      bg: 'bg-orange-500',
      bgLight: 'bg-orange-50',
      text: 'text-orange-600',
      border: 'border-orange-400',
      gradient: 'from-orange-500 to-amber-500',
    },
    scoreLabel: 'Points',
    keyStatIds: ['ast', 'stl', 'blk'],
    categories: [
      {
        id: 'scoring',
        name: 'Scoring',
        color: 'amber',
        actions: [
          { id: 'ft',      label: 'Free Throw',  shortLabel: 'FT',      pointValue: 1 },
          { id: 'ft_miss', label: 'FT Miss',      shortLabel: 'FT Miss', color: 'slate', madeStatId: 'ft' },
          { id: '2pt',      label: '2-Pointer',   shortLabel: '2PT',     pointValue: 2 },
          { id: '2pt_miss', label: '2PT Miss',    shortLabel: '2 Miss',  color: 'slate', madeStatId: '2pt' },
          { id: '3pt',      label: '3-Pointer',   shortLabel: '3PT',     pointValue: 3 },
          { id: '3pt_miss', label: '3PT Miss',    shortLabel: '3 Miss',  color: 'slate', madeStatId: '3pt' },
        ],
        showTotal: true,
        totalLabel: 'Total Points',
      },
      {
        id: 'rebounds',
        name: 'Rebounds',
        color: 'sky',
        actions: [
          { id: 'oreb', label: 'Offensive', shortLabel: 'OFF' },
          { id: 'dreb', label: 'Defensive', shortLabel: 'DEF' },
        ],
        showTotal: true,
        totalLabel: 'Total Rebounds',
      },
      {
        id: 'playmaking',
        name: 'Playmaking',
        color: 'emerald',
        columns: 2,
        hideHeader: true,
        actions: [
          { id: 'ast', label: 'Assists', shortLabel: 'AST' },
          { id: 'stl', label: 'Steals', shortLabel: 'STL' },
          { id: 'blk', label: 'Blocks', shortLabel: 'BLK', color: 'violet' },
          { id: 'min', label: 'Minutes', shortLabel: 'MIN', color: 'teal' },
        ],
      },
      {
        id: 'other',
        name: 'Other',
        color: 'slate',
        columns: 2,
        hideHeader: true,
        actions: [
          { id: 'to', label: 'Turnovers', shortLabel: 'TO' },
          { id: 'pf', label: 'Fouls', shortLabel: 'PF' },
        ],
      },
    ],
    teamKeyStatIds: ['team_foul', 'team_to_used', 'team_tech'],
    teamFoulBaseStatId: 'team_foul',
    teamCategories: [
      {
        id: 'team_fouls',
        name: 'Fouls',
        color: 'rose',
        actions: [
          {
            id: 'team_foul',
            label: 'Team Foul',
            shortLabel: 'TF',
            periodScoped: true,
          },
        ],
        showTotal: true,
        totalLabel: 'Period Fouls',
      },
      {
        id: 'team_misc',
        name: 'Team',
        color: 'slate',
        columns: 2,
        hideHeader: true,
        actions: [
          { id: 'team_to_used', label: 'Timeout', shortLabel: 'TO', periodScoped: true },
          { id: 'team_tech', label: 'Technical', shortLabel: 'TECH' },
          { id: 'team_turnover', label: 'Turnover', shortLabel: 'TTO' },
        ],
      },
    ],
  },

  {
    id: 'baseball',
    name: 'Baseball',
    icon: '⚾',
    theme: {
      bg: 'bg-red-600',
      bgLight: 'bg-red-50',
      text: 'text-red-600',
      border: 'border-red-400',
      gradient: 'from-red-600 to-red-500',
    },
    scoreLabel: 'Runs',
    keyStatIds: ['r', 'rbi', 'hr', 'sb'],
    categories: [
      {
        id: 'hitting',
        name: 'Hitting',
        color: 'red',
        actions: [
          { id: '1b', label: 'Single', shortLabel: '1B' },
          { id: '2b', label: 'Double', shortLabel: '2B' },
          { id: '3b', label: 'Triple', shortLabel: '3B' },
          { id: 'hr', label: 'Home Run', shortLabel: 'HR' },
        ],
        showTotal: true,
        totalLabel: 'Total Hits',
      },
      {
        id: 'plate',
        name: 'Plate Discipline',
        color: 'amber',
        actions: [
          { id: 'bb', label: 'Walk', shortLabel: 'BB' },
          { id: 'k', label: 'Strikeout', shortLabel: 'K' },
          { id: 'hbp', label: 'Hit By Pitch', shortLabel: 'HBP' },
          { id: 'sac', label: 'Sacrifice', shortLabel: 'SAC' },
        ],
      },
      {
        id: 'running',
        name: 'Baserunning',
        color: 'emerald',
        actions: [
          { id: 'r', label: 'Runs', shortLabel: 'R', pointValue: 1 },
          { id: 'rbi', label: 'RBIs', shortLabel: 'RBI' },
          { id: 'sb', label: 'Stolen Base', shortLabel: 'SB' },
        ],
      },
      {
        id: 'fielding',
        name: 'Fielding',
        color: 'sky',
        actions: [
          { id: 'po', label: 'Putout', shortLabel: 'PO' },
          { id: 'a_field', label: 'Assist', shortLabel: 'A' },
          { id: 'e', label: 'Error', shortLabel: 'E' },
        ],
      },
    ],
  },

  {
    id: 'football',
    name: 'Football',
    icon: '🏈',
    theme: {
      bg: 'bg-green-700',
      bgLight: 'bg-green-50',
      text: 'text-green-700',
      border: 'border-green-500',
      gradient: 'from-green-700 to-green-600',
    },
    scoreLabel: 'Points',
    keyStatIds: ['pass_td', 'rush_td', 'rec_td', 'fg'],
    categories: [
      {
        id: 'passing',
        name: 'Passing',
        color: 'sky',
        actions: [
          { id: 'comp', label: 'Completion', shortLabel: 'CMP' },
          { id: 'inc', label: 'Incompletion', shortLabel: 'INC' },
          { id: 'pass_td', label: 'Pass TD', shortLabel: 'PTD', pointValue: 6 },
          { id: 'int_thrown', label: 'INT Thrown', shortLabel: 'INT' },
        ],
      },
      {
        id: 'rushing',
        name: 'Rushing',
        color: 'emerald',
        actions: [
          { id: 'carry', label: 'Carry', shortLabel: 'CAR' },
          { id: 'rush_td', label: 'Rush TD', shortLabel: 'RTD', pointValue: 6 },
        ],
      },
      {
        id: 'receiving',
        name: 'Receiving',
        color: 'amber',
        actions: [
          { id: 'rec', label: 'Reception', shortLabel: 'REC' },
          { id: 'rec_td', label: 'Rec TD', shortLabel: 'RECTD', pointValue: 6 },
        ],
      },
      {
        id: 'def',
        name: 'Defense',
        color: 'violet',
        actions: [
          { id: 'tackle', label: 'Tackle', shortLabel: 'TKL' },
          { id: 'sack', label: 'Sack', shortLabel: 'SCK' },
          { id: 'def_int', label: 'Interception', shortLabel: 'INT' },
          { id: 'ff', label: 'Forced Fumble', shortLabel: 'FF' },
          { id: 'fr', label: 'Fumble Recovery', shortLabel: 'FR' },
        ],
      },
      {
        id: 'kicking',
        name: 'Kicking',
        color: 'slate',
        actions: [
          { id: 'fg', label: 'Field Goal', shortLabel: 'FG', pointValue: 3 },
          { id: 'xp', label: 'Extra Point', shortLabel: 'XP', pointValue: 1 },
        ],
      },
    ],
  },

  {
    id: 'hockey',
    name: 'Hockey',
    icon: '🏒',
    theme: {
      bg: 'bg-blue-600',
      bgLight: 'bg-blue-50',
      text: 'text-blue-600',
      border: 'border-blue-400',
      gradient: 'from-blue-600 to-cyan-500',
    },
    scoreLabel: 'Goals',
    keyStatIds: ['goal', 'h_ast', 'shot'],
    categories: [
      {
        id: 'offense',
        name: 'Offense',
        color: 'blue',
        actions: [
          { id: 'goal', label: 'Goal', shortLabel: 'G', pointValue: 1 },
          { id: 'h_ast', label: 'Assist', shortLabel: 'A' },
          { id: 'shot', label: 'Shot', shortLabel: 'SOG' },
        ],
        showTotal: true,
        totalLabel: 'Points (G+A)',
      },
      {
        id: 'physical',
        name: 'Physical',
        color: 'red',
        actions: [
          { id: 'hit', label: 'Hit', shortLabel: 'HIT' },
          { id: 'h_blk', label: 'Block', shortLabel: 'BLK' },
          { id: 'takeaway', label: 'Takeaway', shortLabel: 'TK' },
          { id: 'giveaway', label: 'Giveaway', shortLabel: 'GV' },
        ],
      },
      {
        id: 'penalties',
        name: 'Penalties',
        color: 'amber',
        actions: [
          { id: 'pim_minor', label: 'Minor Penalty', shortLabel: 'MIN' },
          { id: 'pim_major', label: 'Major Penalty', shortLabel: 'MAJ' },
        ],
      },
      {
        id: 'goaltending',
        name: 'Goaltending',
        color: 'teal',
        actions: [
          { id: 'sv', label: 'Save', shortLabel: 'SV' },
          { id: 'ga', label: 'Goal Against', shortLabel: 'GA' },
        ],
      },
    ],
  },

  {
    id: 'soccer',
    name: 'Soccer',
    icon: '⚽',
    theme: {
      bg: 'bg-emerald-600',
      bgLight: 'bg-emerald-50',
      text: 'text-emerald-600',
      border: 'border-emerald-400',
      gradient: 'from-emerald-600 to-teal-500',
    },
    scoreLabel: 'Goals',
    keyStatIds: ['soc_goal', 'soc_ast', 'soc_shot'],
    categories: soccerAggregateSportCategories(),
  },
]

export function computePlayerScore(sport: SportConfig, stats: Record<string, number>): number {
  let score = 0
  for (const category of sport.categories) {
    for (const action of category.actions) {
      if (action.pointValue) {
        score += (stats[action.id] || 0) * action.pointValue
      }
    }
  }
  return score
}

export function computeCategoryTotal(category: { actions: { id: string }[] }, stats: Record<string, number>): number {
  return category.actions.reduce((sum, action) => sum + (stats[action.id] || 0), 0)
}

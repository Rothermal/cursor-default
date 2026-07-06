import type { ActionLogEntry, Player, SportConfig, StatCategory } from '../types'
import { isTeamPseudoPlayer } from './teamPlayers'

export interface ActionLogDescription {
  who: string
  what: string
}

function baseStatId(statId: string): string {
  return statId.replace(/_p\d+$/, '')
}

function statShortLabel(categories: StatCategory[] | undefined, statId: string | undefined): string {
  if (!statId) return ''
  const base = baseStatId(statId)
  for (const category of categories ?? []) {
    for (const action of category.actions) {
      if (action.id === base) return action.shortLabel
    }
  }
  return ''
}

function playerLabel(player: Player | undefined, fallbackId: string | undefined): string {
  if (!player) return fallbackId ? `Player ${fallbackId}` : 'Player'
  if (isTeamPseudoPlayer(player)) return player.name || 'Team'

  const number = player.number?.trim()
  const name = player.name?.trim() || 'Player'
  return number ? `#${number} ${name}` : name
}

function shotStatLabel(statId: string | undefined): string | null {
  const base = statId ? baseStatId(statId) : ''
  switch (base) {
    case 'ft':
      return 'FT made'
    case 'ft_miss':
      return 'FT miss'
    case '2pt':
      return '2PT made'
    case '2pt_miss':
      return '2PT miss'
    case '3pt':
      return '3PT made'
    case '3pt_miss':
      return '3PT miss'
    default:
      return null
  }
}

function describeScoreEntry(entry: ActionLogEntry): ActionLogDescription | null {
  switch (entry.type) {
    case 'opponent_score_up':
      return { who: 'Opponent', what: '+1' }
    case 'opponent_score_down':
      return { who: 'Opponent', what: '-1' }
    case 'home_score_up':
    case 'home_team_score_up':
      return { who: 'Home', what: '+1' }
    case 'home_score_down':
    case 'home_team_score_down':
      return { who: 'Home', what: '-1' }
    default:
      return null
  }
}

export function describeActionLogEntry(
  entry: ActionLogEntry,
  players: Player[],
  sport: SportConfig
): ActionLogDescription {
  const score = describeScoreEntry(entry)
  if (score) return score

  const player = players.find(p => p.id === entry.playerId)
  const who = playerLabel(player, entry.playerId)
  const shotLabel = shotStatLabel(entry.statId)
  if (shotLabel && entry.type === 'increment') return { who, what: shotLabel }
  if (shotLabel && entry.type === 'decrement') return { who, what: `${shotLabel} -1` }

  const shortLabel =
    statShortLabel(sport.categories, entry.statId) ||
    statShortLabel(sport.teamCategories, entry.statId) ||
    entry.statId ||
    'Stat'
  const direction = entry.type === 'decrement' ? '-1' : '+1'
  return { who, what: `${shortLabel} ${direction}` }
}

export function formatActionLogEntryLabel(
  entry: ActionLogEntry,
  players: Player[],
  sport: SportConfig
): string {
  const { who, what } = describeActionLogEntry(entry, players, sport)
  return `${who} - ${what}`
}

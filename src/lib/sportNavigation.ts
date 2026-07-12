import type { GameState } from '../types'
import type { ParkedGameSummary } from './gameParking'

type ResumableGameState = Pick<GameState, 'sport' | 'gameInfo' | 'players'>

export function sportDashboardPath(sportId: string): string {
  return `/sport/${encodeURIComponent(sportId)}`
}

export function sportTeamsPath(sportId: string): string {
  return `/teams?sport=${encodeURIComponent(sportId)}`
}

export function sportGamesPath(sportId: string): string {
  return `/games?sport=${encodeURIComponent(sportId)}`
}

export function sportLeaderboardPath(sportId: string): string {
  return `/leaderboard?sport=${encodeURIComponent(sportId)}`
}

export function isKnownSportId(
  sportId: string | null | undefined,
  knownSportIds: readonly string[]
): sportId is string {
  return Boolean(sportId && knownSportIds.includes(sportId))
}

export function routeForResumedGame(state: ResumableGameState): string {
  if (!state.sport) return '/'
  if (!state.gameInfo) return '/setup'
  if (state.players.length === 0) return '/players'
  return '/game'
}

export function parkedSyncLabel(game: Pick<
  ParkedGameSummary,
  'syncDirty' | 'syncStatus' | 'syncLastError'
>): string {
  if (game.syncDirty) {
    if (game.syncStatus === 'error') {
      return game.syncLastError ? `Sync: error - ${game.syncLastError}` : 'Sync: error'
    }
    if (game.syncStatus === 'offline') return 'Sync: offline changes pending'
    if (game.syncStatus === 'syncing') return 'Sync: syncing...'
    return 'Sync: pending'
  }
  if (game.syncStatus === 'synced') return 'Sync: saved'
  return `Sync: ${game.syncStatus}`
}

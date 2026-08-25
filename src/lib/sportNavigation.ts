import type { GameState } from '../types'
import type { ParkedGameSummary } from './gameParking'
import { basketballSummaryPath } from './basketball/summary'

type ResumableGameState = Pick<
  GameState,
  'gameDataAuthority' | 'sport' | 'gameInfo' | 'players' | 'sportGameState' | 'eventStream'
>

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

export function isGameStateForSport(
  state: Pick<GameState, 'sport'>,
  sportId: string
): boolean {
  return state.sport?.id === sportId
}

export function isParkedGameForSport(
  game: Pick<ParkedGameSummary, 'sportId'>,
  sportId: string
): boolean {
  return game.sportId === sportId
}

export function routeForResumedGame(state: ResumableGameState): string {
  if (!state.sport) return '/'
  if (!state.gameInfo) return '/setup'
  if (state.sport.id === 'soccer') {
    if (state.eventStream?.events.length) return '/game'
    return state.sportGameState?.sportId === 'soccer' ? '/players' : '/setup'
  }
  if (state.sport.id === 'basketball' && state.gameDataAuthority === 'sport_events') {
    if (state.eventStream?.events.length) {
      if (
        state.sportGameState?.sportId === 'basketball' &&
        (state.sportGameState.projection?.status === 'suspended' ||
          state.sportGameState.projection?.status === 'ended')
      ) return basketballSummaryPath({ from: 'sport' })
      return '/game'
    }
    return state.gameInfo ? '/players' : '/setup'
  }
  if (state.players.length === 0) return '/players'
  return '/game'
}

export function parkedSyncLabel(game: Pick<
  ParkedGameSummary,
  'syncDirty' | 'syncStatus' | 'syncLastError' | 'eventCloudPolicy'
>): string {
  if (game.eventCloudPolicy === 'local_only') return 'Cloud Sync: local only'
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

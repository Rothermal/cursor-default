import type { GameState } from '../types'
import { supabase } from './supabase'

function isMissingClientSyncErrorsTableError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  const m = error.message.toLowerCase()
  return (
    (m.includes('client_sync_errors') && m.includes('relation') && m.includes('does not exist')) ||
    (m.includes('client_sync_errors') && m.includes('could not find the table'))
  )
}

let lastLogKey = ''
let lastLogAt = 0
const THROTTLE_MS = 45_000

function buildSyncErrorContext(state: GameState): Record<string, unknown> {
  return {
    sportId: state.sport?.id ?? null,
    teamName: state.gameInfo?.teamName ?? null,
    opponentName: state.gameInfo?.opponentName ?? null,
    tournamentId: state.gameInfo?.tournamentId ?? null,
    tournamentName: state.gameInfo?.tournamentName ?? null,
    gameDate: state.gameInfo?.date ?? null,
    cloudGameId: state.cloudSync.gameId ?? null,
    cloudTeamId: state.cloudSync.teamId ?? null,
    cloudSeasonId: state.cloudSync.seasonId ?? null,
    playerCount: state.players.length,
    shotChartCount: state.shotChart.length,
    pathname: typeof window !== 'undefined' ? window.location.pathname : null,
    hash: typeof window !== 'undefined' ? window.location.hash : null,
  }
}

/**
 * Inserts one row for debugging sync failures that happen before DB writes succeed.
 * Throttled to avoid flooding if sync retries rapidly. Swallows errors (including missing table).
 */
export async function logClientSyncError(
  userId: string,
  message: string,
  state: GameState
): Promise<void> {
  if (!supabase || !userId) return

  const trimmed = message.trim().slice(0, 4000)
  const throttleKey = `${userId}:${trimmed}`
  const now = Date.now()
  if (throttleKey === lastLogKey && now - lastLogAt < THROTTLE_MS) {
    return
  }
  lastLogKey = throttleKey
  lastLogAt = now

  const { error } = await supabase.from('client_sync_errors').insert({
    user_id: userId,
    message: trimmed,
    context: buildSyncErrorContext(state),
  })

  if (error && isMissingClientSyncErrorsTableError(error)) {
    return
  }
  // Intentionally quiet on other failures (RLS, network) to avoid recursive noise
}

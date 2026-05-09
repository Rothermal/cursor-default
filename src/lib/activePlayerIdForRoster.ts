import type { Player } from '../types'

/**
 * After replacing the roster, keep the previous selection only when that player
 * still exists; otherwise default to the first roster entry (never a stale id).
 */
export function activePlayerIdAfterRosterChange(
  previousActiveId: string | null,
  players: Player[]
): string | null {
  if (players.length === 0) return null
  if (previousActiveId && players.some(p => p.id === previousActiveId)) {
    return previousActiveId
  }
  return players[0].id
}

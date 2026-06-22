/** Persisted game state key; clear when finalizing so the game no longer appears as in progress. */
export const GAME_STORAGE_KEY = 'statkeeper_game'
/** User id that owns `statkeeper_game`; prevents cross-account snapshot bleed. */
export const GAME_OWNER_KEY = 'statkeeper_game_owner'
export const PENDING_SYNC_KEY = 'statkeeper_pending_sync'

export function clearPersistedGameStorage(): void {
  try {
    localStorage.removeItem(GAME_STORAGE_KEY)
    localStorage.removeItem(GAME_OWNER_KEY)
    localStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    // ignore
  }
}

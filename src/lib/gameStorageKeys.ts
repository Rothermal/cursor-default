/** Persisted game state key; clear when finalizing so the game no longer appears as in progress. */
export const GAME_STORAGE_KEY = 'statkeeper_game'
/** User id that owns `statkeeper_game`; prevents cross-account snapshot bleed. */
export const GAME_OWNER_KEY = 'statkeeper_game_owner'
export const GAMES_MANIFEST_KEY = 'statkeeper_games_manifest'
export const GAME_RECORD_KEY_PREFIX = 'statkeeper_game:'
export const PENDING_SYNC_KEY = 'statkeeper_pending_sync'

export function getPendingSyncFlag(): boolean {
  try {
    return localStorage.getItem(PENDING_SYNC_KEY) === '1'
  } catch {
    return false
  }
}

export function setPendingSyncFlag(pending: boolean): void {
  try {
    if (pending) {
      localStorage.setItem(PENDING_SYNC_KEY, '1')
    } else {
      localStorage.removeItem(PENDING_SYNC_KEY)
    }
  } catch {
    // ignore
  }
}

export function clearPersistedGameStorage(): void {
  try {
    const manifestRaw = localStorage.getItem(GAMES_MANIFEST_KEY)
    if (manifestRaw) {
      const parsed = JSON.parse(manifestRaw) as unknown
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { gameIds?: unknown }).gameIds)) {
        for (const id of (parsed as { gameIds: unknown[] }).gameIds) {
          if (typeof id === 'string') {
            localStorage.removeItem(`${GAME_RECORD_KEY_PREFIX}${id}`)
          }
        }
      }
    }
    localStorage.removeItem(GAMES_MANIFEST_KEY)
    localStorage.removeItem(GAME_STORAGE_KEY)
    localStorage.removeItem(GAME_OWNER_KEY)
    localStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    // ignore
  }
}

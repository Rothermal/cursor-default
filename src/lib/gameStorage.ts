/** Persisted game state key; clear on finalize or sign-out. */
export const GAME_STORAGE_KEY = 'statkeeper_game'
/** User id that owns `statkeeper_game`; prevents cross-account localStorage bleed. */
export const GAME_OWNER_KEY = 'statkeeper_game_owner'
export const PENDING_SYNC_KEY = 'statkeeper_pending_sync'

/** True when stored game belongs to a different signed-in user and must not be loaded. */
export function shouldDiscardStoredGame(storedOwner: string | null, userId: string | null): boolean {
  return Boolean(userId && storedOwner && storedOwner !== userId)
}

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

/** Clear in-progress game keys (sign-out, finalize, owner mismatch). */
export function clearGameStorage(): void {
  try {
    localStorage.removeItem(GAME_STORAGE_KEY)
    localStorage.removeItem(GAME_OWNER_KEY)
    localStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    // ignore
  }
}

export function persistGameState(state: unknown, userId: string | null): void {
  try {
    if (userId) {
      localStorage.setItem(GAME_OWNER_KEY, userId)
    }
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

/** Persisted game state key; clear when finalizing or on sign-out. */
export const GAME_STORAGE_KEY = 'statkeeper_game'
/** User id that owns `statkeeper_game`; prevents cross-account bleed on remount after sign-out. */
export const GAME_OWNER_KEY = 'statkeeper_game_owner'
export const PENDING_SYNC_KEY = 'statkeeper_pending_sync'

export function getGameOwner(): string | null {
  try {
    const owner = localStorage.getItem(GAME_OWNER_KEY)
    return owner && owner.length > 0 ? owner : null
  } catch {
    return null
  }
}

export function setGameOwner(userId: string): void {
  try {
    localStorage.setItem(GAME_OWNER_KEY, userId)
  } catch {
    // ignore
  }
}

/** True when stored game belongs to another user (or legacy save with no owner tag). */
export function shouldDiscardStoredGame(userId: string): boolean {
  try {
    const saved = localStorage.getItem(GAME_STORAGE_KEY)
    if (!saved) return false
    const owner = getGameOwner()
    if (!owner) return true
    return owner !== userId
  } catch {
    return false
  }
}

export function clearGameStorage(): void {
  try {
    localStorage.removeItem(GAME_STORAGE_KEY)
    localStorage.removeItem(GAME_OWNER_KEY)
    localStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    // ignore
  }
}

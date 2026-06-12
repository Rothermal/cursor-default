/** Keys for persisted in-progress game state (single active game). */
export const GAME_STORAGE_KEY = 'statkeeper_game'
export const GAME_OWNER_KEY = 'statkeeper_game_owner'
export const PENDING_SYNC_KEY = 'statkeeper_pending_sync'

export function getStoredGameOwner(): string | null {
  try {
    const owner = localStorage.getItem(GAME_OWNER_KEY)
    return owner && owner.length > 0 ? owner : null
  } catch {
    return null
  }
}

export function setStoredGameOwner(userId: string | null): void {
  try {
    if (userId) {
      localStorage.setItem(GAME_OWNER_KEY, userId)
    } else {
      localStorage.removeItem(GAME_OWNER_KEY)
    }
  } catch {
    // ignore
  }
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

/** Clear all persisted game progress (e.g. sign-out or finalize). */
export function clearGameLocalStorage(): void {
  try {
    localStorage.removeItem(GAME_STORAGE_KEY)
    localStorage.removeItem(GAME_OWNER_KEY)
    localStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    // ignore
  }
}

/**
 * When `userId` is set, discard persisted state owned by another account.
 * GameProvider unmounts on sign-out, so remount would otherwise reload the prior user's game.
 */
export function shouldDiscardStoredGameForUser(userId: string | null): boolean {
  if (!userId) return false
  const owner = getStoredGameOwner()
  return owner != null && owner !== userId
}

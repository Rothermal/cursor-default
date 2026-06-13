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

export function setStoredGameOwner(ownerId: string | null): void {
  try {
    if (ownerId) {
      localStorage.setItem(GAME_OWNER_KEY, ownerId)
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

/** Clears persisted in-progress game state (e.g. on sign-out or account switch). */
export function clearPersistedGameState(): void {
  try {
    localStorage.removeItem(GAME_STORAGE_KEY)
    localStorage.removeItem(GAME_OWNER_KEY)
    localStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    // ignore
  }
}

/** Keys for persisted in-progress game state (single active game). */
export const GAME_STORAGE_KEY = 'statkeeper_game'
export const GAME_OWNER_STORAGE_KEY = 'statkeeper_game_owner'
export const PENDING_SYNC_KEY = 'statkeeper_pending_sync'

/** Clear local game snapshot so another account on the same device cannot resume it. */
export function clearPersistedGameState(): void {
  try {
    localStorage.removeItem(GAME_STORAGE_KEY)
    localStorage.removeItem(GAME_OWNER_STORAGE_KEY)
    localStorage.removeItem(PENDING_SYNC_KEY)
  } catch {
    // ignore
  }
}

export function readGameOwnerId(): string | null {
  try {
    const value = localStorage.getItem(GAME_OWNER_STORAGE_KEY)
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function writeGameOwnerId(userId: string): void {
  try {
    localStorage.setItem(GAME_OWNER_STORAGE_KEY, userId)
  } catch {
    // ignore
  }
}

/**
 * When Supabase auth is enabled, only load a persisted snapshot if it belongs to
 * the signed-in user. Offline / unconfigured mode has no owner scoping.
 */
export function isPersistedGameOwnedBy(
  userId: string | null,
  isConfigured: boolean
): boolean {
  if (!isConfigured || !userId) return true
  const owner = readGameOwnerId()
  if (!owner) return true
  return owner === userId
}

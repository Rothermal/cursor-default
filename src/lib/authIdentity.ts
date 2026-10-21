/**
 * The signed-in account as the Supabase client last reported it, updated synchronously from
 * the auth callbacks before React re-renders. Work that started under one account checks it
 * after every await, so a sign-out or account switch stops that work before it writes to the
 * cloud as the new account or reads the old account's local storage (which would clear the
 * new account's parked games).
 */
let currentAuthUserId: string | null | undefined
let authGeneration = 0

export interface AuthIdentitySnapshot {
  readonly userId: string
  readonly generation: number
}

/** Called by `AuthContext` whenever the client reports a session (or none). */
export function setCurrentAuthUserId(userId: string | null): void {
  if (currentAuthUserId !== userId) authGeneration += 1
  currentAuthUserId = userId
}

/** Strict opt-in lifetime guard. Unlike the legacy helper, an unknown session is not current. */
export function captureAuthIdentity(userId: string): AuthIdentitySnapshot | null {
  return userId && currentAuthUserId === userId ? { userId, generation: authGeneration } : null
}

export function isCurrentAuthIdentity(identity: AuthIdentitySnapshot): boolean {
  return currentAuthUserId === identity.userId && authGeneration === identity.generation
}

/** True until the first session report, and afterwards only for the reported account. */
export function isCurrentAuthUser(userId: string | null): boolean {
  return currentAuthUserId === undefined || currentAuthUserId === userId
}

/** Test helper: forget the reported session. */
export function resetCurrentAuthUserIdForTests(): void {
  authGeneration += 1
  currentAuthUserId = undefined
}

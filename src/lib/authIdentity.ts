/**
 * The signed-in account as the Supabase client last reported it, updated synchronously from
 * the auth callbacks before React re-renders. Work that started under one account checks it
 * after every await, so a sign-out or account switch stops that work before it writes to the
 * cloud as the new account or reads the old account's local storage (which would clear the
 * new account's parked games).
 */
let currentAuthUserId: string | null | undefined

/** Called by `AuthContext` whenever the client reports a session (or none). */
export function setCurrentAuthUserId(userId: string | null): void {
  currentAuthUserId = userId
}

/** True until the first session report, and afterwards only for the reported account. */
export function isCurrentAuthUser(userId: string | null): boolean {
  return currentAuthUserId === undefined || currentAuthUserId === userId
}

/** Test helper: forget the reported session. */
export function resetCurrentAuthUserIdForTests(): void {
  currentAuthUserId = undefined
}

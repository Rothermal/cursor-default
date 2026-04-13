/** True if `id` looks like a Postgres `uuid` (avoids passing local pseudo-ids to `.eq('id', …)`). */
export function isValidRemotePlayerUuid(id: string | undefined | null): id is string {
  if (!id || typeof id !== 'string') return false
  const s = id.trim()
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
}

/** Drops map entries whose values are not cloud UUIDs (fixes persisted `__team_home__` → `__team_home__`). */
export function sanitizePlayerIdMapForCloud(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [localId, remoteId] of Object.entries(map)) {
    if (isValidRemotePlayerUuid(remoteId)) {
      out[localId] = remoteId
    }
  }
  return out
}

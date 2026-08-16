import type { ParkedGameSummary } from '../gameParking'

export type EventRecorderOpenSource<T> =
  | { kind: 'local'; localGameId: string }
  | { kind: 'cloud'; state: T }
  | { kind: 'empty' }

export function matchingEventLocalBinding(
  sportId: string,
  gameId: string,
  activeLocalGameId: string | null,
  parkedGames: ParkedGameSummary[]
): ParkedGameSummary | null {
  const matches = parkedGames.filter(
    game => game.sportId === sportId && game.cloudGameId === gameId
  )
  return matches.sort((left, right) => {
    const leftActive = left.localGameId === activeLocalGameId ? 1 : 0
    const rightActive = right.localGameId === activeLocalGameId ? 1 : 0
    if (leftActive !== rightActive) return rightActive - leftActive
    if (left.syncDirty !== right.syncDirty) return Number(right.syncDirty) - Number(left.syncDirty)
    return right.updatedAt.localeCompare(left.updatedAt)
  })[0] ?? null
}

export async function resolveEventRecorderOpenSource<T>(
  sportId: string,
  gameId: string,
  activeLocalGameId: string | null,
  parkedGames: ParkedGameSummary[],
  loadCloud: () => Promise<T | null>
): Promise<EventRecorderOpenSource<T>> {
  const local = matchingEventLocalBinding(sportId, gameId, activeLocalGameId, parkedGames)
  if (local) return { kind: 'local', localGameId: local.localGameId }

  const cloud = await loadCloud()
  return cloud ? { kind: 'cloud', state: cloud } : { kind: 'empty' }
}

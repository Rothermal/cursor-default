import type { ParkedGameSummary } from '../gameParking'

export type SoccerRecorderOpenSource<T> =
  | { kind: 'local'; localGameId: string }
  | { kind: 'cloud'; state: T }
  | { kind: 'empty' }

function matchingLocalBinding(
  gameId: string,
  activeLocalGameId: string | null,
  parkedGames: ParkedGameSummary[]
): ParkedGameSummary | null {
  const matches = parkedGames.filter(
    game =>
      game.sportId === 'soccer' &&
      game.cloudGameId === gameId
  )
  return matches.sort((left, right) => {
    const leftActive = left.localGameId === activeLocalGameId ? 1 : 0
    const rightActive = right.localGameId === activeLocalGameId ? 1 : 0
    if (leftActive !== rightActive) return rightActive - leftActive
    if (left.syncDirty !== right.syncDirty) return Number(right.syncDirty) - Number(left.syncDirty)
    return right.updatedAt.localeCompare(left.updatedAt)
  })[0] ?? null
}

export async function resolveSoccerRecorderOpenSource<T>(
  gameId: string,
  activeLocalGameId: string | null,
  parkedGames: ParkedGameSummary[],
  loadCloud: () => Promise<T | null>
): Promise<SoccerRecorderOpenSource<T>> {
  const local = matchingLocalBinding(gameId, activeLocalGameId, parkedGames)
  if (local) return { kind: 'local', localGameId: local.localGameId }

  const cloud = await loadCloud()
  return cloud ? { kind: 'cloud', state: cloud } : { kind: 'empty' }
}

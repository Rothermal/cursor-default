import type { ParkedGameSummary } from '../gameParking'
import {
  resolveEventRecorderOpenSource,
  type EventRecorderOpenSource,
} from '../gameEvents/cloudOpen'

export type SoccerRecorderOpenSource<T> = EventRecorderOpenSource<T>

export async function resolveSoccerRecorderOpenSource<T>(
  gameId: string,
  activeLocalGameId: string | null,
  parkedGames: ParkedGameSummary[],
  loadCloud: () => Promise<T | null>
): Promise<SoccerRecorderOpenSource<T>> {
  return resolveEventRecorderOpenSource(
    'soccer',
    gameId,
    activeLocalGameId,
    parkedGames,
    loadCloud
  )
}

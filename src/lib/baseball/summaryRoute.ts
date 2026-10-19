import { supabase } from '../supabase'

export interface BaseballSummaryRouteDependencies {
  loadSport: (gameId: string) => Promise<string | null>
  loadSetupSport: (gameId: string) => Promise<string | null>
}

const dependencies: BaseballSummaryRouteDependencies = {
  async loadSport(gameId) {
    if (!supabase) throw new Error('Cloud game review is unavailable.')
    const { data, error } = await supabase.from('games').select('id,sport_id').eq('id', gameId).maybeSingle()
    if (error) throw new Error(`Game identity could not load: ${error.message}`)
    if (!data || data.id !== gameId || (data.sport_id !== null && typeof data.sport_id !== 'string')) {
      throw new Error('This cloud game is unavailable.')
    }
    return data.sport_id
  },
  async loadSetupSport(gameId) {
    if (!supabase) throw new Error('Cloud game review is unavailable.')
    const { data, error } = await supabase.from('game_event_setup_snapshots').select('sport_id').eq('game_id', gameId).maybeSingle()
    if (error) throw new Error(`Game authority could not load: ${error.message}`)
    if (!data) return null
    if (typeof data.sport_id !== 'string' || !data.sport_id) throw new Error('The cloud event setup identity is unreadable.')
    return data.sport_id
  },
}

/** Metadata only: no recorder, legacy stats, local game or storage reads. Errors never fall through. */
export async function resolveBaseballCloudSummaryRoute(
  gameId: string,
  requestedSport: string | null,
  deps: BaseballSummaryRouteDependencies = dependencies,
  assertCurrent: () => void = () => {},
): Promise<'baseball' | 'other' | 'legacy'> {
  assertCurrent()
  const sport = await deps.loadSport(gameId)
  assertCurrent()
  const setupSport = await deps.loadSetupSport(gameId)
  assertCurrent()
  if (setupSport === 'baseball') {
    if (sport && sport !== 'baseball') throw new Error('The cloud Baseball game has an incompatible event setup identity.')
    return 'baseball'
  }
  if (sport === 'baseball') {
    if (setupSport) throw new Error('The cloud Baseball game has an incompatible event setup identity.')
    return 'legacy'
  }
  if (requestedSport === 'baseball') throw new Error('This cloud game is not Baseball.')
  return 'other'
}

import { supabase } from '../supabase'

export type BaseballCloudGameStatus = 'scheduled' | 'in_progress' | 'final'

/** Status only: never load another recorder's history into a local binding. */
export async function loadBaseballCloudGameStatus(gameId: string): Promise<BaseballCloudGameStatus> {
  if (!supabase) throw new Error('Baseball cloud status requires Supabase configuration.')
  const { data, error } = await supabase.from('games').select('id,sport_id,status').eq('id', gameId).maybeSingle()
  if (error) throw new Error(`Baseball cloud status could not load: ${error.message}`)
  if (!data || data.id !== gameId || data.sport_id !== 'baseball' ||
    !['scheduled', 'in_progress', 'final'].includes(data.status)) {
    throw new Error('The Baseball cloud game status is unavailable.')
  }
  return data.status as BaseballCloudGameStatus
}

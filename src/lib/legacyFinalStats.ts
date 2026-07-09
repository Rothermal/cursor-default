import type { SupabaseClient } from '@supabase/supabase-js'

export type LegacyFinalGameRow = {
  id: string
  status: string
  home_team_score?: number | null
}

/**
 * For finalized games that predate stored `home_team_score`, batch-load
 * `get_game_stats_resolved` and sum values by `stat_id` per game.
 * Games that error are omitted from the result (callers keep null home scores).
 */
export async function loadLegacyFinalStatsTotals(
  supabase: SupabaseClient,
  games: LegacyFinalGameRow[]
): Promise<Record<string, Record<string, number>>> {
  const legacyFinals = games.filter(
    game => game.status === 'final' && game.home_team_score == null
  )
  if (legacyFinals.length === 0) return {}

  const totals: Record<string, Record<string, number>> = {}
  await Promise.all(
    legacyFinals.map(async game => {
      const { data, error: statsError } = await supabase.rpc('get_game_stats_resolved', {
        p_game_id: game.id,
      })
      if (statsError) return
      totals[game.id] = {}
      for (const row of (data ?? []) as { stat_id: string; value: number }[]) {
        totals[game.id][row.stat_id] =
          (totals[game.id][row.stat_id] ?? 0) + Number(row.value)
      }
    })
  )
  return totals
}

import type { SupabaseClient } from '@supabase/supabase-js'

export type GameSetupRouteTarget =
  | 'soccer'
  | 'hockey_events'
  | 'baseball_events'
  | 'generic'
  | 'resolve_team_sport'

export interface GameSetupRouteInput {
  requestedSport: string | null
  eventsRequested: boolean
  teamId: string | null
  activeSportId: string | null
  hockeyNewGamesUseEvents: boolean
  /** A team-only link's team sport: undefined while loading, null when it could not be read. */
  teamSportId?: string | null
}

/**
 * Picks the setup page for `/setup`. A team-only link (`teamId` without `sport`) while a
 * Soccer game is mounted resolves the team's sport first, so a Hockey or other team does
 * not fall into the active Soccer setup (HKY-6C). The other cases are unchanged.
 */
export function gameSetupRouteTarget(input: GameSetupRouteInput): GameSetupRouteTarget {
  const { requestedSport, eventsRequested, teamId, activeSportId, hockeyNewGamesUseEvents } = input
  if (requestedSport === 'soccer') return 'soccer'
  if (requestedSport === 'hockey' && (eventsRequested || hockeyNewGamesUseEvents)) return 'hockey_events'
  if (requestedSport === 'baseball' && eventsRequested) return 'baseball_events'
  if (requestedSport) return 'generic'
  if (activeSportId !== 'soccer') return 'generic'
  if (!teamId) return 'soccer'
  const { teamSportId } = input
  if (teamSportId === undefined) return 'resolve_team_sport'
  // An unreadable team keeps the earlier behavior: the active Soccer setup.
  if (teamSportId === null || teamSportId === 'soccer') return 'soccer'
  if (teamSportId === 'hockey' && hockeyNewGamesUseEvents) return 'hockey_events'
  return 'generic'
}

/** The sport a team plays, or null when it cannot be read. Never changes anything. */
export async function loadTeamSportId(
  client: SupabaseClient | null,
  teamId: string
): Promise<string | null> {
  if (!client) return null
  try {
    const { data, error } = await client
      .from('teams')
      .select('id,seasons!inner(sport)')
      .eq('id', teamId)
      .single()
    if (error || !data) return null
    const sport = (data as unknown as { seasons?: { sport?: unknown } }).seasons?.sport
    return typeof sport === 'string' ? sport : null
  } catch {
    return null
  }
}

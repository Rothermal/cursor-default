import type { SupabaseClient } from '@supabase/supabase-js'

export type GameSetupRouteTarget =
  | 'soccer'
  | 'hockey_events'
  | 'baseball_events'
  | 'generic'
  | 'resolve_team_sport'
  | 'unavailable_team'

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
 * Resolve team authority before using a sport parameter or the unrelated active game.
 * Stale events/preview parameters cannot restore retired Baseball creation.
 */
export function gameSetupRouteTarget(input: GameSetupRouteInput): GameSetupRouteTarget {
  const { requestedSport, eventsRequested, teamId, activeSportId, hockeyNewGamesUseEvents } = input
  if (teamId) {
    if (input.teamSportId === undefined) return 'resolve_team_sport'
    if (!input.teamSportId || !['soccer', 'basketball', 'hockey', 'baseball', 'football'].includes(input.teamSportId)
      || (requestedSport && input.teamSportId !== requestedSport)) return 'unavailable_team'
  }
  const sport = teamId ? input.teamSportId : requestedSport ?? activeSportId
  if (sport === 'baseball') return 'baseball_events'
  if (sport === 'soccer') return 'soccer'
  if (sport === 'hockey' && (eventsRequested || hockeyNewGamesUseEvents)) return 'hockey_events'
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

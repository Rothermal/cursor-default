import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterRefreshRosterRow } from './rosterRefresh'
import { normalizeRosterLabel } from './rosterRefresh'

interface TeamRosterRow {
  player_id: string
  jersey_number: string | null
  position: string | null
  is_active: boolean | null
  players: { first_name: string | null; last_name: string | null } | null
}

export function parseTeamRosterRows(rows: unknown[]): RosterRefreshRosterRow[] {
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const row = value as TeamRosterRow
    if (typeof row.player_id !== 'string') return []
    const name = `${row.players?.first_name ?? ''} ${row.players?.last_name ?? ''}`.trim()
    return [{
      playerId: row.player_id,
      name: name || 'Player',
      number: normalizeRosterLabel(row.jersey_number),
      position: normalizeRosterLabel(row.position),
      isActive: row.is_active !== false,
    }]
  })
}

/** RTN-2: the team's current roster (active and inactive) for a roster refresh. */
export async function loadTeamRosterSnapshot(client: SupabaseClient, teamId: string): Promise<RosterRefreshRosterRow[]> {
  const { data, error } = await client
    .from('team_players')
    .select('player_id, jersey_number, position, is_active, players!inner(first_name, last_name)')
    .eq('team_id', teamId)
    .order('joined_at', { ascending: true })
  if (error) throw new Error(`Team roster could not load: ${error.message}`)
  return parseTeamRosterRows((data ?? []) as unknown[])
}

/** "Also update team roster": write a game-side number/position change back to the team. */
export async function updateTeamRosterDetails(
  client: SupabaseClient,
  teamId: string,
  playerId: string,
  details: { number: string | null; position: string | null }
): Promise<void> {
  const { data, error } = await client
    .from('team_players')
    .update({ jersey_number: normalizeRosterLabel(details.number), position: normalizeRosterLabel(details.position) })
    .eq('team_id', teamId)
    .eq('player_id', playerId)
    .select('player_id')
  if (error) throw new Error(`Team roster could not be updated: ${error.message}`)
  if (!data || data.length === 0) throw new Error('You cannot change this team roster, or the player is no longer on it.')
}

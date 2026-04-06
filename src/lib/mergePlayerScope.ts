import type { SupabaseClient } from '@supabase/supabase-js'

export interface MergePlayerCandidate {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
}

/**
 * Teams where the user is owner (teams.owner_id) or team_members owner/admin.
 * Distinct players on those teams (for merge wizard candidate list).
 * Excludes `players.is_team_placeholder` when that column exists (migration 028).
 */
export async function fetchMergePlayerScope(
  supabase: SupabaseClient,
  userId: string
): Promise<{ teamIds: string[]; candidates: MergePlayerCandidate[] }> {
  const adminTeamIds = new Set<string>()
  const { data: memRows } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
  for (const row of (memRows ?? []) as { team_id: string }[]) {
    adminTeamIds.add(row.team_id)
  }
  const { data: ownedRows } = await supabase.from('teams').select('id').eq('owner_id', userId)
  for (const row of (ownedRows ?? []) as { id: string }[]) {
    adminTeamIds.add(row.id)
  }
  const teamIds = [...adminTeamIds]
  if (teamIds.length === 0) {
    return { teamIds: [], candidates: [] }
  }
  const selectWithFlag =
    'player_id, players!inner(id,first_name,last_name,nickname,is_team_placeholder)'
  const selectLegacy = 'player_id, players!inner(id,first_name,last_name,nickname)'

  let tpRows: unknown[] | null = null
  {
    const first = await supabase.from('team_players').select(selectWithFlag).in('team_id', teamIds)
    if (
      first.error &&
      first.error.message?.includes('is_team_placeholder') &&
      first.error.message?.includes('column')
    ) {
      const second = await supabase.from('team_players').select(selectLegacy).in('team_id', teamIds)
      if (second.error) {
        return { teamIds, candidates: [] }
      }
      tpRows = second.data ?? []
    } else if (first.error) {
      return { teamIds, candidates: [] }
    } else {
      tpRows = first.data ?? []
    }
  }

  type TpJoin = {
    player_id: string
    players: {
      id: string
      first_name: string
      last_name: string | null
      nickname: string | null
      is_team_placeholder?: boolean | null
    }
  }
  const byId = new Map<string, MergePlayerCandidate>()
  for (const row of (tpRows ?? []) as unknown as TpJoin[]) {
    const p = row.players
    if (p.is_team_placeholder === true) continue
    if (!byId.has(p.id)) {
      byId.set(p.id, {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        nickname: p.nickname,
      })
    }
  }
  return { teamIds, candidates: [...byId.values()] }
}

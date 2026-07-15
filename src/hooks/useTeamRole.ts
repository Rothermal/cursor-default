import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { parseTeamRole, type TeamRole } from '../lib/teamPermissions'
import { supabase } from '../lib/supabase'

export function useTeamRole(teamId: string | null | undefined): TeamRole | null {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [result, setResult] = useState<{
    teamId: string | null
    role: TeamRole | null
  }>({ teamId: null, role: null })

  useEffect(() => {
    if (!teamId || !userId || !isConfigured || !supabase) {
      setResult({ teamId: null, role: null })
      return
    }

    const client = supabase
    let cancelled = false
    const loadRole = async () => {
      const { data, error } = await client.rpc('current_team_role', {
        p_team_id: teamId,
      })
      if (!cancelled && !error) {
        setResult({ teamId, role: parseTeamRole(data) })
      }
    }

    void loadRole()
    return () => {
      cancelled = true
    }
  }, [isConfigured, teamId, userId])

  return result.teamId === teamId ? result.role : null
}

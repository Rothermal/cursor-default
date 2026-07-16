import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { parseTeamRole, type TeamRole } from '../lib/teamPermissions'
import { supabase } from '../lib/supabase'

interface TeamRoleResult {
  role: TeamRole | null
  loading: boolean
  error: string | null
}

export function useTeamRole(teamId: string | null | undefined): TeamRoleResult {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [result, setResult] = useState<{
    teamId: string | null
    role: TeamRole | null
    loading: boolean
    error: string | null
  }>({ teamId: null, role: null, loading: false, error: null })

  useEffect(() => {
    if (!teamId) {
      setResult({ teamId: null, role: null, loading: false, error: null })
      return
    }
    if (!userId || !isConfigured || !supabase) {
      setResult({
        teamId,
        role: null,
        loading: false,
        error: 'Unable to verify team access.',
      })
      return
    }

    const client = supabase
    let cancelled = false
    const loadRole = async () => {
      setResult({ teamId, role: null, loading: true, error: null })
      const { data, error } = await client.rpc('current_team_role', {
        p_team_id: teamId,
      })
      if (cancelled) return
      if (error) {
        setResult({ teamId, role: null, loading: false, error: error.message })
        return
      }
      setResult({ teamId, role: parseTeamRole(data), loading: false, error: null })
    }

    void loadRole()
    return () => {
      cancelled = true
    }
  }, [isConfigured, teamId, userId])

  if (!teamId) return { role: null, loading: false, error: null }
  if (result.teamId !== teamId) return { role: null, loading: true, error: null }
  return { role: result.role, loading: result.loading, error: result.error }
}

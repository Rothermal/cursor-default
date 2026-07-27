import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { parseTeamRole, type TeamRole } from '../lib/teamPermissions'
import { supabase } from '../lib/supabase'

export interface TeamRoleResult {
  role: TeamRole | null
  loading: boolean
  error: string | null
}

interface StoredTeamRoleResult extends TeamRoleResult {
  teamId: string | null
}

/**
 * Fail closed across team switches: never surface a prior team's role while the
 * requested team is still loading.
 */
export function selectTeamRoleView(
  requestedTeamId: string | null | undefined,
  stored: StoredTeamRoleResult
): TeamRoleResult {
  if (!requestedTeamId) return { role: null, loading: false, error: null }
  if (stored.teamId !== requestedTeamId) return { role: null, loading: true, error: null }
  return { role: stored.role, loading: stored.loading, error: stored.error }
}

export function useTeamRole(teamId: string | null | undefined): TeamRoleResult {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [result, setResult] = useState<StoredTeamRoleResult>({
    teamId: null,
    role: null,
    loading: false,
    error: null,
  })

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

  return selectTeamRoleView(teamId, result)
}

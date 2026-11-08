import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { listOpponentTeams, type OpponentTeam } from '../lib/opponentTeams'

export interface SavedOpponentsState {
  opponents: OpponentTeam[]
  loading: boolean
  error: string | null
  reload: () => void
  replace: (next: OpponentTeam[]) => void
}

/** Saved opponents for this account and sport (RTN-1). Disabled without a signed-in cloud session. */
export function useSavedOpponents(sportId: string | null, enabled: boolean): SavedOpponentsState {
  const [opponents, setOpponents] = useState<OpponentTeam[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled || !sportId || !supabase) {
      setOpponents([])
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    listOpponentTeams(supabase, sportId)
      .then(rows => { if (!cancelled) setOpponents(rows) })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Saved opponents could not be loaded.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, sportId, attempt])

  const reload = useCallback(() => setAttempt(value => value + 1), [])
  return { opponents, loading, error, reload, replace: setOpponents }
}

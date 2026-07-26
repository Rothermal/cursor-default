import { useCallback, useEffect, useMemo, useState } from 'react'
import { playerDisplayName } from '../lib/display'
import {
  loadSoccerCanonicalAggregates,
  SoccerAggregateTransportError,
  type SoccerAggregateLoadProgress,
  type SoccerAggregateLoadResult,
  type SoccerCanonicalAggregateLoadScope,
} from '../lib/soccer/aggregateTransport'
import type { SoccerAggregateRosterPlayer } from '../lib/soccer/aggregateProjection'
import { supabase } from '../lib/supabase'

interface UseSoccerAggregateDestinationOptions {
  scope: SoccerCanonicalAggregateLoadScope | null
  teamIds: string[]
  enabled?: boolean
}

export interface SoccerAggregateDestinationState {
  result: SoccerAggregateLoadResult | null
  progress: SoccerAggregateLoadProgress | null
  loading: boolean
  refreshing: boolean
  error: SoccerAggregateTransportError | null
  refresh: () => void
}

interface RosterJoin {
  team_id: string
  jersey_number: string | null
  players: {
    id: string
    first_name: string
    last_name: string | null
    nickname: string | null
  }
}

export function useSoccerAggregateDestination({
  scope,
  teamIds,
  enabled = true,
}: UseSoccerAggregateDestinationOptions): SoccerAggregateDestinationState {
  const [result, setResult] = useState<SoccerAggregateLoadResult | null>(null)
  const [resultLoadKey, setResultLoadKey] = useState<string | null>(null)
  const [progress, setProgress] = useState<SoccerAggregateLoadProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<SoccerAggregateTransportError | null>(null)
  const [errorLoadKey, setErrorLoadKey] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const scopeKey = useMemo(() => JSON.stringify(scope), [scope])
  const hasScope = scopeKey !== 'null'
  const teamKey = useMemo(
    () => [...new Set(teamIds)].sort().join(','),
    [teamIds]
  )
  const refresh = useCallback(() => {
    setReloadVersion(version => version + 1)
  }, [])
  const loadKey = hasScope ? `${scopeKey}:${teamKey}` : null

  useEffect(() => {
    if (!enabled || !loadKey || !supabase) {
      setLoading(false)
      setResult(null)
      setResultLoadKey(null)
      setProgress(null)
      return
    }

    const controller = new AbortController()
    let current = true
    const load = async () => {
      setLoading(true)
      setError(null)
      setProgress({
        stage: 'loading',
        pageCount: 0,
        publicationCount: 0,
        projectedCount: 0,
        projectionTotal: 0,
      })
      try {
        const activeRoster = await loadActiveRoster(teamKey, controller.signal)
        const loaded = await loadSoccerCanonicalAggregates(
          JSON.parse(scopeKey) as SoccerCanonicalAggregateLoadScope,
          {
            signal: controller.signal,
            activeRoster,
            onProgress: next => {
              if (current) setProgress(next)
            },
          }
        )
        if (!current) return
        setResult(loaded)
        setResultLoadKey(loadKey)
        setError(null)
        setErrorLoadKey(null)
      } catch (caught) {
        if (!current) return
        const normalized = normalizeDestinationError(caught)
        if (normalized.code === 'aborted') return
        setError(normalized)
        setErrorLoadKey(loadKey)
      } finally {
        if (current) setLoading(false)
      }
    }

    void load()
    return () => {
      current = false
      controller.abort()
    }
  }, [enabled, loadKey, reloadVersion, scopeKey, teamKey])

  useEffect(() => {
    if (!enabled || !hasScope) return
    let lastReloadAt = 0
    const reloadVisible = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastReloadAt < 250) return
      lastReloadAt = now
      refresh()
    }
    window.addEventListener('focus', reloadVisible)
    document.addEventListener('visibilitychange', reloadVisible)
    return () => {
      window.removeEventListener('focus', reloadVisible)
      document.removeEventListener('visibilitychange', reloadVisible)
    }
  }, [enabled, hasScope, refresh, scopeKey])

  const visibleResult = resultLoadKey === loadKey ? result : null
  return {
    result: visibleResult,
    progress,
    loading,
    refreshing: loading && visibleResult !== null,
    error: errorLoadKey === loadKey ? error : null,
    refresh,
  }
}

async function loadActiveRoster(
  teamKey: string,
  signal: AbortSignal
): Promise<SoccerAggregateRosterPlayer[]> {
  const teamIds = teamKey ? teamKey.split(',') : []
  if (teamIds.length === 0 || !supabase) return []
  const response = await supabase
    .from('team_players')
    .select('team_id,jersey_number,players!inner(id,first_name,last_name,nickname)')
    .in('team_id', teamIds)
    .eq('is_active', true)
    .abortSignal(signal)
  if (response.error) {
    throw new SoccerAggregateTransportError(
      response.error.code === '42501' ? 'access_denied' : 'transport',
      response.error.code === '42501'
        ? 'You do not have access to this soccer roster.'
        : 'The active soccer roster could not load.',
      response.error
    )
  }
  return ((response.data ?? []) as unknown as RosterJoin[]).map(row => ({
    playerId: row.players.id,
    displayName: playerDisplayName(row.players),
    number: row.jersey_number,
    teamId: row.team_id,
  }))
}

function normalizeDestinationError(error: unknown): SoccerAggregateTransportError {
  if (error instanceof SoccerAggregateTransportError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new SoccerAggregateTransportError('aborted', 'Soccer aggregate load was cancelled.')
  }
  return new SoccerAggregateTransportError(
    'transport',
    'Soccer aggregate data could not load.',
    error
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playerDisplayName } from '../lib/display'
import { shouldAutoRefreshSoccerAggregates } from '../lib/soccer/aggregateDestinations'
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
  rosterWarning: string | null
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
  const [rosterWarning, setRosterWarning] = useState<string | null>(null)
  const [warningLoadKey, setWarningLoadKey] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const loadingRef = useRef(false)
  const scopeKey = useMemo(() => JSON.stringify(scope), [scope])
  const hasScope = scopeKey !== 'null'
  const teamKey = useMemo(
    () => [...new Set(teamIds)].sort().join(','),
    [teamIds]
  )
  const refresh = useCallback(() => {
    setReloadVersion(version => version + 1)
  }, [])
  const setLoadingState = useCallback((next: boolean) => {
    loadingRef.current = next
    setLoading(next)
  }, [])
  const loadKey = hasScope ? `${scopeKey}:${teamKey}` : null

  useEffect(() => {
    if (!enabled || !loadKey) {
      setLoadingState(false)
      setResult(null)
      setResultLoadKey(null)
      setProgress(null)
      setError(null)
      setErrorLoadKey(null)
      setRosterWarning(null)
      setWarningLoadKey(null)
      return
    }
    if (!supabase) {
      setLoadingState(false)
      setResult(null)
      setResultLoadKey(null)
      setProgress(null)
      setError(new SoccerAggregateTransportError(
        'not_configured',
        'Supabase is not configured.'
      ))
      setErrorLoadKey(loadKey)
      setRosterWarning(null)
      setWarningLoadKey(null)
      return
    }

    const controller = new AbortController()
    let current = true
    const load = async () => {
      setLoadingState(true)
      setError(null)
      setRosterWarning(null)
      setProgress({
        stage: 'loading',
        pageCount: 0,
        publicationCount: 0,
        projectedCount: 0,
        projectionTotal: 0,
      })
      try {
        const loaded = await loadSoccerAggregateDestinationData(
          JSON.parse(scopeKey) as SoccerCanonicalAggregateLoadScope,
          teamKey,
          controller.signal,
          next => {
            if (current) setProgress(next)
          }
        )
        if (!current) return
        setResult(loaded.result)
        setResultLoadKey(loadKey)
        setRosterWarning(loaded.rosterWarning)
        setWarningLoadKey(loadKey)
        setError(null)
        setErrorLoadKey(null)
      } catch (caught) {
        if (!current) return
        const normalized = normalizeDestinationError(caught)
        if (normalized.code === 'aborted') return
        setError(normalized)
        setErrorLoadKey(loadKey)
      } finally {
        if (current) setLoadingState(false)
      }
    }

    void load()
    return () => {
      current = false
      controller.abort()
    }
  }, [enabled, loadKey, reloadVersion, scopeKey, setLoadingState, teamKey])

  useEffect(() => {
    if (!enabled || !hasScope) return
    let lastReloadAt = 0
    const reloadVisible = () => {
      const now = Date.now()
      if (!shouldAutoRefreshSoccerAggregates({
        loading: loadingRef.current,
        visible: document.visibilityState === 'visible',
        now,
        lastRefreshAt: lastReloadAt,
      })) return
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
    rosterWarning: warningLoadKey === loadKey ? rosterWarning : null,
    refresh,
  }
}

interface SoccerAggregateDestinationLoadDependencies {
  rosterLoader?: typeof loadActiveRoster
  aggregateLoader?: typeof loadSoccerCanonicalAggregates
}

export async function loadSoccerAggregateDestinationData(
  scope: SoccerCanonicalAggregateLoadScope,
  teamKey: string,
  signal: AbortSignal,
  onProgress?: (progress: SoccerAggregateLoadProgress) => void,
  dependencies: SoccerAggregateDestinationLoadDependencies = {}
): Promise<{
  result: SoccerAggregateLoadResult
  rosterWarning: string | null
}> {
  const rosterLoader = dependencies.rosterLoader ?? loadActiveRoster
  const aggregateLoader = dependencies.aggregateLoader ?? loadSoccerCanonicalAggregates
  let activeRoster: SoccerAggregateRosterPlayer[] = []
  let rosterWarning: string | null = null
  try {
    activeRoster = await rosterLoader(teamKey, signal)
  } catch (error) {
    const normalized = normalizeDestinationError(error)
    if (signal.aborted || normalized.code === 'aborted') throw normalized
    rosterWarning =
      'Current roster could not load. Zero-appearance players may be missing.'
  }
  const result = await aggregateLoader(scope, {
    signal,
    activeRoster,
    onProgress,
  })
  return { result, rosterWarning }
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playerDisplayName } from '../lib/display'
import { shouldAutoRefreshBasketballAggregates } from '../lib/basketball/aggregateDestinations'
import {
  loadBasketballAggregates,
  BasketballAggregateTransportError,
  type BasketballAggregateLoadProgress,
  type BasketballAggregateLoadResult,
  type BasketballAggregateLoadScope,
} from '../lib/basketball/aggregateTransport'
import type { BasketballAggregateRosterPlayer } from '../lib/basketball/aggregateComposition'
import { supabase } from '../lib/supabase'

interface UseBasketballAggregateDestinationOptions {
  scope: BasketballAggregateLoadScope | null
  teamIds: string[]
  enabled?: boolean
}

export interface BasketballAggregateDestinationState {
  result: BasketballAggregateLoadResult | null
  progress: BasketballAggregateLoadProgress | null
  loading: boolean
  refreshing: boolean
  error: BasketballAggregateTransportError | null
  rosterWarning: string | null
  refresh: () => void
}

interface RosterJoin {
  team_id: string
  jersey_number: string | null
  teams: { season_id: string }
  players: {
    id: string
    first_name: string
    last_name: string | null
    nickname: string | null
  }
}

export function useBasketballAggregateDestination({
  scope,
  teamIds,
  enabled = true,
}: UseBasketballAggregateDestinationOptions): BasketballAggregateDestinationState {
  const [result, setResult] = useState<BasketballAggregateLoadResult | null>(null)
  const [resultLoadKey, setResultLoadKey] = useState<string | null>(null)
  const [progress, setProgress] = useState<BasketballAggregateLoadProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<BasketballAggregateTransportError | null>(null)
  const [errorLoadKey, setErrorLoadKey] = useState<string | null>(null)
  const [rosterWarning, setRosterWarning] = useState<string | null>(null)
  const [warningLoadKey, setWarningLoadKey] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const loadingRef = useRef(false)
  const lastAutoRefreshAtRef = useRef(0)
  const scopeKey = useMemo(() => JSON.stringify(scope), [scope])
  const teamKey = useMemo(() => [...new Set(teamIds)].sort().join(','), [teamIds])
  const loadKey = scope ? `${scopeKey}:${teamKey}` : null

  const refresh = useCallback(() => setReloadVersion(version => version + 1), [])
  const setLoadingState = useCallback((next: boolean) => {
    loadingRef.current = next
    setLoading(next)
  }, [])

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
      setError(new BasketballAggregateTransportError(
        'not_configured',
        'Supabase is not configured.'
      ))
      setErrorLoadKey(loadKey)
      return
    }

    const controller = new AbortController()
    let current = true
    const load = async () => {
      setLoadingState(true)
      setError(null)
      setRosterWarning(null)
      setProgress(emptyProgress())
      try {
        const loaded = await loadBasketballAggregateDestinationData(
          JSON.parse(scopeKey) as BasketballAggregateLoadScope,
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
    lastAutoRefreshAtRef.current = 0
  }, [scopeKey])

  useEffect(() => {
    if (!enabled || scopeKey === 'null') return
    const reloadVisible = () => {
      const now = Date.now()
      if (!shouldAutoRefreshBasketballAggregates({
        loading: loadingRef.current,
        visible: document.visibilityState === 'visible',
        now,
        lastRefreshAt: lastAutoRefreshAtRef.current,
      })) return
      lastAutoRefreshAtRef.current = now
      refresh()
    }
    window.addEventListener('focus', reloadVisible)
    document.addEventListener('visibilitychange', reloadVisible)
    return () => {
      window.removeEventListener('focus', reloadVisible)
      document.removeEventListener('visibilitychange', reloadVisible)
    }
  }, [enabled, refresh, scopeKey])

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

interface BasketballAggregateDestinationLoadDependencies {
  rosterLoader?: typeof loadActiveRoster
  aggregateLoader?: typeof loadBasketballAggregates
}

export async function loadBasketballAggregateDestinationData(
  scope: BasketballAggregateLoadScope,
  teamKey: string,
  signal: AbortSignal,
  onProgress?: (progress: BasketballAggregateLoadProgress) => void,
  dependencies: BasketballAggregateDestinationLoadDependencies = {}
): Promise<{ result: BasketballAggregateLoadResult; rosterWarning: string | null }> {
  const rosterLoader = dependencies.rosterLoader ?? loadActiveRoster
  const aggregateLoader = dependencies.aggregateLoader ?? loadBasketballAggregates
  let activeRoster: BasketballAggregateRosterPlayer[] = []
  let rosterWarning: string | null = null
  try {
    activeRoster = await rosterLoader(teamKey, signal)
    if (scope.type === 'tournament') {
      activeRoster = activeRoster.map(player => ({
        ...player,
        tournamentId: scope.id,
      }))
    }
  } catch (error) {
    const normalized = normalizeDestinationError(error)
    if (signal.aborted || normalized.code === 'aborted') throw normalized
    rosterWarning = 'Current roster could not load. Zero-appearance players may be missing.'
  }
  const result = await aggregateLoader(scope, { signal, activeRoster, onProgress })
  return { result, rosterWarning }
}

async function loadActiveRoster(
  teamKey: string,
  signal: AbortSignal
): Promise<BasketballAggregateRosterPlayer[]> {
  const teamIds = teamKey ? teamKey.split(',') : []
  if (teamIds.length === 0 || !supabase) return []
  const response = await supabase
    .from('team_players')
    .select('team_id,jersey_number,teams!inner(season_id),players!inner(id,first_name,last_name,nickname)')
    .in('team_id', teamIds)
    .eq('is_active', true)
    .abortSignal(signal)
  if (response.error) {
    throw new BasketballAggregateTransportError(
      response.error.code === '42501' ? 'access_denied' : 'transport',
      response.error.code === '42501'
        ? 'You do not have access to this Basketball roster.'
        : 'The active Basketball roster could not load.',
      response.error
    )
  }
  return ((response.data ?? []) as unknown as RosterJoin[]).map(row => ({
    playerId: row.players.id,
    displayName: playerDisplayName(row.players),
    number: row.jersey_number,
    teamId: row.team_id,
    seasonId: row.teams.season_id,
  }))
}

function normalizeDestinationError(error: unknown): BasketballAggregateTransportError {
  if (error instanceof BasketballAggregateTransportError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new BasketballAggregateTransportError(
      'aborted',
      'Basketball aggregate load was cancelled.'
    )
  }
  return new BasketballAggregateTransportError(
    'transport',
    'Basketball aggregate data could not load.',
    error
  )
}

function emptyProgress(): BasketballAggregateLoadProgress {
  return {
    stage: 'loading',
    canonicalPageCount: 0,
    legacyPageCount: 0,
    canonicalSourceCount: 0,
    legacySourceCount: 0,
    projectedCount: 0,
    projectionTotal: 0,
  }
}

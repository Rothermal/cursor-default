import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shouldAutoRefreshBasketballAggregates } from '../lib/basketball/aggregateDestinations'
import { playerDisplayName } from '../lib/display'
import type { HockeyAggregateRosterPlayer } from '../lib/hockey/aggregateProjection'
import {
  HockeyAggregateTransportError,
  loadHockeyAggregates,
  type HockeyAggregateLoadProgress,
  type HockeyAggregateLoadResult,
  type HockeyAggregateLoadScope,
} from '../lib/hockey/aggregateTransport'
import { supabase } from '../lib/supabase'

/**
 * Loads a Hockey season-stat scope (HKY-6B2) with the active roster for zero rows, and
 * reloads on Refresh and when the page regains focus. A failed refresh keeps the last result.
 */

export interface HockeyAggregateDestinationState {
  result: HockeyAggregateLoadResult | null
  progress: HockeyAggregateLoadProgress | null
  loading: boolean
  error: HockeyAggregateTransportError | null
  rosterWarning: string | null
  refresh: () => void
}

interface RosterJoin {
  team_id: string
  jersey_number: string | null
  teams: { season_id: string }
  players: { id: string; first_name: string; last_name: string | null; nickname: string | null }
}

export function useHockeyAggregateDestination({
  scope,
  teamIds,
  enabled = true,
}: {
  scope: HockeyAggregateLoadScope | null
  teamIds: string[]
  enabled?: boolean
}): HockeyAggregateDestinationState {
  const [loaded, setLoaded] = useState<{ key: string; result: HockeyAggregateLoadResult; rosterWarning: string | null } | null>(null)
  const [failed, setFailed] = useState<{ key: string; error: HockeyAggregateTransportError } | null>(null)
  const [progress, setProgress] = useState<HockeyAggregateLoadProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const loadingRef = useRef(false)
  const lastAutoRefreshAtRef = useRef(0)
  const scopeKey = useMemo(() => JSON.stringify(scope), [scope])
  const teamKey = useMemo(() => [...new Set(teamIds)].sort().join(','), [teamIds])
  const loadKey = enabled && scope ? `${scopeKey}:${teamKey}` : null
  const refresh = useCallback(() => setReloadVersion(version => version + 1), [])

  useEffect(() => {
    if (!loadKey) {
      loadingRef.current = false
      setLoading(false)
      setProgress(null)
      return
    }
    const controller = new AbortController()
    let current = true
    loadingRef.current = true
    setLoading(true)
    setProgress(null)
    void (async () => {
      try {
        const data = await loadHockeyAggregateDestinationData(
          JSON.parse(scopeKey) as HockeyAggregateLoadScope,
          teamKey,
          controller.signal,
          next => { if (current) setProgress(next) }
        )
        if (!current) return
        setLoaded({ key: loadKey, ...data })
        setFailed(null)
      } catch (caught) {
        if (!current) return
        const error = normalizeError(caught)
        if (error.code !== 'aborted') setFailed({ key: loadKey, error })
      } finally {
        if (current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    })()
    return () => {
      current = false
      controller.abort()
    }
  }, [loadKey, reloadVersion, scopeKey, teamKey])

  useEffect(() => {
    if (!loadKey) return
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
  }, [loadKey, refresh])

  const visible = loaded && loaded.key === loadKey ? loaded : null
  return {
    result: visible?.result ?? null,
    progress,
    loading,
    error: failed && failed.key === loadKey ? failed.error : null,
    rosterWarning: visible?.rosterWarning ?? null,
    refresh,
  }
}

export async function loadHockeyAggregateDestinationData(
  scope: HockeyAggregateLoadScope,
  teamKey: string,
  signal: AbortSignal,
  onProgress?: (progress: HockeyAggregateLoadProgress) => void,
  dependencies: { rosterLoader?: typeof loadActiveRoster; aggregateLoader?: typeof loadHockeyAggregates } = {}
): Promise<{ result: HockeyAggregateLoadResult; rosterWarning: string | null }> {
  const rosterLoader = dependencies.rosterLoader ?? loadActiveRoster
  const aggregateLoader = dependencies.aggregateLoader ?? loadHockeyAggregates
  let activeRoster: HockeyAggregateRosterPlayer[] = []
  let rosterWarning: string | null = null
  try {
    activeRoster = await rosterLoader(teamKey, signal)
    if (scope.type === 'tournament') activeRoster = activeRoster.map(player => ({ ...player, tournamentId: scope.id }))
  } catch (error) {
    if (signal.aborted) throw normalizeError(error)
    rosterWarning = 'The current roster could not load, so players with no games may be missing.'
  }
  const result = await aggregateLoader(scope, { signal, activeRoster, onProgress })
  return { result, rosterWarning }
}

async function loadActiveRoster(teamKey: string, signal: AbortSignal): Promise<HockeyAggregateRosterPlayer[]> {
  const teamIds = teamKey ? teamKey.split(',') : []
  if (teamIds.length === 0 || !supabase) return []
  const response = await supabase
    .from('team_players')
    .select('team_id,jersey_number,teams!inner(season_id),players!inner(id,first_name,last_name,nickname)')
    .in('team_id', teamIds)
    .eq('is_active', true)
    .abortSignal(signal)
  if (response.error) throw new HockeyAggregateTransportError('transport', 'The active Hockey roster could not load.', response.error)
  return ((response.data ?? []) as unknown as RosterJoin[]).map(row => ({
    playerId: row.players.id,
    displayName: playerDisplayName(row.players),
    number: row.jersey_number,
    teamId: row.team_id,
    seasonId: row.teams.season_id,
  }))
}

function normalizeError(error: unknown): HockeyAggregateTransportError {
  if (error instanceof HockeyAggregateTransportError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new HockeyAggregateTransportError('aborted', 'The Hockey season-stat load was cancelled.')
  }
  return new HockeyAggregateTransportError('transport', 'Hockey season stats could not load.', error)
}

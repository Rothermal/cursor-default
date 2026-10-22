import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useAuth } from '../context/AuthContext'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../lib/authIdentity'
import { playerDisplayName } from '../lib/display'
import { supabase } from '../lib/supabase'
import { loadBaseballAggregates, type BaseballAggregateLoadResult, type BaseballAggregateProgress } from '../lib/baseball/aggregateTransport'
import type { BaseballAggregateLoadScope, BaseballAggregateRosterPlayer } from '../lib/baseball/aggregateTypes'
import { BaseballFeatureError } from '../lib/baseball/featureClient'
import { loadBaseballLegacyAggregates, type BaseballLegacyResult } from '../lib/baseball/legacyAggregates'
import type { BaseballRulesVariant } from '../lib/baseball/types'

export type BaseballTotalsSource = 'events' | 'legacy'
export type BaseballDestinationResult = { source: 'events'; data: BaseballAggregateLoadResult; seasonNames?: Record<string, string> } | { source: 'legacy'; data: BaseballLegacyResult }
interface Settled { request: object; result: BaseballDestinationResult | null; error: string | null; warning: string | null }
let nextLoadGeneration = 0
export function allocateBaseballRefreshGeneration(): number { return ++nextLoadGeneration }

/** Request object identity deliberately changes on A -> B -> A, including before effects. */
export function useBaseballAggregateDestination(options: {
  scope: BaseballAggregateLoadScope | null; teamIds: string[]; source: BaseballTotalsSource; variant: BaseballRulesVariant
}) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const identity = userId ? captureAuthIdentity(userId) : null
  const [refreshGeneration, setRefreshGeneration] = useState(allocateBaseballRefreshGeneration)
  const [settled, setSettled] = useState<Settled | null>(null)
  const [progress, setProgress] = useState<{ request: object; value: BaseballAggregateProgress } | null>(null)
  const teamKey = [...new Set(options.teamIds)].sort().join(',')
  const key = JSON.stringify([identity, options.scope, teamKey, options.source, options.variant, refreshGeneration])
  const lifetime = useRef({ key, request: {}, generation: refreshGeneration })
  if (lifetime.current.key !== key) lifetime.current = { key, request: {}, generation: allocateBaseballRefreshGeneration() }
  const request = lifetime.current.request
  const loadGeneration = lifetime.current.generation
  const refresh = useCallback(() => setRefreshGeneration(allocateBaseballRefreshGeneration()), [])
  const scopeKey = JSON.stringify(options.scope)
  const source = options.source, variant = options.variant
  useEffect(() => {
    if (!userId || !identity || !options.scope) return
    const controller = new AbortController()
    const current = () => {
      if (controller.signal.aborted || lifetime.current.request !== request || !isCurrentAuthIdentity(identity)) {
        throw new BaseballFeatureError('aborted', 'The Baseball statistics request changed.')
      }
    }
    void loadBaseballDestinationData(JSON.parse(scopeKey), teamKey, {
      userId, source, variant, refreshGeneration: loadGeneration, signal: controller.signal, assertCurrent: current,
      onProgress: value => { current(); setProgress({ request, value }) },
    }).then(data => {
      current()
      setSettled({ request, ...data, error: null })
    }).catch(error => {
      try { current() } catch { return }
      setSettled({ request, result: null, warning: null, error: error instanceof Error ? error.message : 'Baseball statistics could not load.' })
    })
    return () => { controller.abort() }
    // The serialized key includes account epoch, complete scope, source, variant and refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, request])
  const lastFocus = useRef(0)
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFocus.current < 15000) return
      lastFocus.current = Date.now()
      refresh()
    }
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', reload)
    return () => { window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload) }
  }, [refresh])
  const visible = identity && isCurrentAuthIdentity(identity) && settled?.request === request ? settled : null
  return { result: visible?.result ?? null, error: !userId ? 'Sign in to view Baseball statistics.' : visible?.error ?? null,
    warning: visible?.warning ?? null, loading: Boolean(userId && options.scope && !visible),
    progress: progress?.request === request ? progress.value : null, refresh, request }
}

export async function loadBaseballDestinationData(scope: BaseballAggregateLoadScope, teamKey: string, options: {
  userId: string; source: BaseballTotalsSource; variant: BaseballRulesVariant; refreshGeneration: number
  signal: AbortSignal; assertCurrent: () => void; onProgress?: (progress: BaseballAggregateProgress) => void
}, dependencies: { roster?: typeof loadBaseballActiveRoster; events?: typeof loadBaseballAggregates; legacy?: typeof loadBaseballLegacyAggregates } = {}) {
  options.assertCurrent()
  let activeRoster: BaseballAggregateRosterPlayer[] = [], warning: string | null = null
  try {
    activeRoster = await (dependencies.roster ?? loadBaseballActiveRoster)(teamKey, options.signal, options.assertCurrent)
    options.assertCurrent()
    activeRoster = activeRoster.filter(row => scope.type === 'team' ? row.teamId === scope.id
      : scope.type === 'season' ? row.seasonId === scope.id : scope.type === 'tournament' ? row.teamId === scope.teamId
        : 'playerId' in scope && row.playerId === scope.playerId && (!scope.teamId || row.teamId === scope.teamId) && (!scope.seasonId || row.seasonId === scope.seasonId))
    if (scope.type === 'tournament') activeRoster = activeRoster.map(row => ({ ...row, tournamentId: scope.id }))
  } catch {
    options.assertCurrent()
    warning = 'The active roster could not load. Players with no games may be missing.'
  }
  const result: BaseballDestinationResult = options.source === 'events'
    ? { source: 'events', data: await (dependencies.events ?? loadBaseballAggregates)(scope, { ...options, activeRoster }) }
    : { source: 'legacy', data: await (dependencies.legacy ?? loadBaseballLegacyAggregates)(scope, { ...options, activeRoster }) }
  options.assertCurrent()
  if (result.source === 'events' && supabase) {
    const ids = [...new Set(result.data.aggregate.games.map(row => row.game.seasonId).filter((id): id is string => Boolean(id)))]
    result.seasonNames = {}
    try {
      for (let start = 0; start < ids.length; start += 200) {
        options.assertCurrent()
        const response = await supabase.from('seasons').select('id,name').in('id', ids.slice(start, start + 200)).order('id').range(0, 199).abortSignal(options.signal)
        options.assertCurrent()
        if (response.error || !Array.isArray(response.data)) throw Error('Season labels unavailable.')
        for (const row of response.data) result.seasonNames[row.id] = row.name
      }
    } catch { options.assertCurrent(); warning = [warning, 'Some season labels are unavailable.'].filter(Boolean).join(' ') }
  }
  return { result, warning }
}

export async function loadBaseballActiveRoster(teamKey: string, signal: AbortSignal, current: () => void, client: SupabaseClient | null = supabase): Promise<BaseballAggregateRosterPlayer[]> {
  const ids = teamKey ? teamKey.split(',') : []
  if (!ids.length) return []
  if (!client) throw Error('Supabase is not configured.')
  const rows: BaseballAggregateRosterPlayer[] = []
  for (let chunk = 0; chunk < ids.length; chunk += 100) for (let offset = 0; ; offset += 200) {
    current()
    const response = await client.from('team_players')
      .select('team_id,player_id,jersey_number,teams!inner(season_id),players!inner(id,first_name,last_name,nickname,is_team_placeholder)')
      .in('team_id', ids.slice(chunk, chunk + 100)).eq('is_active', true).eq('players.is_team_placeholder', false)
      .order('team_id').order('player_id').range(offset, offset + 199).abortSignal(signal)
    current()
    if (response.error || !Array.isArray(response.data)) throw Error('The active Baseball roster could not load.')
    const page = response.data as unknown as Array<{ team_id: string; jersey_number: string | null; teams: { season_id: string }; players: { id: string; first_name: string; last_name: string | null; nickname: string | null; is_team_placeholder: boolean } }>
    for (const row of page) if (!row.players.is_team_placeholder) rows.push({ playerId: row.players.id, displayName: playerDisplayName(row.players), number: row.jersey_number, teamId: row.team_id, seasonId: row.teams.season_id })
    if (page.length < 200) break
  }
  return rows
}

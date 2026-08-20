import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import BasketballOverview from '../components/basketball-summary/BasketballOverview'
import BasketballPlayers from '../components/basketball-summary/BasketballPlayers'
import BasketballRecordingSelector from '../components/basketball-summary/BasketballRecordingSelector'
import BasketballSummaryHeader from '../components/basketball-summary/BasketballSummaryHeader'
import BasketballSummaryTabs from '../components/basketball-summary/BasketballSummaryTabs'
import BasketballShotReview from '../components/basketball-summary/BasketballShotReview'
import BasketballTeamStats from '../components/basketball-summary/BasketballTeamStats'
import BasketballTimeline from '../components/basketball/BasketballTimeline'
import { useGame } from '../context/GameContext'
import {
  basketballMatchLeaders,
  basketballPeriodScoring,
  basketballSummaryBackPath,
  basketballSummaryPath,
  basketballSummaryResult,
  basketballTeamComparison,
  parseBasketballSummaryQuery,
} from '../lib/basketball/summary'
import {
  BasketballSummarySourceError,
  loadBasketballSummaryRecordingSource,
  loadBasketballSummarySource,
  type BasketballSummaryAuthority,
  type BasketballSummarySource,
} from '../lib/basketball/summarySource'
import type { BasketballMatchEvent } from '../lib/basketball/types'

export default function BasketballSummary() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const query = useMemo(() => parseBasketballSummaryQuery(searchParams), [searchParams])
  const {
    state,
    activeLocalGameId,
    parkedGames,
    resumeParkedGame,
  } = useGame()
  const [source, setSource] = useState<BasketballSummarySource | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [errorAuthority, setErrorAuthority] = useState<BasketballSummaryAuthority>('local')
  const requestIdRef = useRef(0)
  const sourceRef = useRef<BasketballSummarySource | null>(null)
  const routeKeyRef = useRef<string | null>(null)
  const ownedLocalGameId = useMemo(() => {
    if (!source || source.kind === 'local') return null
    const cloudGameId = source.state.cloudSync.gameId
    if (!cloudGameId) return null
    return parkedGames.find(game =>
      game.sportId === 'basketball' && game.cloudGameId === cloudGameId
    )?.localGameId ?? null
  }, [parkedGames, source])

  const openOwnedRecording = useCallback(() => {
    if (!ownedLocalGameId) return
    const hasActiveGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0))
    if (
      activeLocalGameId !== ownedLocalGameId &&
      hasActiveGame &&
      !window.confirm('Park your current game and resume this owned Basketball recording?')
    ) return
    if (activeLocalGameId !== ownedLocalGameId && !resumeParkedGame(ownedLocalGameId)) return
    navigate('/game')
  }, [activeLocalGameId, navigate, ownedLocalGameId, resumeParkedGame, state])

  const refresh = useCallback(async (showLoading = false) => {
    const requestId = ++requestIdRef.current
    if (showLoading) setLoading(true)
    else setRefreshing(true)
    setError(null)
    setRefreshError(null)
    try {
      let next = await loadBasketballSummarySource(state, query.gameId)
      if (query.recordingId && next.kind === 'cloud_primary') {
        const selected = next.recorders.find(item => item.recorderId === query.recordingId)
        const canReviewAlternates = next.recorders.some(item => item.canSelectPrimary)
        if (selected && !selected.isPrimary && canReviewAlternates) {
          next = await loadBasketballSummaryRecordingSource(next, selected)
        }
      }
      if (requestId !== requestIdRef.current) return
      sourceRef.current = next
      setSource(next)
      setErrorAuthority(next.kind)
    } catch (caught) {
      if (requestId !== requestIdRef.current) return
      const message = caught instanceof Error
        ? caught.message
        : 'The Basketball summary could not load.'
      const caughtAuthority = caught instanceof BasketballSummarySourceError
        ? caught.authority
        : null
      const canRetainSource = sourceRef.current &&
        !showLoading &&
        (!caughtAuthority || caughtAuthority === sourceRef.current.kind)
      if (canRetainSource) {
        setRefreshError(message)
      } else {
        sourceRef.current = null
        setSource(null)
        setError(message)
        setErrorAuthority(
          caught instanceof BasketballSummarySourceError
            ? caught.authority
            : query.gameId ? 'cloud_primary' : 'local'
        )
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [query.gameId, query.recordingId, state])

  useEffect(() => {
    const routeKey = `${query.gameId ?? 'local'}:${query.recordingId ?? 'primary'}`
    const replaceSource = routeKeyRef.current !== routeKey
    routeKeyRef.current = routeKey
    if (replaceSource) {
      sourceRef.current = null
      setSource(null)
    }
    void refresh(replaceSource)
  }, [query.gameId, query.recordingId, refresh])

  useEffect(() => {
    if (source?.kind !== 'cloud_primary' && source?.kind !== 'cloud_recording') return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 30_000)
    const onFocus = () => { void refresh() }
    const onOnline = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [refresh, source?.kind])

  useEffect(() => {
    if (!source || !query.recordingId) return
    if (source.kind === 'cloud_recording') return
    navigate(summaryPath(query, null), { replace: true })
  }, [navigate, query, source])

  useEffect(() => {
    if (!source || source.kind !== 'canonical' || query.gameId) return
    const gameId = source.state.cloudSync.gameId
    if (gameId) navigate(summaryPath(query, null, gameId), { replace: true })
  }, [navigate, query, source])

  useEffect(() => {
    if (!query.requestedTab || query.requestedTab === query.tab) return
    navigate(summaryPath(query, query.recordingId), { replace: true })
  }, [navigate, query])

  if (loading && !source) return <SummarySkeleton />
  if (!source || error) {
    return (
      <SummaryError
        authority={errorAuthority}
        message={error ?? 'The Basketball summary is unavailable.'}
        gameId={query.gameId}
        teamId={query.teamId}
        onBack={() => navigate(basketballSummaryBackPath(query))}
        onRetry={() => { void refresh(true) }}
      />
    )
  }

  const sportState = source.state.sportGameState?.sportId === 'basketball'
    ? source.state.sportGameState
    : null
  if (!sportState) {
    return (
      <SummaryError
        authority={source.kind}
        message="The selected source does not contain a Basketball projection."
        gameId={query.gameId}
        teamId={query.teamId}
        onBack={() => navigate(basketballSummaryBackPath(query))}
        onRetry={() => { void refresh(true) }}
      />
    )
  }

  const healthy = source.inspection.complete
  const activeEvents = source.inspection.activeEvents.filter(
    (event): event is BasketballMatchEvent => event.sportId === 'basketball'
  )
  const result = basketballSummaryResult(sportState.projection)

  return (
    <div className="min-h-screen bg-slate-50">
      <BasketballSummaryHeader
        source={source}
        healthy={healthy}
        refreshing={refreshing}
        onBack={() => navigate(basketballSummaryBackPath(query))}
        onRefresh={() => { void refresh() }}
      />
      <BasketballSummaryTabs
        activeTab={query.tab}
        onChange={tab => navigate(basketballSummaryPath({
          gameId: query.gameId,
          tab,
          recordingId: query.recordingId,
          from: query.from,
          teamId: query.teamId,
        }))}
      />
      <BasketballRecordingSelector
        recorders={source.recorders}
        selectedRecorderId={source.kind === 'cloud_recording' ? source.recorder.recorderId : null}
        disabled={refreshing}
        onChange={recordingId => navigate(summaryPath(query, recordingId))}
      />
      <div className="mx-auto max-w-5xl px-4">
        {refreshError && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>Showing the last loaded source. Refresh failed: {refreshError}</p>
          </div>
        )}
        {!healthy && (
          <section className="my-5 rounded-md border border-red-300 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-700" />
              <div>
                <h2 className="font-bold text-red-900">Official output is unavailable</h2>
                <p className="mt-1 text-sm text-red-800">
                  This source has event diagnostics. Scores, comparisons, and leaders are hidden until the source is repaired.
                </p>
                {source.inspection.diagnostics[0] && (
                  <p className="mt-2 text-sm font-semibold text-red-900">
                    {source.inspection.diagnostics[0].message}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      {healthy && query.tab === 'players' ? (
        <BasketballPlayers key={sourceKey(source)} source={source} />
      ) : healthy && query.tab === 'timeline' ? (
        <BasketballTimeline
          key={sourceKey(source)}
          reviewState={source.state}
          mode="summary"
          editingEnabled={source.kind === 'local' && source.editable}
          onOpenOwnedRecording={ownedLocalGameId ? openOwnedRecording : undefined}
        />
      ) : healthy && query.tab === 'shots' ? (
        <BasketballShotReview key={sourceKey(source)} source={source} />
      ) : healthy && query.tab === 'team' ? (
        <BasketballTeamStats key={sourceKey(source)} source={source} />
      ) : healthy ? (
        <main className="mx-auto max-w-5xl px-4">
          <BasketballOverview
            source={source}
            result={result}
            periods={basketballPeriodScoring(sportState.projection, activeEvents)}
            comparisons={basketballTeamComparison(sportState.projection)}
            leaders={basketballMatchLeaders(sportState.projection)}
          />
        </main>
      ) : null}
    </div>
  )
}

function sourceKey(source: BasketballSummarySource): string {
  return [
    source.kind,
    source.state.cloudSync.gameId ?? 'local',
    source.recorder?.recorderId ?? 'device',
    source.publication?.publicationId ?? 'live',
  ].join(':')
}

function summaryPath(
  query: ReturnType<typeof parseBasketballSummaryQuery>,
  recordingId: string | null,
  gameId = query.gameId
): string {
  return basketballSummaryPath({
    gameId,
    tab: query.tab,
    recordingId,
    from: query.from,
    teamId: query.teamId,
  })
}

function SummarySkeleton() {
  return (
    <div className="min-h-screen animate-pulse bg-slate-50">
      <div className="h-48 bg-slate-950" />
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div className="h-8 w-40 rounded bg-slate-200" />
        <div className="h-44 rounded bg-slate-200" />
        <div className="h-64 rounded bg-slate-200" />
      </div>
    </div>
  )
}

function SummaryError({
  authority,
  message,
  gameId,
  teamId,
  onBack,
  onRetry,
}: {
  authority: BasketballSummaryAuthority
  message: string
  gameId: string | null
  teamId: string | null
  onBack: () => void
  onRetry: () => void
}) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-lg rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <AlertTriangle size={28} className="text-amber-600" />
        <p className="mt-3 text-xs font-semibold uppercase text-slate-500">
          {authority.replace('_', ' ')} source
        </p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Basketball summary unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onRetry} className="btn-primary inline-flex items-center justify-center gap-2">
            <RefreshCw size={16} /> Retry
          </button>
          <button type="button" onClick={onBack} className="btn-secondary">Back</button>
          {gameId && (
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({ gameId })
                if (teamId) params.set('teamId', teamId)
                navigate(`/game-info?${params.toString()}`)
              }}
              className="btn-secondary sm:col-span-2"
            >
              Open Game Info
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

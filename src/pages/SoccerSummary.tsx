import { AlertTriangle, ChevronLeft, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SoccerFinalizationPanel from '../components/soccer/SoccerFinalizationPanel'
import SoccerRecorderDialog from '../components/soccer/SoccerRecorderDialog'
import SoccerOverview from '../components/soccer-summary/SoccerOverview'
import SoccerSummaryHeader from '../components/soccer-summary/SoccerSummaryHeader'
import SoccerSummaryTabs from '../components/soccer-summary/SoccerSummaryTabs'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { hasUnsyncedParkedBindingForCloudGame } from '../lib/gameParking'
import { reopenSoccerMatch } from '../lib/soccer/live'
import { loadSoccerGameRecorders, type SoccerRecorderSummary } from '../lib/soccer/recorders'
import {
  parseSoccerSummaryQuery,
  soccerMatchLeaders,
  soccerSummaryBackPath,
  soccerSummaryResult,
  soccerTeamComparison,
} from '../lib/soccer/summary'
import {
  loadSoccerSummarySource,
  SoccerSummarySourceError,
  type SoccerSummaryAuthority,
  type SoccerSummarySource,
} from '../lib/soccer/summarySource'

export default function SoccerSummary() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const query = useMemo(
    () => parseSoccerSummaryQuery(searchParams),
    [searchParams]
  )
  const { user } = useAuth()
  const {
    state,
    dispatch,
    activeLocalGameId,
    parkedGames,
    resumeParkedGame,
    flushCloudSync,
    markSoccerCloudGameReopened,
  } = useGame()
  const [source, setSource] = useState<SoccerSummarySource | null>(null)
  const [recorders, setRecorders] = useState<SoccerRecorderSummary[]>([])
  const [recordersOpen, setRecordersOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorAuthority, setErrorAuthority] =
    useState<SoccerSummaryAuthority>('local')
  const [authorityGameId, setAuthorityGameId] = useState<string | null>(null)
  const [reopenedGameId, setReopenedGameId] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const routeKeyRef = useRef<string | null>(null)
  const effectiveGameId = query.gameId ?? authorityGameId

  const refresh = useCallback(async (
    options: { showLoading?: boolean; gameId?: string | null } = {}
  ) => {
    const requestId = ++requestIdRef.current
    if (options.showLoading) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const next = await loadSoccerSummarySource(
        state,
        options.gameId === undefined ? effectiveGameId : options.gameId
      )
      if (requestId !== requestIdRef.current) return
      setSource(next)
      setRecorders(next.recorders)
      setErrorAuthority(next.kind)
    } catch (caught) {
      if (requestId !== requestIdRef.current) return
      setError(
        caught instanceof Error
          ? caught.message
          : 'The soccer summary could not load.'
      )
      setErrorAuthority(
        caught instanceof SoccerSummarySourceError
          ? caught.authority
          : effectiveGameId
            ? 'cloud_primary'
            : 'local'
      )
      setSource(null)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [effectiveGameId, state])

  useEffect(() => {
    const routeKey = effectiveGameId ?? 'local'
    const showLoading = routeKeyRef.current !== routeKey
    routeKeyRef.current = routeKey
    void refresh({ showLoading })
    // refresh intentionally changes when local GameState changes.
  }, [effectiveGameId, state, refresh])

  useEffect(() => {
    if (source?.kind !== 'cloud_primary') return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 30_000)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, source?.kind])

  const openRecorders = async () => {
    const gameId = source?.state.cloudSync.gameId
    if (!gameId) return
    setRecordersOpen(true)
    if (source.recorders.length > 0) return
    try {
      setRecorders(await loadSoccerGameRecorders(gameId))
    } catch {
      // The summary remains usable when optional recorder presence cannot load.
    }
  }

  if (loading && !source) {
    return <SoccerSummarySkeleton />
  }

  if (!source || error) {
    return (
      <SoccerSummaryError
        authority={errorAuthority}
        message={error ?? 'The soccer summary is unavailable.'}
        onBack={() => navigate(soccerSummaryBackPath(query))}
        onRetry={() => { void refresh({ showLoading: true }) }}
      />
    )
  }

  const soccerState = source.state.sportGameState?.sportId === 'soccer'
    ? source.state.sportGameState
    : null
  if (!soccerState) {
    return (
      <SoccerSummaryError
        authority={source.kind}
        message="The selected source does not contain a soccer match projection."
        onBack={() => navigate(soccerSummaryBackPath(query))}
        onRetry={() => { void refresh({ showLoading: true }) }}
      />
    )
  }

  const healthy = source.inspection.complete
  const result = soccerSummaryResult(soccerState.projection)
  const comparisons = healthy ? soccerTeamComparison(soccerState.projection) : []
  const leaders = healthy ? soccerMatchLeaders(soccerState.projection) : []
  const cloudGameId = source.state.cloudSync.gameId
  const resumable = reopenedGameId
    ? parkedGames.find(game => game.cloudGameId === reopenedGameId) ?? null
    : null

  const reopenLocal = () => {
    const reason = soccerState.projection.endReason === 'abandoned'
      ? window.prompt('Why is this abandoned match being reopened?')?.trim() ?? ''
      : 'Reopened from match summary'
    if (soccerState.projection.endReason === 'abandoned' && !reason) return
    const reopened = reopenSoccerMatch(source.state, reason || null, {
      recorderUserId: user?.id ?? null,
    })
    if (!reopened.ok) {
      setError(reopened.message)
      setErrorAuthority('local')
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: reopened.state })
    setSource({
      ...source,
      state: reopened.state,
      inspection: reopened.inspection,
    })
  }

  const resumeReopened = () => {
    if (!resumable) return
    if (
      activeLocalGameId !== resumable.localGameId &&
      !window.confirm('Park the current game and resume this soccer recorder stream?')
    ) return
    if (!resumeParkedGame(resumable.localGameId)) return
    navigate('/game')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <SoccerSummaryHeader
        source={source}
        result={result}
        refreshing={refreshing}
        onBack={() => navigate(soccerSummaryBackPath(query))}
        onRefresh={() => { void refresh() }}
        onOpenRecorders={cloudGameId ? () => { void openRecorders() } : undefined}
      />
      <SoccerSummaryTabs />

      {!healthy && (
        <section className="border-b border-amber-300 bg-amber-50 px-4 py-4 text-amber-900">
          <div className="mx-auto flex max-w-2xl items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold">Projection needs attention</p>
              <p className="mt-1 text-xs">
                The score and match context reflect the last coherent event. Comparison totals,
                leaders, and finalization are hidden until the event history is repaired.
              </p>
              {source.inspection.diagnostics.slice(0, 3).map((diagnostic, index) => (
                <p key={`${diagnostic.code}-${index}`} className="mt-2 text-xs">
                  {diagnostic.message}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}

      <SoccerOverview
        source={source}
        comparisons={comparisons}
        leaders={leaders}
        healthy={healthy}
        actions={healthy ? (
          <>
            {source.kind === 'local' &&
              source.editable &&
              soccerState.projection.status === 'ended' && (
                <section className="border-b border-slate-200 bg-white px-4 py-4">
                  <div className="mx-auto max-w-2xl">
                    <button
                      type="button"
                      onClick={reopenLocal}
                      className="flex min-h-11 w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700"
                    >
                      <RotateCcw size={17} /> Reopen Match
                    </button>
                  </div>
                </section>
              )}

            {cloudGameId && (
              <div className="mx-auto max-w-2xl">
                <SoccerFinalizationPanel
                  baseState={source.state}
                  currentUserId={user?.id ?? null}
                  refreshKey={
                    source.publication?.finalizedAt ??
                    source.state.cloudSync.lastSyncedAt
                  }
                  flushCloudSync={async () => {
                    const synced = await flushCloudSync()
                    if (!synced.ok) return synced
                    if (
                      user?.id &&
                      hasUnsyncedParkedBindingForCloudGame(user.id, cloudGameId)
                    ) {
                      return {
                        ok: false,
                        reason: 'A local primary stream for this game still has unsynced changes.',
                      }
                    }
                    return { ok: true }
                  }}
                  onFinalized={() => {
                    setAuthorityGameId(cloudGameId)
                    if (source.kind === 'local') {
                      dispatch({
                        type: 'SET_CLOUD_SYNC_STATE',
                        cloudSync: { gameStatus: 'final' },
                      })
                    }
                    void refresh({ gameId: cloudGameId })
                  }}
                  onReopened={() => {
                    setAuthorityGameId(cloudGameId)
                    markSoccerCloudGameReopened(cloudGameId)
                    setReopenedGameId(cloudGameId)
                    void refresh({ gameId: cloudGameId })
                  }}
                />
              </div>
            )}

            {resumable && source.kind === 'cloud_primary' && (
              <section className="border-b border-slate-200 bg-emerald-50 px-4 py-4">
                <div className="mx-auto max-w-2xl">
                  <button
                    type="button"
                    onClick={resumeReopened}
                    className="flex min-h-11 w-full items-center justify-center gap-2 bg-emerald-700 px-3 text-sm font-bold text-white"
                  >
                    <Play size={17} /> Resume Tracker
                  </button>
                </div>
              </section>
            )}
          </>
        ) : null}
      />

      <SoccerRecorderDialog
        open={recordersOpen}
        baseState={source.state}
        currentUserId={user?.id ?? null}
        recorders={recorders}
        onRecordersChanged={async () => { await refresh() }}
        onClose={() => setRecordersOpen(false)}
      />
    </div>
  )
}

function SoccerSummarySkeleton() {
  return (
    <div className="min-h-screen animate-pulse bg-slate-50">
      <div className="h-44 bg-emerald-900" />
      <div className="h-12 border-b border-slate-200 bg-white" />
      <div className="mx-auto max-w-2xl px-4 py-5">
        <div className="h-4 w-32 bg-slate-200" />
        <div className="mt-4 h-64 border-y border-slate-200 bg-white" />
      </div>
    </div>
  )
}

function SoccerSummaryError({
  authority,
  message,
  onBack,
  onRetry,
}: {
  authority: SoccerSummaryAuthority
  message: string
  onBack: () => void
  onRetry: () => void
}) {
  const sourceLabel = authority === 'canonical'
    ? 'Canonical final'
    : authority === 'cloud_primary'
      ? 'Synced primary'
      : 'Local match'
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-900 px-3 py-3 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-md hover:bg-white/10"
            aria-label="Back"
            title="Back"
          >
            <ChevronLeft size={22} />
          </button>
          <div>
            <h1 className="text-sm font-bold">Match Summary</h1>
            <p className="text-xs text-emerald-100">{sourceLabel}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">
        <AlertTriangle size={26} className="text-amber-600" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">
          {sourceLabel} unavailable
        </h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 flex min-h-11 items-center justify-center gap-2 bg-slate-800 px-4 text-sm font-bold text-white"
        >
          <RefreshCw size={17} /> Retry
        </button>
      </main>
    </div>
  )
}

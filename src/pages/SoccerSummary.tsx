import { AlertTriangle, ChevronLeft, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SoccerFinalizationPanel from '../components/soccer/SoccerFinalizationPanel'
import SoccerRecorderDialog from '../components/soccer/SoccerRecorderDialog'
import SoccerOverview from '../components/soccer-summary/SoccerOverview'
import SoccerPlayers from '../components/soccer-summary/SoccerPlayers'
import SoccerRecordingSelector from '../components/soccer-summary/SoccerRecordingSelector'
import SoccerReviewTimeline from '../components/soccer-summary/SoccerReviewTimeline'
import SoccerSummaryHeader from '../components/soccer-summary/SoccerSummaryHeader'
import SoccerSummaryTabs from '../components/soccer-summary/SoccerSummaryTabs'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { loadSoccerCloudGameById } from '../lib/soccer/cloudSync'
import { reopenSoccerMatch, type SoccerLiveResult } from '../lib/soccer/live'
import type {
  SoccerPlayerCategory,
  SoccerPlayerReviewSide,
} from '../lib/soccer/summaryPlayers'
import { loadSoccerGameRecorders, type SoccerRecorderSummary } from '../lib/soccer/recorders'
import {
  parseSoccerSummaryQuery,
  soccerMatchLeaders,
  soccerSummaryBackPath,
  soccerSummaryPath,
  soccerSummaryResult,
  soccerTeamComparison,
} from '../lib/soccer/summary'
import {
  loadSoccerSummarySource,
  loadSoccerSummaryRecordingSource,
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
    openGameSnapshot,
    resumeParkedGame,
    flushCloudGameSync,
    markSoccerCloudGameReopened,
  } = useGame()
  const [source, setSource] = useState<SoccerSummarySource | null>(null)
  const [recorders, setRecorders] = useState<SoccerRecorderSummary[]>([])
  const [recordersOpen, setRecordersOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [errorAuthority, setErrorAuthority] =
    useState<SoccerSummaryAuthority>('local')
  const [reopenedGameId, setReopenedGameId] = useState<string | null>(null)
  const [playerSide, setPlayerSide] =
    useState<SoccerPlayerReviewSide>('tracked')
  const [playerCategory, setPlayerCategory] =
    useState<SoccerPlayerCategory>('attack')
  const [timelineBusy, setTimelineBusy] = useState(false)
  const requestIdRef = useRef(0)
  const routeKeyRef = useRef<string | null>(null)
  const sourceRef = useRef<SoccerSummarySource | null>(null)
  const selectedRecordingIdRef = useRef<string | null>(null)
  const playerViewGameKeyRef = useRef<string | null>(null)
  const timelineApplyingRef = useRef(false)

  const refresh = useCallback(async (
    options: {
      showLoading?: boolean
      gameId?: string | null
      replaceSource?: boolean
    } = {}
  ) => {
    const requestId = ++requestIdRef.current
    if (options.replaceSource) {
      sourceRef.current = null
      setSource(null)
    }
    if (options.showLoading || options.replaceSource) setLoading(true)
    else setRefreshing(true)
    setError(null)
    setRefreshError(null)
    try {
      let next = await loadSoccerSummarySource(
        state,
        options.gameId === undefined ? query.gameId : options.gameId
      )
      const selectedRecordingId = selectedRecordingIdRef.current
      if (selectedRecordingId && next.kind === 'cloud_primary') {
        const selectedRecorder = next.recorders.find(
          recorder => recorder.recorderId === selectedRecordingId
        )
        if (!selectedRecorder || selectedRecorder.isPrimary) {
          selectedRecordingIdRef.current = null
        } else {
          next = await loadSoccerSummaryRecordingSource(next, selectedRecorder)
        }
      } else if (selectedRecordingId && next.kind !== 'cloud_recording') {
        selectedRecordingIdRef.current = null
      }
      if (requestId !== requestIdRef.current) return
      sourceRef.current = next
      setSource(next)
      setRecorders(next.recorders)
      setErrorAuthority(next.kind)
    } catch (caught) {
      if (requestId !== requestIdRef.current) return
      const message = caught instanceof Error
        ? caught.message
        : 'The soccer summary could not load.'
      if (sourceRef.current && !options.replaceSource) {
        selectedRecordingIdRef.current =
          sourceRef.current.kind === 'cloud_recording'
            ? sourceRef.current.recorder.recorderId
            : null
        setRefreshError(message)
      } else {
        setError(message)
        setErrorAuthority(
          caught instanceof SoccerSummarySourceError
            ? caught.authority
            : query.gameId
              ? 'cloud_primary'
              : 'local'
        )
        sourceRef.current = null
        setSource(null)
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [query.gameId, state])

  useEffect(() => {
    const routeKey = query.gameId ?? 'local'
    const showLoading = routeKeyRef.current !== routeKey
    routeKeyRef.current = routeKey
    if (showLoading) selectedRecordingIdRef.current = null
    void refresh({ showLoading, replaceSource: showLoading })
    // refresh intentionally changes when local GameState changes.
  }, [query.gameId, state, refresh])

  useEffect(() => {
    const gameKey = query.gameId ?? activeLocalGameId ?? 'local'
    if (playerViewGameKeyRef.current === gameKey) return
    playerViewGameKeyRef.current = gameKey
    setPlayerSide('tracked')
    setPlayerCategory('attack')
  }, [activeLocalGameId, query.gameId])

  useEffect(() => {
    // Checked mutations return a fresh state; this marks the dispatch as committed.
    timelineApplyingRef.current = false
    setTimelineBusy(false)
  }, [state])

  useEffect(() => {
    if (source?.kind !== 'cloud_primary' && source?.kind !== 'cloud_recording') return
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

  useEffect(() => {
    const gameId = source?.state.cloudSync.gameId
    if (source?.kind !== 'canonical' || query.gameId || !gameId) return
    navigate(soccerSummaryPath({
      gameId,
      tab: query.tab,
      from: query.from,
      teamId: query.teamId,
    }), { replace: true })
  }, [navigate, query.from, query.gameId, query.tab, query.teamId, source])

  useEffect(() => {
    if (!query.requestedTab || query.requestedTab === query.tab) return
    navigate(soccerSummaryPath({
      gameId: query.gameId,
      tab: query.tab,
      from: query.from,
      teamId: query.teamId,
    }), { replace: true })
  }, [
    navigate,
    query.from,
    query.gameId,
    query.requestedTab,
    query.tab,
    query.teamId,
  ])

  useEffect(() => {
    if (!source || source.inspection.complete || query.tab === 'overview') return
    navigate(soccerSummaryPath({
      gameId: query.gameId,
      tab: 'overview',
      from: query.from,
      teamId: query.teamId,
    }), { replace: true })
  }, [
    navigate,
    query.from,
    query.gameId,
    query.tab,
    query.teamId,
    source,
  ])

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
  const matchingParked = cloudGameId
    ? parkedGames.find(game => game.cloudGameId === cloudGameId) ?? null
    : null
  const resumable = reopenedGameId
    ? matchingParked
    : null
  const ownedRecorder = user
    ? source.recorders.find(recorder => recorder.recorderId === user.id) ?? null
    : null
  const canOpenReopenedStream =
    source.kind === 'cloud_primary' &&
    reopenedGameId === cloudGameId &&
    Boolean(resumable || ownedRecorder)
  const canOpenSelectedRecording =
    source.kind === 'cloud_recording' &&
    source.recorder.recorderId === user?.id

  const applyTimelineResult = (result: SoccerLiveResult): boolean => {
    if (timelineApplyingRef.current) return false
    if (source.kind !== 'local' || !source.editable) {
      return false
    }
    if (!result.ok) return false
    const nextSource: SoccerSummarySource = {
      ...source,
      state: result.state,
      inspection: result.inspection,
    }
    timelineApplyingRef.current = true
    setTimelineBusy(true)
    // Render the accepted result immediately while GameContext persists the same state.
    sourceRef.current = nextSource
    setSource(nextSource)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    return true
  }

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
    const nextSource: SoccerSummarySource = {
      ...source,
      state: reopened.state,
      inspection: reopened.inspection,
    }
    sourceRef.current = nextSource
    setSource(nextSource)
  }

  const openOwnedStream = async () => {
    if (!cloudGameId || !user) return
    if (matchingParked) {
      if (
        activeLocalGameId !== matchingParked.localGameId &&
        !window.confirm('Park the current game and resume this soccer recorder stream?')
      ) return
      if (!resumeParkedGame(matchingParked.localGameId)) return
      navigate('/game')
      return
    }
    if (!ownedRecorder) return
    const recorderState = await loadSoccerCloudGameById(user.id, cloudGameId)
      .catch(caught => {
        setRefreshError(
          caught instanceof Error
            ? caught.message
            : 'Your recorder stream could not load.'
        )
        return null
      })
    if (!recorderState) {
      setRefreshError('Your recorder stream is not available to resume.')
      return
    }
    const hasActiveGame = Boolean(
      state.sport && (state.gameInfo || state.players.length > 0)
    )
    if (
      hasActiveGame &&
      state.cloudSync.gameId !== cloudGameId &&
      !window.confirm('Park the current game and open your soccer recorder stream?')
    ) return
    if (!openGameSnapshot(recorderState)) return
    navigate('/game')
  }

  const selectRecording = (recorder: SoccerRecorderSummary) => {
    selectedRecordingIdRef.current = recorder.recorderId
    void refresh()
  }

  const returnToPrimary = () => {
    selectedRecordingIdRef.current = null
    void refresh()
  }

  const changeTab = (tab: typeof query.tab) => {
    navigate(soccerSummaryPath({
      gameId: query.gameId,
      tab,
      from: query.from,
      teamId: query.teamId,
    }))
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
      <SoccerSummaryTabs
        activeTab={query.tab}
        showPlayers={healthy}
        showTimeline={healthy}
        onChange={changeTab}
      />
      <SoccerRecordingSelector
        source={source}
        busy={loading || refreshing}
        onSelect={selectRecording}
        onPrimary={returnToPrimary}
      />

      {refreshError && (
        <section className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <div className="mx-auto flex max-w-2xl items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Summary refresh failed</p>
              <p className="mt-0.5 text-xs">
                Showing the last loaded result. {refreshError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void refresh() }}
              className="min-h-9 shrink-0 border border-amber-400 bg-white px-3 text-xs font-bold"
            >
              Retry
            </button>
          </div>
        </section>
      )}

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

      {query.tab === 'players' && healthy ? (
        <SoccerPlayers
          source={source}
          side={playerSide}
          category={playerCategory}
          onSideChange={setPlayerSide}
          onCategoryChange={setPlayerCategory}
        />
      ) : query.tab === 'timeline' && healthy ? (
        <SoccerReviewTimeline
          source={source}
          recorderUserId={user?.id ?? null}
          busy={timelineBusy}
          onApply={applyTimelineResult}
        />
      ) : (
        <SoccerOverview
          source={source}
          comparisons={comparisons}
          leaders={leaders}
          healthy={healthy}
          actions={(
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

            {healthy && cloudGameId && source.kind !== 'cloud_recording' && (
              <div className="mx-auto max-w-2xl">
                <SoccerFinalizationPanel
                  baseState={source.state}
                  currentUserId={user?.id ?? null}
                  refreshKey={
                    source.publication?.finalizedAt ??
                    source.state.cloudSync.lastSyncedAt
                  }
                  flushCloudSync={() => flushCloudGameSync(cloudGameId)}
                  onFinalized={() => {
                    navigate(soccerSummaryPath({
                      gameId: cloudGameId,
                      tab: query.tab,
                      from: query.from,
                      teamId: query.teamId,
                    }), { replace: true })
                    if (source.kind === 'local') {
                      dispatch({
                        type: 'SET_CLOUD_SYNC_STATE',
                        cloudSync: { gameStatus: 'final' },
                      })
                    }
                    void refresh({
                      gameId: cloudGameId,
                      replaceSource: true,
                    })
                  }}
                  onReopened={() => {
                    markSoccerCloudGameReopened(cloudGameId)
                    setReopenedGameId(cloudGameId)
                    void refresh({
                      gameId: cloudGameId,
                      replaceSource: true,
                    })
                  }}
                />
              </div>
            )}

            {(canOpenReopenedStream || canOpenSelectedRecording) && (
              <section className="border-b border-slate-200 bg-emerald-50 px-4 py-4">
                <div className="mx-auto max-w-2xl">
                  <button
                    type="button"
                    onClick={() => { void openOwnedStream() }}
                    className="flex min-h-11 w-full items-center justify-center gap-2 bg-emerald-700 px-3 text-sm font-bold text-white"
                  >
                    <Play size={17} />
                    {matchingParked ? 'Resume Tracker' : 'Open Tracker'}
                  </button>
                </div>
              </section>
            )}
            </>
          )}
        />
      )}

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
    : authority === 'cloud_recording'
      ? 'Other recording'
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

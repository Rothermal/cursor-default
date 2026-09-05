import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Eye,
  History,
  Star,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBasketballRecorderPresence } from '../../hooks/useBasketballRecorderPresence'
import { gameSideDisplayName } from '../../lib/display'
import {
  basketballRecorderNeedsAttention,
  loadBasketballPrimaryRecorderHistory,
  loadBasketballRecorderProjection,
  selectBasketballPrimaryRecorder,
  type BasketballPrimaryRecorderHistoryEntry,
  type BasketballRecorderProjection,
  type BasketballRecorderSummary,
} from '../../lib/basketball/recorders'

interface BasketballRecorderManagerProps {
  gameId: string
  currentUserId: string | null
  canManage: boolean
}

export default function BasketballRecorderManager({
  gameId,
  currentUserId,
  canManage,
}: BasketballRecorderManagerProps) {
  const { recorders, loading, error: loadError, refresh } =
    useBasketballRecorderPresence(gameId)
  const [showDetails, setShowDetails] = useState(false)
  const [selectedRecorderId, setSelectedRecorderId] = useState<string | null>(null)
  const [projection, setProjection] = useState<BasketballRecorderProjection | null>(null)
  const [history, setHistory] = useState<BasketballPrimaryRecorderHistoryEntry[]>([])
  const [loadingStream, setLoadingStream] = useState(false)
  const [savingPrimaryId, setSavingPrimaryId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const selectedRecorder = useMemo(
    () => recorders.find(recorder => recorder.recorderId === selectedRecorderId) ?? null,
    [recorders, selectedRecorderId]
  )
  const primary = recorders.find(recorder => recorder.isPrimary) ?? null
  const primaryNeedsAttention = primary ? basketballRecorderNeedsAttention(primary) : false
  const alternateAttentionCount = recorders.filter(
    recorder => !recorder.isPrimary && basketballRecorderNeedsAttention(recorder)
  ).length

  const refreshHistory = useCallback(async () => {
    if (!canManage) {
      setHistory([])
      return
    }
    try {
      setHistory(await loadBasketballPrimaryRecorderHistory(gameId))
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Primary history could not load.')
    }
  }, [canManage, gameId])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    if (!showDetails || !selectedRecorder) {
      setProjection(null)
      return
    }
    let cancelled = false
    setLoadingStream(true)
    setActionError(null)
    void loadBasketballRecorderProjection(gameId, selectedRecorder)
      .then(result => {
        if (!cancelled) setProjection(result)
      })
      .catch(caught => {
        if (!cancelled) {
          setActionError(
            caught instanceof Error ? caught.message : 'Basketball recorder stream could not load.'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStream(false)
      })
    return () => {
      cancelled = true
    }
  }, [gameId, selectedRecorder, showDetails])

  const handlePrimary = async (recorder: BasketballRecorderSummary) => {
    if (!canManage || !recorder.canSelectPrimary || !recorder.checkpointCurrent) return
    setSavingPrimaryId(recorder.recorderId)
    setActionError(null)
    try {
      const candidate = await loadBasketballRecorderProjection(gameId, recorder)
      if (!candidate.inspection.complete) {
        throw new Error('Primary recorder must have a healthy projectable Basketball stream.')
      }
      await selectBasketballPrimaryRecorder(gameId, recorder.recorderId)
      await refresh()
      await refreshHistory()
      if (showDetails && selectedRecorderId === recorder.recorderId) setProjection(candidate)
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Basketball primary recorder could not update.'
      )
    } finally {
      setSavingPrimaryId(null)
    }
  }

  if (loading && recorders.length === 0) {
    return (
      <section className="card">
        <p className="text-sm text-slate-500 animate-pulse">Loading recorder streams...</p>
      </section>
    )
  }
  if (!loading && !loadError && recorders.length === 0) return null

  return (
    <section className="card space-y-4" aria-labelledby="basketball-recorders-title">
      <div className="flex items-start gap-3">
        <Users size={20} className="mt-0.5 shrink-0 text-blue-700" />
        <div className="min-w-0 flex-1">
          <h2 id="basketball-recorders-title" className="font-semibold text-slate-800">
            Recorder Streams
          </h2>
          <p className="text-xs text-slate-500">
            {primary ? `Primary: ${primary.displayName}` : 'Primary recorder pending'}
          </p>
        </div>
        {primaryNeedsAttention && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
            <AlertTriangle size={14} /> Needs Attention
          </span>
        )}
      </div>

      {(loadError || actionError) && (
        <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError ?? loadError}
        </div>
      )}

      {alternateAttentionCount > 0 && canManage && (
        <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {alternateAttentionCount} non-primary {alternateAttentionCount === 1 ? 'stream needs' : 'streams need'} attention. A healthy primary remains usable.
        </div>
      )}

      <div className="divide-y divide-slate-200 border-y border-slate-200">
        {recorders.map(recorder => (
          <div key={recorder.recorderId} className="flex min-h-16 items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-bold text-slate-800">
                  {recorder.displayName}
                  {recorder.recorderId === currentUserId ? ' (You)' : ''}
                </p>
                {recorder.isPrimary && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                    <Star size={13} fill="currentColor" /> Primary
                    {recorder.primarySource === 'default' ? ' (automatic)' : ''}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                {recorder.eventCount !== null && <span>{recorder.eventCount} events</span>}
                <span className="inline-flex items-center gap-1">
                  {recorder.checkpointCurrent ? (
                    <CheckCircle2 size={13} className="text-emerald-600" />
                  ) : (
                    <AlertTriangle size={13} className="text-amber-600" />
                  )}
                  {recorder.checkpointCurrent ? 'Current' : 'Needs attention'}
                </span>
                {recorder.unresolvedConflictCount !== null &&
                  recorder.unresolvedConflictCount > 0 && (
                    <span>{recorder.unresolvedConflictCount} conflicts</span>
                  )}
                {recorder.checkpointSyncedAt && (
                  <span>{new Date(recorder.checkpointSyncedAt).toLocaleString()}</span>
                )}
              </div>
            </div>

            {canManage && showDetails && (
              <button
                type="button"
                onClick={() => setSelectedRecorderId(recorder.recorderId)}
                className={`grid h-9 w-9 place-items-center ${
                  selectedRecorderId === recorder.recorderId ? 'text-blue-700' : 'text-slate-500'
                }`}
                aria-label={`View ${recorder.displayName}'s stream`}
                title="View stream"
              >
                <Eye size={18} />
              </button>
            )}

            {canManage && recorder.canSelectPrimary && (
              <label
                className={`grid h-9 w-9 place-items-center ${
                  recorder.checkpointCurrent ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
                }`}
                title={
                  recorder.checkpointCurrent
                    ? 'Select primary recorder'
                    : 'A current conflict-free checkpoint is required'
                }
              >
                <input
                  type="radio"
                  name="basketball-primary-recorder"
                  checked={recorder.isPrimary}
                  disabled={!recorder.checkpointCurrent || savingPrimaryId !== null}
                  onChange={() => { void handlePrimary(recorder) }}
                  className="h-4 w-4 accent-blue-700"
                  aria-label={`Select ${recorder.displayName} as primary recorder`}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <label className="flex min-h-10 cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-bold text-slate-800">Show stream details</span>
            <span className="block text-xs text-slate-500">Read-only</span>
          </span>
          <input
            type="checkbox"
            checked={showDetails}
            onChange={event => {
              setShowDetails(event.target.checked)
              if (event.target.checked && !selectedRecorderId) {
                setSelectedRecorderId(primary?.recorderId ?? recorders[0]?.recorderId ?? null)
              }
            }}
            className="h-5 w-5 accent-blue-700"
          />
        </label>
      )}

      {canManage && showDetails && (
        <div className="border-t border-slate-200 pt-4">
          {loadingStream ? (
            <p className="py-5 text-center text-sm text-slate-500">Loading stream...</p>
          ) : projection ? (
            <RecorderProjectionView projection={projection} />
          ) : (
            <p className="py-5 text-center text-sm text-slate-500">
              Choose a recorder to inspect their stream.
            </p>
          )}
        </div>
      )}

      {canManage && history.length > 0 && (
        <div className="border-t border-slate-200 pt-4">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">
            <History size={14} /> Primary history
          </h3>
          <div className="mt-2 divide-y divide-slate-100">
            {history.slice(0, 8).map(entry => (
              <p key={entry.id} className="py-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{entry.displayName}</span>
                {' selected by '}
                {entry.changedByDisplayName}
                {' | '}
                {new Date(entry.changedAt).toLocaleString()}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function RecorderProjectionView({
  projection,
}: {
  projection: BasketballRecorderProjection
}) {
  const basketballState = projection.state.sportGameState?.sportId === 'basketball'
    ? projection.state.sportGameState
    : null
  const events = [
    ...projection.inspection.activeEvents,
    ...projection.inspection.deletedEvents,
  ].sort((a, b) => b.sequence - a.sequence)

  return (
    <>
      <div className="flex items-center gap-2">
        <Cloud size={18} className="text-blue-700" />
        <h3 className="font-bold text-slate-900">{projection.recorder.displayName}</h3>
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-200 py-3 text-center">
        <div>
          <p className="text-2xl font-bold text-blue-800">{projection.state.homeTeamScore ?? 0}</p>
          <p className="truncate text-[11px] text-slate-500" title={gameSideDisplayName(projection.state.gameInfo, 'tracked')}>{gameSideDisplayName(projection.state.gameInfo, 'tracked')}</p>
        </div>
        <div>
          <p className="text-sm font-bold capitalize text-slate-700">
            {basketballState?.projection.status.replace(/_/g, ' ') ?? 'Unknown'}
          </p>
          <p className="text-[11px] text-slate-500">Stream state</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-800">{projection.state.opponentScore}</p>
          <p className="truncate text-[11px] text-slate-500" title={gameSideDisplayName(projection.state.gameInfo, 'opponent')}>{gameSideDisplayName(projection.state.gameInfo, 'opponent')}</p>
        </div>
      </div>

      {!projection.inspection.complete && (
        <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This stream has {projection.inspection.diagnostics.length} projection issue
          {projection.inspection.diagnostics.length === 1 ? '' : 's'} and is not eligible for a
          new primary selection until repaired.
        </div>
      )}

      <div className="mt-4 divide-y divide-slate-100 border-t border-slate-200">
        {events.slice(0, 30).map(event => (
          <div key={event.id} className="flex items-center gap-3 py-2 text-xs">
            <span className="w-16 shrink-0 font-semibold tabular-nums text-slate-500">
              P{event.period.order} {formatElapsed(event.elapsedMs)}
            </span>
            <span className={`min-w-0 flex-1 truncate text-slate-700 ${
              event.deletedAt ? 'line-through opacity-50' : ''
            }`}>
              {event.eventType.replace('basketball.', '').replace(/_/g, ' ')}
            </span>
            <span className="capitalize text-slate-400">{event.teamSide}</span>
          </div>
        ))}
        {events.length === 0 && (
          <p className="py-5 text-center text-sm text-slate-500">No events in this stream.</p>
        )}
      </div>
    </>
  )
}

function formatElapsed(elapsedMs: number | null): string {
  if (elapsedMs === null) return ''
  const totalSeconds = Math.floor(elapsedMs / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

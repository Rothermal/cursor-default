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
        <p className="text-sm text-content-muted animate-pulse">Loading recorder streams...</p>
      </section>
    )
  }
  if (!loading && !loadError && recorders.length === 0) return null

  return (
    <section className="card space-y-4" aria-labelledby="basketball-recorders-title">
      <div className="flex items-start gap-3">
        <Users size={20} className="mt-0.5 shrink-0 text-info-content" />
        <div className="min-w-0 flex-1">
          <h2 id="basketball-recorders-title" className="font-semibold text-content">
            Recorder Streams
          </h2>
          <p className="text-xs text-content-muted">
            {primary ? `Primary: ${primary.displayName}` : 'Primary recorder pending'}
          </p>
        </div>
        {primaryNeedsAttention && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-warning-content">
            <AlertTriangle size={14} /> Needs Attention
          </span>
        )}
      </div>

      {(loadError || actionError) && (
        <div className="border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {actionError ?? loadError}
        </div>
      )}

      {alternateAttentionCount > 0 && canManage && (
        <div className="border border-warning-line bg-warning px-3 py-2 text-xs text-warning-content">
          {alternateAttentionCount} non-primary {alternateAttentionCount === 1 ? 'stream needs' : 'streams need'} attention. A healthy primary remains usable.
        </div>
      )}

      <div className="divide-y divide-line border-y border-line">
        {recorders.map(recorder => (
          <div key={recorder.recorderId} className="flex min-h-16 items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-bold text-content">
                  {recorder.displayName}
                  {recorder.recorderId === currentUserId ? ' (You)' : ''}
                </p>
                {recorder.isPrimary && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-warning-content">
                    <Star size={13} fill="currentColor" /> Primary
                    {recorder.primarySource === 'default' ? ' (automatic)' : ''}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-muted">
                {recorder.eventCount !== null && <span>{recorder.eventCount} events</span>}
                <span className="inline-flex items-center gap-1">
                  {recorder.checkpointCurrent ? (
                    <CheckCircle2 size={13} className="text-success-content" />
                  ) : (
                    <AlertTriangle size={13} className="text-warning-content" />
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
                  selectedRecorderId === recorder.recorderId ? 'text-info-content' : 'text-content-muted'
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
                  recorder.checkpointCurrent ? 'cursor-pointer' : 'cursor-not-allowed text-content-disabled'
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
                  className="h-4 w-4 accent-accent"
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
            <span className="block text-sm font-bold text-content">Show stream details</span>
            <span className="block text-xs text-content-muted">Read-only</span>
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
            className="h-5 w-5 accent-accent"
          />
        </label>
      )}

      {canManage && showDetails && (
        <div className="border-t border-line pt-4">
          {loadingStream ? (
            <p className="py-5 text-center text-sm text-content-muted">Loading stream...</p>
          ) : projection ? (
            <RecorderProjectionView projection={projection} />
          ) : (
            <p className="py-5 text-center text-sm text-content-muted">
              Choose a recorder to inspect their stream.
            </p>
          )}
        </div>
      )}

      {canManage && history.length > 0 && (
        <div className="border-t border-line pt-4">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase text-content-muted">
            <History size={14} /> Primary history
          </h3>
          <div className="mt-2 divide-y divide-line">
            {history.slice(0, 8).map(entry => (
              <p key={entry.id} className="py-2 text-xs text-content-muted">
                <span className="font-semibold text-content">{entry.displayName}</span>
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
        <Cloud size={18} className="text-info-content" />
        <h3 className="font-bold text-content">{projection.recorder.displayName}</h3>
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-line border-y border-line py-3 text-center">
        <div>
          <p className="text-2xl font-bold text-info-content">{projection.state.homeTeamScore ?? 0}</p>
          <p className="truncate text-[11px] text-content-muted" title={gameSideDisplayName(projection.state.gameInfo, 'tracked')}>{gameSideDisplayName(projection.state.gameInfo, 'tracked')}</p>
        </div>
        <div>
          <p className="text-sm font-bold capitalize text-content">
            {basketballState?.projection.status.replace(/_/g, ' ') ?? 'Unknown'}
          </p>
          <p className="text-[11px] text-content-muted">Stream state</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-content">{projection.state.opponentScore}</p>
          <p className="truncate text-[11px] text-content-muted" title={gameSideDisplayName(projection.state.gameInfo, 'opponent')}>{gameSideDisplayName(projection.state.gameInfo, 'opponent')}</p>
        </div>
      </div>

      {!projection.inspection.complete && (
        <div className="mt-3 border border-warning-line bg-warning px-3 py-2 text-xs text-warning-content">
          This stream has {projection.inspection.diagnostics.length} projection issue
          {projection.inspection.diagnostics.length === 1 ? '' : 's'} and is not eligible for a
          new primary selection until repaired.
        </div>
      )}

      <div className="mt-4 divide-y divide-line border-t border-line">
        {events.slice(0, 30).map(event => (
          <div key={event.id} className="flex items-center gap-3 py-2 text-xs">
            <span className="w-16 shrink-0 font-semibold tabular-nums text-content-muted">
              P{event.period.order} {formatElapsed(event.elapsedMs)}
            </span>
            <span className={`min-w-0 flex-1 truncate text-content ${
              event.deletedAt ? 'line-through opacity-50' : ''
            }`}>
              {event.eventType.replace('basketball.', '').replace(/_/g, ' ')}
            </span>
            <span className="capitalize text-content-subtle">{event.teamSide}</span>
          </div>
        ))}
        {events.length === 0 && (
          <p className="py-5 text-center text-sm text-content-muted">No events in this stream.</p>
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

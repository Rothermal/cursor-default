import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Eye,
  Star,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GameState } from '../../types'
import { formatSoccerDuration } from '../../lib/soccer'
import {
  loadSoccerPrimaryRecorderHistory,
  loadSoccerRecorderProjection,
  selectSoccerPrimaryRecorder,
  type SoccerPrimaryRecorderHistoryEntry,
  type SoccerRecorderProjection,
  type SoccerRecorderSummary,
} from '../../lib/soccer/recorders'
import { gameSideDisplayName } from '../../lib/display'

interface SoccerRecorderDialogProps {
  open: boolean
  baseState: GameState
  currentUserId: string | null
  recorders: SoccerRecorderSummary[]
  onRecordersChanged: () => Promise<void>
  onClose: () => void
}

export default function SoccerRecorderDialog({
  open,
  baseState,
  currentUserId,
  recorders,
  onRecordersChanged,
  onClose,
}: SoccerRecorderDialogProps) {
  const gameId = baseState.cloudSync.gameId
  const [showDetails, setShowDetails] = useState(false)
  const [selectedRecorderId, setSelectedRecorderId] = useState<string | null>(null)
  const [projection, setProjection] = useState<SoccerRecorderProjection | null>(null)
  const [history, setHistory] = useState<SoccerPrimaryRecorderHistoryEntry[]>([])
  const [loadingStream, setLoadingStream] = useState(false)
  const [savingPrimaryId, setSavingPrimaryId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedRecorder = useMemo(
    () => recorders.find(recorder => recorder.recorderId === selectedRecorderId) ?? null,
    [recorders, selectedRecorderId]
  )

  useEffect(() => {
    if (!open || !gameId) return
    let cancelled = false
    void loadSoccerPrimaryRecorderHistory(gameId)
      .then(rows => {
        if (!cancelled) setHistory(rows)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'History could not load.')
      })
    return () => {
      cancelled = true
    }
  }, [gameId, open])

  useEffect(() => {
    if (!open) {
      setShowDetails(false)
      setSelectedRecorderId(null)
      setProjection(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!showDetails || !selectedRecorder) {
      setProjection(null)
      return
    }
    let cancelled = false
    setLoadingStream(true)
    setError(null)
    void loadSoccerRecorderProjection(baseState, selectedRecorder)
      .then(result => {
        if (!cancelled) setProjection(result)
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Recorder stream could not load.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStream(false)
      })
    return () => {
      cancelled = true
    }
  }, [baseState, selectedRecorder, showDetails])

  if (!open || !gameId) return null

  const handlePrimary = async (recorder: SoccerRecorderSummary) => {
    if (!recorder.canSelectPrimary || !recorder.checkpointCurrent) return
    setSavingPrimaryId(recorder.recorderId)
    setError(null)
    try {
      const candidate = await loadSoccerRecorderProjection(baseState, recorder)
      if (!candidate.inspection.complete) {
        throw new Error('Primary recorder must have a healthy projectable stream.')
      }
      await selectSoccerPrimaryRecorder(gameId, recorder.recorderId)
      await onRecordersChanged()
      setHistory(await loadSoccerPrimaryRecorderHistory(gameId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Primary recorder could not update.')
    } finally {
      setSavingPrimaryId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-overlay/[0.5] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-recorders-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-2xl sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <Users size={20} className="text-success-content" />
          <div className="min-w-0 flex-1">
            <h2 id="soccer-recorders-title" className="font-bold text-content">
              Recorder Streams
            </h2>
            <p className="text-xs text-content-muted">
              Streams stay independent; only the primary drives canonical results.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center text-content-muted"
            aria-label="Close"
            title="Close"
          >
            <X size={20} />
          </button>
        </header>

        {error && (
          <div className="border-b border-danger-line bg-danger px-4 py-3 text-sm text-danger-content">
            {error}
          </div>
        )}

        <section className="divide-y divide-line">
          {recorders.map(recorder => (
            <div key={recorder.recorderId} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-bold text-content">
                    {recorder.displayName}
                    {recorder.recorderId === currentUserId ? ' (You)' : ''}
                  </p>
                  {recorder.isPrimary && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-warning-content">
                      <Star size={13} fill="currentColor" /> Primary
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                  <span>{recorder.eventCount} events</span>
                  <span className="inline-flex items-center gap-1">
                    {recorder.checkpointCurrent ? (
                      <CheckCircle2 size={13} className="text-success-content" />
                    ) : (
                      <AlertTriangle size={13} className="text-warning-content" />
                    )}
                    {recorder.checkpointCurrent ? 'Current' : 'Needs attention'}
                  </span>
                  {recorder.unresolvedConflictCount > 0 && (
                    <span>{recorder.unresolvedConflictCount} conflicts</span>
                  )}
                </p>
              </div>

              {showDetails && (
                <button
                  type="button"
                  onClick={() => setSelectedRecorderId(recorder.recorderId)}
                  className="grid h-9 w-9 place-items-center text-content-muted"
                  aria-label={`View ${recorder.displayName}'s stream`}
                  title="View stream"
                >
                  <Eye size={18} />
                </button>
              )}

              {recorder.canSelectPrimary && (
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
                    name="soccer-primary-recorder"
                    checked={recorder.isPrimary}
                    disabled={!recorder.checkpointCurrent || savingPrimaryId !== null}
                    onChange={() => { void handlePrimary(recorder) }}
                    className="bg-surface h-4 w-4 accent-accent"
                    aria-label={`Select ${recorder.displayName} as primary recorder`}
                  />
                </label>
              )}
            </div>
          ))}
        </section>

        <section className="border-t border-line px-4 py-3">
          <label className="flex min-h-10 cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-bold text-content">Show stream details</span>
              <span className="block text-xs text-content-muted">
                Read-only and off by default
              </span>
            </span>
            <input
              type="checkbox"
              checked={showDetails}
              onChange={event => {
                setShowDetails(event.target.checked)
                if (event.target.checked && !selectedRecorderId) {
                  setSelectedRecorderId(
                    recorders.find(recorder => recorder.isPrimary)?.recorderId ??
                      recorders[0]?.recorderId ??
                      null
                  )
                }
              }}
              className="bg-surface h-5 w-5 accent-accent"
            />
          </label>
        </section>

        {showDetails && (
          <section className="border-t border-line px-4 py-4">
            {loadingStream ? (
              <p className="py-6 text-center text-sm text-content-muted">Loading stream...</p>
            ) : projection ? (
              <RecorderProjectionView projection={projection} />
            ) : (
              <p className="py-6 text-center text-sm text-content-muted">
                Choose a recorder to inspect their stream.
              </p>
            )}
          </section>
        )}

        {history.length > 0 && (
          <section className="border-t border-line px-4 py-4">
            <h3 className="text-xs font-bold uppercase text-content-muted">Primary history</h3>
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
          </section>
        )}
      </div>
    </div>
  )
}

function RecorderProjectionView({
  projection,
}: {
  projection: SoccerRecorderProjection
}) {
  const soccerState =
    projection.state.sportGameState?.sportId === 'soccer'
      ? projection.state.sportGameState
      : null
  const events = [
    ...projection.inspection.activeEvents,
    ...projection.inspection.deletedEvents,
  ].sort((a, b) => b.sequence - a.sequence)

  return (
    <>
      <div className="flex items-center gap-2">
        <Cloud size={18} className="text-success-content" />
        <h3 className="font-bold text-content">{projection.recorder.displayName}</h3>
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-line border-y border-line py-3 text-center">
        <div>
          <p className="text-2xl font-bold text-success-content">
            {projection.state.homeTeamScore ?? 0}
          </p>
          <p className="truncate text-[11px] text-content-muted" title={gameSideDisplayName(projection.state.gameInfo, 'tracked')}>{gameSideDisplayName(projection.state.gameInfo, 'tracked')}</p>
        </div>
        <div>
          <p className="text-sm font-bold capitalize text-content">
            {soccerState?.projection.status.replace(/_/g, ' ') ?? 'Unknown'}
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
          {projection.inspection.diagnostics.length === 1 ? '' : 's'} and is not eligible for
          a new primary selection or finalization until repaired.
        </div>
      )}

      <div className="mt-4 divide-y divide-line border-t border-line">
        {events.slice(0, 30).map(event => (
          <div key={event.id} className="flex items-center gap-3 py-2 text-xs">
            <span className="w-14 shrink-0 font-semibold tabular-nums text-content-muted">
              {event.period.id} {event.elapsedMs === null ? '' : formatSoccerDuration(event.elapsedMs)}
            </span>
            <span className={`min-w-0 flex-1 truncate text-content ${event.deletedAt ? 'line-through opacity-50' : ''}`}>
              {event.eventType.replace('soccer.', '').replace(/_/g, ' ')}
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

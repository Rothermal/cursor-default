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
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-recorders-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-2xl sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <Users size={20} className="text-emerald-700" />
          <div className="min-w-0 flex-1">
            <h2 id="soccer-recorders-title" className="font-bold text-slate-900">
              Recorder Streams
            </h2>
            <p className="text-xs text-slate-500">
              Streams stay independent; only the primary drives canonical results.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center text-slate-500"
            aria-label="Close"
            title="Close"
          >
            <X size={20} />
          </button>
        </header>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="divide-y divide-slate-200">
          {recorders.map(recorder => (
            <div key={recorder.recorderId} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {recorder.displayName}
                    {recorder.recorderId === currentUserId ? ' (You)' : ''}
                  </p>
                  {recorder.isPrimary && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                      <Star size={13} fill="currentColor" /> Primary
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{recorder.eventCount} events</span>
                  <span className="inline-flex items-center gap-1">
                    {recorder.checkpointCurrent ? (
                      <CheckCircle2 size={13} className="text-emerald-600" />
                    ) : (
                      <AlertTriangle size={13} className="text-amber-600" />
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
                  className="grid h-9 w-9 place-items-center text-slate-600"
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
                    className="h-4 w-4 accent-emerald-700"
                    aria-label={`Select ${recorder.displayName} as primary recorder`}
                  />
                </label>
              )}
            </div>
          ))}
        </section>

        <section className="border-t border-slate-200 px-4 py-3">
          <label className="flex min-h-10 cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-bold text-slate-800">Show stream details</span>
              <span className="block text-xs text-slate-500">
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
              className="h-5 w-5 accent-emerald-700"
            />
          </label>
        </section>

        {showDetails && (
          <section className="border-t border-slate-200 px-4 py-4">
            {loadingStream ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading stream...</p>
            ) : projection ? (
              <RecorderProjectionView projection={projection} />
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                Choose a recorder to inspect their stream.
              </p>
            )}
          </section>
        )}

        {history.length > 0 && (
          <section className="border-t border-slate-200 px-4 py-4">
            <h3 className="text-xs font-bold uppercase text-slate-500">Primary history</h3>
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
        <Cloud size={18} className="text-emerald-700" />
        <h3 className="font-bold text-slate-900">{projection.recorder.displayName}</h3>
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-200 py-3 text-center">
        <div>
          <p className="text-2xl font-bold text-emerald-800">
            {projection.state.homeTeamScore ?? 0}
          </p>
          <p className="text-[11px] text-slate-500">Tracked</p>
        </div>
        <div>
          <p className="text-sm font-bold capitalize text-slate-700">
            {soccerState?.projection.status.replace(/_/g, ' ') ?? 'Unknown'}
          </p>
          <p className="text-[11px] text-slate-500">Stream state</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-800">{projection.state.opponentScore}</p>
          <p className="text-[11px] text-slate-500">Opponent</p>
        </div>
      </div>

      {!projection.inspection.complete && (
        <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This stream has {projection.inspection.diagnostics.length} projection issue
          {projection.inspection.diagnostics.length === 1 ? '' : 's'} and is not eligible for
          a new primary selection or finalization until repaired.
        </div>
      )}

      <div className="mt-4 divide-y divide-slate-100 border-t border-slate-200">
        {events.slice(0, 30).map(event => (
          <div key={event.id} className="flex items-center gap-3 py-2 text-xs">
            <span className="w-14 shrink-0 font-semibold tabular-nums text-slate-500">
              {event.period.id} {event.elapsedMs === null ? '' : formatSoccerDuration(event.elapsedMs)}
            </span>
            <span className={`min-w-0 flex-1 truncate text-slate-700 ${event.deletedAt ? 'line-through opacity-50' : ''}`}>
              {event.eventType.replace('soccer.', '').replace(/_/g, ' ')}
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

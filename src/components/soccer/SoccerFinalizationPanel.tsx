import { AlertTriangle, LockKeyhole, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FlushCloudSyncResult } from '../../context/GameContext'
import type { GameEvent } from '../../lib/gameEvents/types'
import type { GameState } from '../../types'
import {
  finalizeSoccerGame,
  loadSoccerFinalizationReadiness,
  loadSoccerPrimaryFinalizationConflicts,
  reopenSoccerCloudGame,
  resolveSoccerPrimaryFinalizationConflict,
  type SoccerFinalizationReadiness,
  type SoccerFinalizationResult,
  type SoccerPrimaryFinalizationConflict,
} from '../../lib/soccer/finalization'
import { formatSoccerDuration } from '../../lib/soccer'

interface SoccerFinalizationPanelProps {
  baseState: GameState
  currentUserId: string | null
  refreshKey?: string | null
  flushCloudSync?: () => Promise<FlushCloudSyncResult>
  onFinalized: (result: SoccerFinalizationResult) => void
  onReopened: () => void
}

export default function SoccerFinalizationPanel({
  baseState,
  currentUserId,
  refreshKey = null,
  flushCloudSync,
  onFinalized,
  onReopened,
}: SoccerFinalizationPanelProps) {
  const gameId = baseState.cloudSync.gameId
  const [readiness, setReadiness] = useState<SoccerFinalizationReadiness | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const [conflicts, setConflicts] = useState<SoccerPrimaryFinalizationConflict[]>([])

  const refresh = async () => {
    if (!gameId) {
      setReadiness(null)
      return
    }
    setLoading(true)
    try {
      setReadiness(await loadSoccerFinalizationReadiness(gameId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalization readiness could not load.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, refreshKey])

  if (!gameId || (!loading && !readiness && !error)) return null
  if (
    readiness &&
    !readiness.canFinalize &&
    !readiness.canReopen
  ) return null
  if (
    readiness?.canFinalize &&
    !readiness.primaryEnded &&
    readiness.primaryConflictCount === 0
  ) return null

  const handleFinalize = async () => {
    if (!readiness?.canFinalize || busy) return
    setBusy(true)
    setError(null)
    try {
      if (
        readiness.primaryRecorderId === currentUserId &&
        flushCloudSync
      ) {
        const sync = await flushCloudSync()
        if (!sync.ok) throw new Error(sync.reason)
      }
      const result = await finalizeSoccerGame(baseState)
      setReadiness(await loadSoccerFinalizationReadiness(gameId))
      onFinalized(result)
    } catch (err) {
      await refresh()
      setError(err instanceof Error ? err.message : 'Soccer game could not finalize.')
    } finally {
      setBusy(false)
    }
  }

  const openConflicts = async () => {
    if (!gameId) return
    setBusy(true)
    setError(null)
    try {
      setConflicts(await loadSoccerPrimaryFinalizationConflicts(gameId))
      setConflictsOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Primary conflicts could not load.')
    } finally {
      setBusy(false)
    }
  }

  const resolveConflict = async (
    conflict: SoccerPrimaryFinalizationConflict,
    resolution: 'local' | 'remote'
  ) => {
    setBusy(true)
    setError(null)
    try {
      await resolveSoccerPrimaryFinalizationConflict(conflict.conflictId, resolution)
      const next = await loadSoccerPrimaryFinalizationConflicts(gameId)
      setConflicts(next)
      if (next.length === 0) setConflictsOpen(false)
      await refresh()
    } catch (err) {
      await refresh()
      setError(err instanceof Error ? err.message : 'Primary conflict could not resolve.')
    } finally {
      setBusy(false)
    }
  }

  const handleReopen = async () => {
    if (!readiness?.canReopen || reopenReason.trim().length < 3 || busy) return
    setBusy(true)
    setError(null)
    try {
      await reopenSoccerCloudGame(gameId, reopenReason)
      setReopenOpen(false)
      setReopenReason('')
      await refresh()
      onReopened()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Soccer game could not reopen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="border-y border-slate-200 bg-white px-4 py-4">
        <div className="flex items-start gap-3">
          <LockKeyhole size={20} className="mt-0.5 shrink-0 text-emerald-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">
              {readiness?.gameStatus === 'final' ? 'Canonical Result' : 'Cloud Finalization'}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {loading
                ? 'Checking primary recorder...'
                : readiness?.primaryDisplayName
                  ? `Primary: ${readiness.primaryDisplayName}`
                  : 'Primary recorder unavailable'}
            </p>
          </div>
        </div>

        {readiness?.nonPrimaryAttentionCount ? (
          <div className="mt-3 flex items-start gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {readiness.nonPrimaryAttentionCount}{' '}
              {readiness.nonPrimaryAttentionCount === 1 ? 'other stream needs' : 'other streams need'} attention.
            </span>
          </div>
        ) : null}

        {error && (
          <p className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {readiness?.canFinalize && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {readiness.primaryConflictCount > 0 && (
              <button
                type="button"
                onClick={() => { void openConflicts() }}
                disabled={busy}
                className="min-h-11 border border-amber-300 bg-amber-50 px-3 text-sm font-bold text-amber-800 disabled:opacity-50"
              >
                Review {readiness.primaryConflictCount}{' '}
                {readiness.primaryConflictCount === 1 ? 'Conflict' : 'Conflicts'}
              </button>
            )}
            <button
              type="button"
              onClick={() => { void handleFinalize() }}
              disabled={
                busy ||
                !readiness.primaryRecorderId ||
                !readiness.primaryEnded ||
                readiness.primaryConflictCount > 0
              }
              className="min-h-11 bg-emerald-700 px-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? 'Preparing...' : 'Finalize and Lock'}
            </button>
          </div>
        )}

        {readiness?.canReopen && (
          <button
            type="button"
            onClick={() => setReopenOpen(true)}
            disabled={busy}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-50"
          >
            <RotateCcw size={17} /> Reopen Cloud Game
          </button>
        )}
      </section>

      {reopenOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setReopenOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="soccer-cloud-reopen-title"
            className="w-full bg-white p-4 sm:max-w-md"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <h2 id="soccer-cloud-reopen-title" className="min-w-0 flex-1 font-bold text-slate-900">
                Reopen Cloud Game
              </h2>
              <button
                type="button"
                onClick={() => setReopenOpen(false)}
                className="grid h-9 w-9 place-items-center text-slate-500"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <label className="mt-4 block text-xs font-bold text-slate-600" htmlFor="soccer-cloud-reopen-reason">
              Reason
            </label>
            <textarea
              id="soccer-cloud-reopen-reason"
              value={reopenReason}
              onChange={event => setReopenReason(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              autoFocus
            />
            <button
              type="button"
              onClick={() => { void handleReopen() }}
              disabled={busy || reopenReason.trim().length < 3}
              className="mt-3 min-h-11 w-full bg-slate-800 px-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? 'Reopening...' : 'Reopen Game'}
            </button>
          </div>
        </div>
      )}

      {conflictsOpen && conflicts[0] && (
        <PrimaryConflictDialog
          conflict={conflicts[0]}
          remaining={conflicts.length}
          busy={busy}
          onResolve={resolution => { void resolveConflict(conflicts[0], resolution) }}
          onClose={() => setConflictsOpen(false)}
        />
      )}
    </>
  )
}

function PrimaryConflictDialog({
  conflict,
  remaining,
  busy,
  onResolve,
  onClose,
}: {
  conflict: SoccerPrimaryFinalizationConflict
  remaining: number
  busy: boolean
  onResolve: (resolution: 'local' | 'remote') => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-primary-conflict-title"
        className="max-h-[94vh] w-full overflow-y-auto bg-white sm:max-w-2xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="min-w-0 flex-1">
            <h2 id="soccer-primary-conflict-title" className="font-bold text-slate-900">
              Primary Stream Conflict
            </h2>
            <p className="text-xs text-slate-500">
              {remaining} remaining | {conflict.recorderDisplayName}
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
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <ConflictVersion
            title="Recorder Device"
            event={conflict.localEvent}
            action="Keep Device Version"
            disabled={busy}
            onChoose={() => onResolve('local')}
          />
          <ConflictVersion
            title="Cloud"
            event={conflict.remoteEvent}
            action="Keep Cloud Version"
            disabled={busy}
            onChoose={() => onResolve('remote')}
          />
        </div>
      </div>
    </div>
  )
}

function ConflictVersion({
  title,
  event,
  action,
  disabled,
  onChoose,
}: {
  title: string
  event: GameEvent
  action: string
  disabled: boolean
  onChoose: () => void
}) {
  return (
    <section className="border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Type</dt>
        <dd className="truncate font-semibold text-slate-800">
          {event.eventType.replace('soccer.', '').replace(/_/g, ' ')}
        </dd>
        <dt className="text-slate-500">Revision</dt>
        <dd>{event.revision}</dd>
        <dt className="text-slate-500">Time</dt>
        <dd>
          {event.period.id}{' '}
          {event.elapsedMs === null ? '' : formatSoccerDuration(event.elapsedMs)}
        </dd>
        <dt className="text-slate-500">State</dt>
        <dd>{event.deletedAt ? 'Removed' : 'Active'}</dd>
      </dl>
      <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 pt-3 text-[11px] text-slate-600">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
      <button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        className="mt-3 min-h-11 w-full bg-slate-800 px-3 text-sm font-bold text-white disabled:opacity-40"
      >
        {action}
      </button>
    </section>
  )
}

import { AlertTriangle, CheckCircle2, LockKeyhole, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FlushCloudSyncResult } from '../../context/GameContext'
import {
  finalizeBasketballGame,
  loadBasketballCanonicalPublication,
  loadBasketballFinalizationReadiness,
  loadBasketballPrimaryFinalizationConflicts,
  prepareBasketballFinalization,
  resolveBasketballPrimaryFinalizationConflict,
  type BasketballCanonicalPublication,
  type BasketballFinalizationPreview,
  type BasketballFinalizationReadiness,
  type BasketballFinalizationResult,
  type BasketballPrimaryFinalizationConflict,
} from '../../lib/basketball/finalization'

interface BasketballFinalizationPanelProps {
  gameId: string
  gameStatus: string
  currentUserId: string | null
  canManage: boolean
  trackedScore: number | null
  opponentScore: number | null
  ownedLocalTerminal: boolean
  flushCloudSync?: () => Promise<FlushCloudSyncResult>
  onFinalized: (result: BasketballFinalizationResult) => void
}

export default function BasketballFinalizationPanel({
  gameId,
  gameStatus,
  currentUserId,
  canManage,
  trackedScore,
  opponentScore,
  ownedLocalTerminal,
  flushCloudSync,
  onFinalized,
}: BasketballFinalizationPanelProps) {
  const [readiness, setReadiness] = useState<BasketballFinalizationReadiness | null>(null)
  const [publication, setPublication] = useState<BasketballCanonicalPublication | null>(null)
  const [preview, setPreview] = useState<BasketballFinalizationPreview | null>(null)
  const [conflicts, setConflicts] = useState<BasketballPrimaryFinalizationConflict[]>([])
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextReadiness, nextPublication] = await Promise.all([
        loadBasketballFinalizationReadiness(gameId),
        loadBasketballCanonicalPublication(gameId),
      ])
      setReadiness(nextReadiness)
      setPublication(nextPublication)
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Basketball finalization status could not load.'
      )
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => {
    void refresh()
  }, [gameStatus, refresh])

  const openPreview = async () => {
    if (!canManage || busy) return
    setBusy(true)
    setError(null)
    try {
      if (readiness?.primaryRecorderId === currentUserId && flushCloudSync) {
        const sync = await flushCloudSync()
        if (!sync.ok) throw new Error(sync.reason)
      }
      setPreview(await prepareBasketballFinalization(gameId))
      await refresh()
    } catch (caught) {
      await refresh()
      setError(caught instanceof Error ? caught.message : 'Finalization preview could not load.')
    } finally {
      setBusy(false)
    }
  }

  const confirmFinalization = async () => {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await finalizeBasketballGame(preview)
      setPreview(null)
      await refresh()
      onFinalized(result)
    } catch (caught) {
      setPreview(null)
      await refresh()
      setError(caught instanceof Error ? caught.message : 'Basketball game could not finalize.')
    } finally {
      setBusy(false)
    }
  }

  const openConflicts = async () => {
    setBusy(true)
    setError(null)
    try {
      setConflicts(await loadBasketballPrimaryFinalizationConflicts(gameId))
      setConflictsOpen(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Primary conflicts could not load.')
    } finally {
      setBusy(false)
    }
  }

  const resolveConflict = async (
    conflict: BasketballPrimaryFinalizationConflict,
    resolution: 'local' | 'remote'
  ) => {
    setBusy(true)
    setError(null)
    try {
      await resolveBasketballPrimaryFinalizationConflict(conflict.conflictId, resolution)
      const next = await loadBasketballPrimaryFinalizationConflicts(gameId)
      setConflicts(next)
      if (next.length === 0) setConflictsOpen(false)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Primary conflict could not resolve.')
    } finally {
      setBusy(false)
    }
  }

  if (!canManage && !publication) return null
  if (
    !publication &&
    readiness &&
    (!readiness.canFinalize || (
      !readiness.primaryEnded &&
      !ownedLocalTerminal &&
      readiness.primaryConflictCount === 0
    ))
  ) return null
  if (!loading && !readiness && !publication && !error) return null

  return (
    <>
      <section className="card space-y-4" aria-labelledby="basketball-finalization-title">
        <div className="flex items-start gap-3">
          <LockKeyhole size={20} className="mt-0.5 shrink-0 text-emerald-700" />
          <div className="min-w-0 flex-1">
            <h2 id="basketball-finalization-title" className="font-semibold text-slate-800">
              {publication ? 'Canonical Result' : 'Cloud Finalization'}
            </h2>
            <p className="text-xs text-slate-500">
              {loading
                ? 'Checking primary recorder...'
                : publication
                  ? `Publication ${publication.publicationNumber}`
                  : readiness?.primaryDisplayName
                    ? `Primary: ${readiness.primaryDisplayName}`
                    : 'Primary recorder unavailable'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void refresh() }}
            disabled={loading || busy}
            className="grid h-9 w-9 place-items-center text-slate-500 disabled:opacity-40"
            aria-label="Refresh finalization status"
            title="Refresh"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {publication && (
          <div className="border-y border-slate-200 py-3">
            <div className="grid grid-cols-3 divide-x divide-slate-200 text-center">
              <div>
                <p className="text-xl font-bold text-blue-800">{trackedScore ?? '-'}</p>
                <p className="text-[11px] text-slate-500">Tracked</p>
              </div>
              <div>
                <CheckCircle2 size={20} className="mx-auto text-emerald-600" />
                <p className="mt-1 text-[11px] font-bold text-emerald-700">Locked</p>
              </div>
              <div>
                <p className="text-xl font-bold text-slate-800">{opponentScore ?? '-'}</p>
                <p className="text-[11px] text-slate-500">Opponent</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-600">
              Primary: <span className="font-semibold">{publication.primaryDisplayName}</span>
              {' | '}Finalized by {publication.finalizedByDisplayName}
              {' | '}{new Date(publication.finalizedAt).toLocaleString()}
            </p>
          </div>
        )}

        {!publication && readiness?.nonPrimaryAttentionCount ? (
          <div className="flex items-start gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {readiness.nonPrimaryAttentionCount}{' '}
              {readiness.nonPrimaryAttentionCount === 1
                ? 'other stream needs'
                : 'other streams need'} attention. A healthy primary may still finalize.
            </span>
          </div>
        ) : null}

        {error && (
          <p className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {!publication && canManage && readiness?.canFinalize && (
          <div className="grid gap-2 sm:grid-cols-2">
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
              onClick={() => { void openPreview() }}
              disabled={
                busy ||
                !readiness.primaryRecorderId ||
                (
                  !readiness.primaryEnded &&
                  !(ownedLocalTerminal && readiness.primaryRecorderId === currentUserId)
                ) ||
                readiness.primaryConflictCount > 0
              }
              className="min-h-11 bg-emerald-700 px-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy
                ? 'Preparing...'
                : !readiness.primaryEnded && ownedLocalTerminal
                  ? 'Sync and Review'
                  : 'Review Finalization'}
            </button>
          </div>
        )}
      </section>

      {preview && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="basketball-finalization-review-title"
            className="w-full bg-white p-4 sm:max-w-md"
          >
            <div className="flex items-center gap-3">
              <h2 id="basketball-finalization-review-title" className="min-w-0 flex-1 font-bold text-slate-900">
                Finalize Cloud Result
              </h2>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="grid h-9 w-9 place-items-center text-slate-500"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              This locks <span className="font-semibold">{preview.recorder.displayName}</span> as
              the canonical recorder and publishes this result.
            </p>
            <div className="mt-4 grid grid-cols-2 divide-x divide-slate-200 border-y border-slate-200 py-3 text-center">
              <div>
                <p className="text-3xl font-bold text-blue-800">{preview.score.tracked}</p>
                <p className="text-xs text-slate-500">Tracked</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-slate-800">{preview.score.opponent}</p>
                <p className="text-xs text-slate-500">Opponent</p>
              </div>
            </div>
            <p className="mt-3 text-xs font-semibold capitalize text-slate-600">
              {preview.endReason} | checkpoint current | {preview.projection.eventStream.events.length} events
            </p>
            {preview.readiness.nonPrimaryAttentionCount > 0 && (
              <p className="mt-3 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {preview.readiness.nonPrimaryAttentionCount} non-primary stream
                {preview.readiness.nonPrimaryAttentionCount === 1 ? '' : 's'} need attention and
                will remain audit-only.
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="min-h-11 border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void confirmFinalization() }}
                disabled={busy}
                className="min-h-11 bg-emerald-700 px-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? 'Finalizing...' : 'Finalize and Lock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {conflictsOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="basketball-finalization-conflicts-title"
            className="max-h-[85vh] w-full overflow-y-auto bg-white p-4 sm:max-w-lg"
          >
            <div className="flex items-center gap-3">
              <h2 id="basketball-finalization-conflicts-title" className="min-w-0 flex-1 font-bold text-slate-900">
                Primary Stream Conflicts
              </h2>
              <button
                type="button"
                onClick={() => setConflictsOpen(false)}
                disabled={busy}
                className="grid h-9 w-9 place-items-center text-slate-500"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Choose which revision should remain in the selected recorder stream.
            </p>
            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
              {conflicts.map(conflict => (
                <div key={conflict.conflictId} className="py-4">
                  <p className="text-sm font-bold text-slate-800">
                    {conflict.localEvent.eventType.replace('basketball.', '').replace(/_/g, ' ')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {conflict.recorderDisplayName} | detected {new Date(conflict.detectedAt).toLocaleString()}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { void resolveConflict(conflict, 'local') }}
                      disabled={busy}
                      className="min-h-11 border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-800 disabled:opacity-50"
                    >
                      Keep Device Revision {conflict.localEvent.revision}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void resolveConflict(conflict, 'remote') }}
                      disabled={busy}
                      className="min-h-11 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                      Keep Cloud Revision {conflict.remoteEvent.revision}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

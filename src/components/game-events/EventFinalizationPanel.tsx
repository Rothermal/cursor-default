import { AlertTriangle, CheckCircle2, LockKeyhole, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { FlushCloudSyncResult } from '../../context/GameContext'
import type { GameState } from '../../types'
import type {
  EventCanonicalPublication,
  EventCanonicalPublicationHistoryEntry,
  EventFinalizationReadiness,
  EventPrimaryFinalizationConflict,
} from '../../lib/gameEvents/finalization'
import {
  eventFinalizationPreviewSideLabels,
  type EventFinalizationSideLabels,
} from '../../lib/gameEvents/finalizationLabels'

/** What the shared review dialog reads from a sport's finalization preview. */
export interface EventFinalizationPreviewView {
  recorder: { displayName: string }
  readiness: EventFinalizationReadiness
  projection: { state: Pick<GameState, 'gameInfo'>; eventStream: { events: unknown[] } }
  snapshot: unknown
  score: { tracked: number; opponent: number } | null
  endReason: string | null
  blockers?: Array<{ code: string; message: string }>
}

export interface EventFinalizationReopenInput<Publication, Mode extends string> {
  gameId: string
  reason: string
  /** Null unless the sport offered reopen modes for this publication. */
  mode: Mode | null
  publication: Publication | null
  /** Authority input for sports that need it (Basketball anchored reopen); never display labels. */
  baseState: GameState | null
  userId: string | null
}

/**
 * One sport's finalization calls behind the shared Game Info panel. Each sport passes its
 * fixed RPC wrappers; reopen modes are optional (anchored Basketball clock games, 064).
 */
export interface EventFinalizationAdapter<
  Publication extends EventCanonicalPublication<unknown>,
  HistoryEntry extends EventCanonicalPublicationHistoryEntry,
  Preview extends EventFinalizationPreviewView,
  Result,
  ReopenResult,
  Mode extends string = never,
> {
  /** Lowercase sport id: DOM ids and event type prefixes. */
  sportId: string
  /** Sentence-case sport name for messages. */
  label: string
  loadReadiness: (gameId: string) => Promise<EventFinalizationReadiness>
  loadPublication: (gameId: string) => Promise<Publication | null>
  loadPublicationHistory: (gameId: string) => Promise<HistoryEntry[]>
  prepare: (gameId: string, userId: string | null) => Promise<Preview>
  finalize: (preview: Preview, userId: string | null) => Promise<Result>
  loadConflicts: (gameId: string) => Promise<EventPrimaryFinalizationConflict[]>
  resolveConflict: (conflictId: string, resolution: 'local' | 'remote') => Promise<void>
  reopen: (input: EventFinalizationReopenInput<Publication, Mode>) => Promise<ReopenResult>
  reopenModes?: (publication: Publication | null) => Array<{ value: Mode; label: string }> | null
  historyModeLabel?: (entry: HistoryEntry) => string | null
  /** Extra lines under the preview score, such as how the server counts it. */
  previewNote?: (preview: Preview) => ReactNode
}

interface EventFinalizationPanelProps<
  Publication extends EventCanonicalPublication<unknown>,
  HistoryEntry extends EventCanonicalPublicationHistoryEntry,
  Preview extends EventFinalizationPreviewView,
  Result,
  ReopenResult,
  Mode extends string,
> {
  adapter: EventFinalizationAdapter<Publication, HistoryEntry, Preview, Result, ReopenResult, Mode>
  gameId: string
  gameStatus: string
  /** Team names of the inspected cloud game, never the game active on this device. */
  sideLabels: EventFinalizationSideLabels
  baseState?: GameState | null
  currentUserId: string | null
  canManage: boolean
  trackedScore: number | null
  opponentScore: number | null
  ownedLocalTerminal: boolean
  flushCloudSync?: () => Promise<FlushCloudSyncResult>
  onFinalized: (result: Result) => void
  onReopened: (result: ReopenResult, publication: Publication | null) => void | Promise<void>
}

export default function EventFinalizationPanel<
  Publication extends EventCanonicalPublication<unknown>,
  HistoryEntry extends EventCanonicalPublicationHistoryEntry,
  Preview extends EventFinalizationPreviewView,
  Result,
  ReopenResult,
  Mode extends string = never,
>({
  adapter,
  gameId,
  gameStatus,
  sideLabels,
  baseState = null,
  currentUserId,
  canManage,
  trackedScore,
  opponentScore,
  ownedLocalTerminal,
  flushCloudSync,
  onFinalized,
  onReopened,
}: EventFinalizationPanelProps<Publication, HistoryEntry, Preview, Result, ReopenResult, Mode>) {
  const [readiness, setReadiness] = useState<EventFinalizationReadiness | null>(null)
  const [publication, setPublication] = useState<Publication | null>(null)
  const [publicationHistory, setPublicationHistory] = useState<HistoryEntry[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [conflicts, setConflicts] = useState<EventPrimaryFinalizationConflict[]>([])
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const reopenModes = adapter.reopenModes?.(publication) ?? null
  const [chosenReopenMode, setReopenMode] = useState<Mode | null>(null)
  const reopenMode = reopenModes
    ? reopenModes.find(option => option.value === chosenReopenMode)?.value ?? reopenModes[0]?.value ?? null
    : null
  const previewLabels = eventFinalizationPreviewSideLabels(preview?.projection.state, sideLabels)
  const ids = {
    title: `${adapter.sportId}-finalization-title`,
    history: `${adapter.sportId}-publication-history-title`,
    review: `${adapter.sportId}-finalization-review-title`,
    reopen: `${adapter.sportId}-cloud-reopen-title`,
    reason: `${adapter.sportId}-cloud-reopen-reason`,
    conflicts: `${adapter.sportId}-finalization-conflicts-title`,
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextReadiness, nextPublication, nextHistory] = await Promise.all([
        adapter.loadReadiness(gameId),
        adapter.loadPublication(gameId),
        canManage ? adapter.loadPublicationHistory(gameId) : Promise.resolve([] as HistoryEntry[]),
      ])
      setReadiness(nextReadiness)
      setPublication(nextPublication)
      setPublicationHistory(nextHistory)
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `${adapter.label} finalization status could not load.`
      )
    } finally {
      setLoading(false)
    }
  }, [adapter, canManage, gameId])

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
      setPreview(await adapter.prepare(gameId, currentUserId))
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
      const result = await adapter.finalize(preview, currentUserId)
      setPreview(null)
      await refresh()
      onFinalized(result)
    } catch (caught) {
      setPreview(null)
      await refresh()
      setError(caught instanceof Error ? caught.message : `${adapter.label} game could not finalize.`)
    } finally {
      setBusy(false)
    }
  }

  const openConflicts = async () => {
    setBusy(true)
    setError(null)
    try {
      setConflicts(await adapter.loadConflicts(gameId))
      setConflictsOpen(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Primary conflicts could not load.')
    } finally {
      setBusy(false)
    }
  }

  const resolveConflict = async (
    conflict: EventPrimaryFinalizationConflict,
    resolution: 'local' | 'remote'
  ) => {
    setBusy(true)
    setError(null)
    try {
      await adapter.resolveConflict(conflict.conflictId, resolution)
      const next = await adapter.loadConflicts(gameId)
      setConflicts(next)
      if (next.length === 0) setConflictsOpen(false)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Primary conflict could not resolve.')
    } finally {
      setBusy(false)
    }
  }

  const handleReopen = async () => {
    if (!readiness?.canReopen || reopenReason.trim().length < 3 || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await adapter.reopen({
        gameId,
        reason: reopenReason,
        mode: reopenMode,
        publication,
        baseState,
        userId: currentUserId,
      })
      setReopenOpen(false)
      setReopenReason('')
      setPreview(null)
      await onReopened(result, publication)
      await refresh()
    } catch (caught) {
      await refresh()
      setError(caught instanceof Error ? caught.message : `${adapter.label} game could not reopen.`)
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
      <section className="card space-y-4" aria-labelledby={ids.title}>
        <div className="flex items-start gap-3">
          <LockKeyhole size={20} className="mt-0.5 shrink-0 text-success-content" />
          <div className="min-w-0 flex-1">
            <h2 id={ids.title} className="font-semibold text-content">
              {publication ? 'Canonical Result' : 'Cloud Finalization'}
            </h2>
            <p className="text-xs text-content-muted">
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
            className="grid h-9 w-9 place-items-center text-content-muted disabled:bg-control-disabled disabled:text-content-disabled"
            aria-label="Refresh finalization status"
            title="Refresh"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {publication && (
          <div className="border-y border-line py-3">
            <div className="grid grid-cols-3 divide-x divide-line text-center">
              <div>
                <p className="text-xl font-bold text-info-content">{trackedScore ?? '-'}</p>
                <p className="truncate text-[11px] text-content-muted" title={sideLabels.tracked}>{sideLabels.tracked}</p>
              </div>
              <div>
                <CheckCircle2 size={20} className="mx-auto text-success-content" />
                <p className="mt-1 text-[11px] font-bold text-success-content">Locked</p>
              </div>
              <div>
                <p className="text-xl font-bold text-content">{opponentScore ?? '-'}</p>
                <p className="truncate text-[11px] text-content-muted" title={sideLabels.opponent}>{sideLabels.opponent}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-content-muted">
              Primary: <span className="font-semibold">{publication.primaryDisplayName}</span>
              {' | '}Finalized by {publication.finalizedByDisplayName}
              {' | '}{new Date(publication.finalizedAt).toLocaleString()}
            </p>
          </div>
        )}

        {!publication && readiness?.nonPrimaryAttentionCount ? (
          <div className="flex items-start gap-2 bg-warning px-3 py-2 text-xs text-warning-content">
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
          <p className="border border-danger-line bg-danger px-3 py-2 text-xs text-danger-content">
            {error}
          </p>
        )}

        {publication && canManage && readiness?.canReopen && (
          <button
            type="button"
            onClick={() => setReopenOpen(true)}
            disabled={busy}
            className="flex min-h-11 w-full items-center justify-center gap-2 border border-line bg-surface px-3 text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled"
          >
            <RotateCcw size={17} /> Reopen Cloud Game
          </button>
        )}

        {canManage && (
          publicationHistory.length > 1 || publicationHistory.some(item => !item.isActive)
        ) && (
          <section className="border-t border-line pt-3" aria-labelledby={ids.history}>
            <h3 id={ids.history} className="text-sm font-bold text-content">
              Publication History
            </h3>
            <div className="mt-2 divide-y divide-line border-y border-line">
              {publicationHistory.map(item => (
                <div key={item.publicationId} className="py-3 text-xs text-content-muted">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-content">
                      Publication {item.publicationNumber}
                    </span>
                    <span className={item.isActive ? 'font-bold text-success-content' : 'text-content-muted'}>
                      {item.isActive ? 'Active' : 'Invalidated'}
                    </span>
                  </div>
                  <p className="mt-1">Primary: {item.primaryDisplayName}</p>
                  <p>
                    Finalized by {item.finalizedByDisplayName} |{' '}
                    {new Date(item.finalizedAt).toLocaleString()}
                  </p>
                  {!item.isActive && (
                    <p className="mt-1 text-content-muted">
                      {adapter.historyModeLabel?.(item)
                        ? `${adapter.historyModeLabel(item)} | `
                        : ''}
                      {item.invalidationReason} | {item.invalidatedByDisplayName} |{' '}
                      {new Date(item.invalidatedAt!).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {!publication && canManage && readiness?.canFinalize && (
          <div className="grid gap-2 sm:grid-cols-2">
            {readiness.primaryConflictCount > 0 && (
              <button
                type="button"
                onClick={() => { void openConflicts() }}
                disabled={busy}
                className="min-h-11 border border-warning-line bg-warning px-3 text-sm font-bold text-warning-content disabled:bg-control-disabled disabled:text-content-disabled"
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
              className="min-h-11 bg-accent px-3 text-sm font-bold text-accent-content disabled:bg-control-disabled disabled:text-content-disabled"
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
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-overlay/50 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={ids.review}
            className="w-full bg-surface-elevated text-content p-4 sm:max-w-md"
          >
            <div className="flex items-center gap-3">
              <h2 id={ids.review} className="min-w-0 flex-1 font-bold text-content">
                Finalize Cloud Result
              </h2>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="grid h-9 w-9 place-items-center text-content-muted"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <p className="mt-2 text-sm text-content-muted">
              This locks <span className="font-semibold">{preview.recorder.displayName}</span> as
              the canonical recorder and publishes this result.
            </p>
            {preview.score && (
              <div className="mt-4 grid grid-cols-2 divide-x divide-line border-y border-line py-3 text-center">
                <div>
                  <p className="text-3xl font-bold text-info-content">{preview.score.tracked}</p>
                  <p className="truncate text-xs text-content-muted" title={previewLabels.tracked}>{previewLabels.tracked}</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-content">{preview.score.opponent}</p>
                  <p className="truncate text-xs text-content-muted" title={previewLabels.opponent}>{previewLabels.opponent}</p>
                </div>
              </div>
            )}
            {adapter.previewNote?.(preview)}
            <p className="mt-3 text-xs font-semibold capitalize text-content-muted">
              {preview.endReason ?? 'Not ready'} | {preview.readiness.primaryCheckpointCurrent
                ? 'checkpoint current'
                : 'checkpoint pending'} | {preview.projection.eventStream.events.length} events
            </p>
            {preview.readiness.nonPrimaryAttentionCount > 0 && (
              <p className="mt-3 bg-warning px-3 py-2 text-xs text-warning-content">
                {preview.readiness.nonPrimaryAttentionCount} non-primary stream
                {preview.readiness.nonPrimaryAttentionCount === 1 ? '' : 's'} need attention and
                will remain audit-only.
              </p>
            )}
            {preview.blockers && preview.blockers.length > 0 && (
              <div className="mt-3 border border-warning-line bg-warning px-3 py-2 text-xs text-warning-content">
                <p className="font-bold">Finalization needs attention</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {preview.blockers.map(blocker => (
                    <li key={blocker.code}>{blocker.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="min-h-11 border border-line bg-surface px-3 text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void confirmFinalization() }}
                disabled={
                  busy ||
                  (preview.blockers?.length ?? 0) > 0 ||
                  !preview.snapshot ||
                  !preview.score ||
                  !preview.endReason
                }
                className="min-h-11 bg-accent px-3 text-sm font-bold text-accent-content disabled:bg-control-disabled disabled:text-content-disabled"
              >
                {busy ? 'Finalizing...' : 'Finalize and Lock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reopenOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-overlay/50 sm:items-center"
          onClick={() => setReopenOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={ids.reopen}
            className="w-full bg-surface-elevated text-content p-4 sm:max-w-md"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <h2 id={ids.reopen} className="min-w-0 flex-1 font-bold text-content">
                Reopen Cloud Game
              </h2>
              <button
                type="button"
                onClick={() => setReopenOpen(false)}
                disabled={busy}
                className="grid h-9 w-9 place-items-center text-content-muted"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <p className="mt-2 text-sm text-content-muted">
              The current publication stays in history. Reopen the owned recorder stream to make
              corrections, sync it, and publish a new result.
            </p>
            {reopenModes && reopenModes.length > 0 && (
              <fieldset className="mt-4">
                <legend className="text-xs font-bold text-content-muted">Mode</legend>
                <div className="mt-1 grid h-11 grid-cols-2 border border-line bg-surface-muted p-1">
                  {reopenModes.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setReopenMode(option.value)}
                      aria-pressed={reopenMode === option.value}
                      className={`text-sm font-bold ${reopenMode === option.value ? 'bg-surface text-content shadow-sm' : 'text-content-muted'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="mt-4 block text-xs font-bold text-content-muted" htmlFor={ids.reason}>
              Reason
            </label>
            <textarea
              id={ids.reason}
              value={reopenReason}
              onChange={event => setReopenReason(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none border border-line bg-surface text-content px-3 py-2 text-sm outline-none focus:border-focus"
              autoFocus
            />
            <button
              type="button"
              onClick={() => { void handleReopen() }}
              disabled={busy || reopenReason.trim().length < 3}
              className="mt-3 min-h-11 w-full bg-accent px-3 text-sm font-bold text-accent-content disabled:bg-control-disabled disabled:text-content-disabled"
            >
              {busy ? 'Reopening...' : 'Reopen Game'}
            </button>
          </div>
        </div>
      )}

      {conflictsOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-overlay/50 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={ids.conflicts}
            className="max-h-[85vh] w-full overflow-y-auto bg-surface-elevated text-content p-4 sm:max-w-lg"
          >
            <div className="flex items-center gap-3">
              <h2 id={ids.conflicts} className="min-w-0 flex-1 font-bold text-content">
                Primary Stream Conflicts
              </h2>
              <button
                type="button"
                onClick={() => setConflictsOpen(false)}
                disabled={busy}
                className="grid h-9 w-9 place-items-center text-content-muted"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <p className="mt-2 text-sm text-content-muted">
              Choose which revision should remain in the selected recorder stream.
            </p>
            <div className="mt-4 divide-y divide-line border-y border-line">
              {conflicts.map(conflict => (
                <div key={conflict.conflictId} className="py-4">
                  <p className="text-sm font-bold text-content">
                    {conflict.localEvent.eventType.replace(`${adapter.sportId}.`, '').replace(/_/g, ' ')}
                  </p>
                  <p className="mt-1 text-xs text-content-muted">
                    {conflict.recorderDisplayName} | detected {new Date(conflict.detectedAt).toLocaleString()}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { void resolveConflict(conflict, 'local') }}
                      disabled={busy}
                      className="min-h-11 border border-info-line bg-info px-3 text-xs font-bold text-info-content disabled:bg-control-disabled disabled:text-content-disabled"
                    >
                      Keep Device Revision {conflict.localEvent.revision}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void resolveConflict(conflict, 'remote') }}
                      disabled={busy}
                      className="min-h-11 border border-line bg-surface px-3 text-xs font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled"
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

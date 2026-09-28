import { useMemo, useState } from 'react'
import { RotateCcw, Undo2, X } from 'lucide-react'
import {
  deleteSoccerHistoryEvent,
  restoreSoccerHistoryEvent,
  soccerEventDetail,
  soccerEventTimeLabel,
  soccerEventTitle,
  soccerPeriodTimings,
  soccerRecentUndoCandidates,
  type SoccerLiveResult,
} from '../../lib/soccer'
import type { GameEvent, GameEventInspection } from '../../lib/gameEvents/types'
import type { GameState } from '../../types'

interface SoccerRecentEventsSheetProps {
  open: boolean
  state: GameState
  inspection: GameEventInspection
  busy: boolean
  lineupBlockedReason: string | null
  onApply: (result: SoccerLiveResult) => boolean
  onOpenTimeline: () => void
  onClose: () => void
}

/**
 * Field Undo (S4). Lists the newest recorder-entered events; only the top row
 * can be undone, and Restore stays offered until the sheet closes.
 */
export default function SoccerRecentEventsSheet(props: SoccerRecentEventsSheetProps) {
  if (!props.open) return null
  return <RecentEventsSheet {...props} />
}

function RecentEventsSheet({
  state,
  inspection,
  busy,
  lineupBlockedReason,
  onApply,
  onOpenTimeline,
  onClose,
}: SoccerRecentEventsSheetProps) {
  const [undone, setUndone] = useState<GameEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timings = useMemo(() => soccerPeriodTimings(state), [state])
  const recent = useMemo(
    () => soccerRecentUndoCandidates(inspection.activeEvents, { lineupBlockedReason }),
    [inspection.activeEvents, lineupBlockedReason]
  )

  const apply = (result: SoccerLiveResult): boolean => {
    if (!result.ok) {
      setError(result.message)
      return false
    }
    if (inspection.complete && !result.inspection.complete) {
      setError('That change would leave the match history incomplete.')
      return false
    }
    if (!onApply(result)) return false
    setError(null)
    return true
  }

  const undo = () => {
    if (busy || !recent.target || recent.targetBlockedReason) return
    const target = recent.target
    if (apply(deleteSoccerHistoryEvent(state, target.id))) setUndone(target)
  }

  const restore = () => {
    if (busy || !undone) return
    if (apply(restoreSoccerHistoryEvent(state, undone.id))) setUndone(null)
  }

  return (
    <div className="fixed inset-0 z-50 bg-overlay/[0.5] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-recent-events-title"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-lg sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <div className="min-w-0 flex-1">
            <h2 id="soccer-recent-events-title" className="font-bold text-content">Recent events</h2>
            <p className="text-xs text-content-muted">Newest first. Only the newest event can be undone here.</p>
          </div>
          <button type="button" onClick={onClose} className="h-11 w-11 grid place-items-center text-content-muted" aria-label="Close" title="Close"><X size={20} /></button>
        </header>

        <div className="space-y-3 p-4">
          {undone && (
            <div className="flex min-h-12 items-center gap-3 rounded-md border border-info-line bg-info px-3">
              <p className="min-w-0 flex-1 text-sm text-info-content">
                Undid <span className="font-bold">{soccerEventTitle(undone)}</span>
                <span className="block truncate text-xs">{soccerEventDetail(undone)}</span>
              </p>
              <button
                type="button"
                onClick={restore}
                disabled={busy}
                className="flex min-h-11 items-center gap-1.5 px-2 text-sm font-bold text-info-content disabled:text-content-disabled"
              >
                <RotateCcw size={16} /> Restore
              </button>
            </div>
          )}

          {error && (
            <div role="alert" className="border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
              <p>{error}</p>
              <button type="button" onClick={onOpenTimeline} className="mt-1 min-h-11 font-bold underline">Open Timeline</button>
            </div>
          )}

          {recent.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">Nothing recorded yet.</p>
          ) : (
            <ol className="divide-y divide-line border-y border-line">
              {recent.rows.map((row, index) => (
                <li key={row.event.id} className="flex min-h-14 items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    {row.kind === 'stop' ? (
                      <>
                        <p className="text-sm font-semibold text-content-muted">{soccerEventTitle(row.event)}</p>
                        <p className="text-xs text-content-muted">Undo stops here. Use Timeline for earlier events.</p>
                      </>
                    ) : (
                      <>
                        <p className="truncate text-sm font-semibold text-content">{soccerEventTitle(row.event)}</p>
                        <p className="truncate text-xs text-content-muted">{soccerEventDetail(row.event)}</p>
                        <p className="text-[11px] text-content-subtle">{soccerEventTimeLabel(row.event, timings)}</p>
                        {index === 0 && recent.targetBlockedReason && (
                          <p className="text-xs font-semibold text-warning-content">{recent.targetBlockedReason}</p>
                        )}
                      </>
                    )}
                  </div>
                  {index === 0 && row.kind === 'event' && (
                    <button
                      type="button"
                      onClick={undo}
                      disabled={busy || Boolean(recent.targetBlockedReason)}
                      className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled"
                    >
                      <Undo2 size={16} /> Undo
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}

          <button type="button" onClick={onOpenTimeline} className="min-h-11 w-full text-sm font-bold text-success-content">
            Open Timeline
          </button>
        </div>
      </div>
    </div>
  )
}

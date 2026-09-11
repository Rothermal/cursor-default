import { useEffect, useMemo, useRef } from 'react'
import { describeActionLogEntry } from '../lib/actionLogLabels'
import type { ActionLogEntry, Player, SportConfig } from '../types'

interface RecentEventsPopupProps {
  entries: ActionLogEntry[]
  players: Player[]
  sport: SportConfig
  onUndoTop: () => void
  onClose: () => void
  visibleCount?: number
}

export default function RecentEventsPopup({
  entries,
  players,
  sport,
  onUndoTop,
  onClose,
  visibleCount = 5,
}: RecentEventsPopupProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const recent = useMemo(() => entries.slice(-visibleCount).reverse(), [entries, visibleCount])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const undoTop = () => {
    if (entries.length === 0) return
    onUndoTop()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-16 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-events-title"
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg bg-surface shadow-xl border border-line overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="recent-events-title" className="text-base font-bold text-content">
              Recent events
            </h2>
            <p className="text-xs text-content-muted">Newest event is undone first.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="h-9 w-9 shrink-0 rounded-full border border-line text-lg font-semibold text-content-muted
                       active:scale-95 transition-transform"
            aria-label="Close recent events"
          >
            x
          </button>
        </div>

        <div className="min-h-0 max-h-[55vh] overflow-y-auto px-3 py-2">
          {recent.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-content-muted">
              No tracked events yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((entry, index) => {
                const label = describeActionLogEntry(entry, players, sport)
                const isTop = index === 0
                return (
                  <li
                    key={entry.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                      isTop
                        ? 'border-info-line bg-info'
                        : 'border-line bg-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-content">
                        {label.who}
                      </p>
                      <p className="truncate text-sm text-content-muted">{label.what}</p>
                    </div>
                    <button
                      type="button"
                      onClick={isTop ? undoTop : undefined}
                      disabled={!isTop}
                      className={`h-10 shrink-0 rounded-lg px-3 text-sm font-semibold transition-transform ${
                        isTop
                          ? 'bg-accent text-accent-content active:scale-95'
                          : 'border border-line bg-control-disabled text-content-disabled'
                      }`}
                      aria-label={isTop ? `Undo ${label.who} ${label.what}` : 'Undo older event unavailable'}
                      title={isTop ? 'Undo this event' : 'Undo newer events first'}
                    >
                      Undo
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

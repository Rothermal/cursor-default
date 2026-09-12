import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { BasketballCourtCaptureUnit } from '../../lib/basketball/courtCorrections'

interface BasketballRecentEventsPopupProps {
  units: BasketballCourtCaptureUnit[]
  canRestore: boolean
  errorMessage?: string | null
  onUndoTop: () => void
  onRestore: () => void
  onOpenTimeline: () => void
  onClose: () => void
  visibleCount?: number
}

export default function BasketballRecentEventsPopup({
  units,
  canRestore,
  errorMessage,
  onUndoTop,
  onRestore,
  onOpenTimeline,
  onClose,
  visibleCount = 5,
}: BasketballRecentEventsPopupProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const recent = units.slice(0, visibleCount)

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-16 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-recent-events-title"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-recent-events-title" className="text-base font-bold text-content">
              Recent events
            </h2>
            <p className="text-xs text-content-muted">Newest event first. Lifecycle boundaries cannot be undone here.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted active:scale-95 transition-transform"
            aria-label="Close recent events"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 max-h-[55vh] overflow-y-auto px-3 py-2">
          {errorMessage && (
            <p role="alert" className="mb-2 break-words rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">
              {errorMessage}
            </p>
          )}
          {canRestore && (
            <button
              type="button"
              onClick={onRestore}
              className="mb-2 w-full rounded-lg border border-success-line bg-success px-3 py-2.5 text-sm font-semibold text-success-content active:scale-[0.99] transition-transform"
            >
              Restore last undone
            </button>
          )}
          {recent.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-content-muted">
              No tracked events yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((unit, index) => {
                const isTop = index === 0
                const canUndo = isTop && unit.undoable
                const openTimeline = !canUndo && unit.kind !== 'boundary'
                return (
                  <li
                    key={unit.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                      canUndo
                        ? 'border-info-line bg-info'
                        : isTop && unit.kind === 'boundary'
                          ? 'border-warning-line bg-warning'
                          : 'border-line bg-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-content">{unit.who}</p>
                      <p className="truncate text-sm text-content-muted">{unit.what}</p>
                    </div>
                    <button
                      type="button"
                      onClick={canUndo ? onUndoTop : openTimeline ? onOpenTimeline : undefined}
                      disabled={!canUndo && !openTimeline}
                      className={`h-10 shrink-0 rounded-lg px-3 text-sm font-semibold transition-transform ${
                        canUndo || openTimeline
                          ? 'bg-accent text-accent-content active:scale-95'
                          : 'border border-line bg-control-disabled text-content-disabled'
                      }`}
                      aria-label={canUndo
                        ? `Undo ${unit.who} ${unit.what}`
                        : openTimeline
                          ? `Review ${unit.who} ${unit.what} in Timeline`
                        : unit.kind === 'boundary'
                          ? `${unit.what} is a lifecycle boundary`
                          : 'Undo older capture unavailable'}
                      title={canUndo
                        ? 'Undo this capture'
                        : openTimeline
                          ? 'Review consequences in Timeline'
                        : unit.kind === 'boundary'
                          ? 'Use lifecycle controls to manage period transitions'
                          : 'Undo newer captures first'}
                    >
                      {unit.kind === 'boundary' ? 'Boundary' : openTimeline ? 'Timeline' : 'Undo'}
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

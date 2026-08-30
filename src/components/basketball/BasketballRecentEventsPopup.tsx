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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 pt-16 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-recent-events-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-recent-events-title" className="text-base font-bold text-slate-800">
              Recent events
            </h2>
            <p className="text-xs text-slate-500">Newest event first. Lifecycle boundaries cannot be undone here.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 active:scale-95 transition-transform"
            aria-label="Close recent events"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-3 py-2">
          {errorMessage && (
            <p role="alert" className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
              {errorMessage}
            </p>
          )}
          {canRestore && (
            <button
              type="button"
              onClick={onRestore}
              className="mb-2 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 active:scale-[0.99] transition-transform"
            >
              Restore last undone
            </button>
          )}
          {recent.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">
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
                        ? 'border-blue-200 bg-blue-50'
                        : isTop && unit.kind === 'boundary'
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{unit.who}</p>
                      <p className="truncate text-sm text-slate-600">{unit.what}</p>
                    </div>
                    <button
                      type="button"
                      onClick={canUndo ? onUndoTop : openTimeline ? onOpenTimeline : undefined}
                      disabled={!canUndo && !openTimeline}
                      className={`h-10 shrink-0 rounded-lg px-3 text-sm font-semibold transition-transform ${
                        canUndo || openTimeline
                          ? 'bg-blue-600 text-white active:scale-95'
                          : 'border border-slate-200 bg-slate-50 text-slate-400'
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

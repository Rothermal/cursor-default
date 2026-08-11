import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react'
import { useGame } from '../../context/GameContext'
import {
  previewBasketballTimelineRemoval,
  previewBasketballTimelineRestore,
  removeBasketballTimelineEvents,
  restoreBasketballTimelineEvent,
  type BasketballTimelineRemovalScope,
} from '../../lib/basketball/timelineCorrections'

export type BasketballTimelineCorrectionIntent =
  | { kind: 'remove'; eventId: string; scope: BasketballTimelineRemovalScope }
  | { kind: 'restore'; eventId: string }

interface BasketballTimelineCorrectionDialogProps {
  intent: BasketballTimelineCorrectionIntent
  onClose: () => void
  onApplied?: () => void
}

export default function BasketballTimelineCorrectionDialog({
  intent,
  onClose,
  onApplied,
}: BasketballTimelineCorrectionDialogProps) {
  const { state, dispatch } = useGame()
  const [selectedDependentIds, setSelectedDependentIds] = useState<string[]>([])
  const [applyError, setApplyError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setSelectedDependentIds([])
    setApplyError(null)
    closeRef.current?.focus()
  }, [intent.eventId, intent.kind])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        ) ?? []
      )
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const previewResult = useMemo(() => intent.kind === 'remove'
    ? previewBasketballTimelineRemoval(state, intent.eventId, intent.scope)
    : previewBasketballTimelineRestore(state, intent.eventId, selectedDependentIds), [
    intent,
    selectedDependentIds,
    state,
  ])

  const preview = previewResult.ok ? previewResult.value : null
  const previewError = previewResult.ok ? null : previewResult.message
  const title = intent.kind === 'remove'
    ? intent.scope === 'capture_group' ? 'Remove capture?' : 'Remove event?'
    : 'Restore event?'

  const apply = () => {
    if (!preview) return
    const result = preview.kind === 'remove'
      ? removeBasketballTimelineEvents(state, preview)
      : restoreBasketballTimelineEvent(state, preview)
    if (!result.ok) {
      setApplyError(result.message)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    onApplied?.()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-timeline-correction-title"
        className="flex max-h-[92vh] w-full flex-col rounded-t-lg bg-white shadow-2xl sm:max-w-lg sm:rounded-lg sm:border sm:border-slate-200"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-timeline-correction-title" className="text-base font-bold text-slate-900">
              {title}
            </h2>
            {preview && <p className="mt-0.5 truncate text-sm font-medium text-slate-600">{preview.eventLabel}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
            aria-label="Close correction review"
            title="Close"
          >
            <X size={19} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {preview === null ? (
            <p role="alert" className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-900">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden />
              <span>{previewError}</span>
            </p>
          ) : (
            <>
              {preview.kind === 'restore' && preview.restoreOptions.length > 0 && (
                <fieldset className="mb-4 border-y border-slate-200 py-3">
                  <legend className="text-xs font-semibold uppercase text-slate-500">Related removed events</legend>
                  <p className="mt-1 text-xs text-slate-500">Nothing extra is restored unless selected.</p>
                  <div className="mt-2 space-y-1">
                    {preview.restoreOptions.map(option => (
                      <label key={option.eventId} className="flex min-h-11 items-center gap-3 py-1 text-sm font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={selectedDependentIds.includes(option.eventId)}
                          onChange={event => setSelectedDependentIds(current => event.target.checked
                            ? [...current, option.eventId]
                            : current.filter(id => id !== option.eventId))}
                          className="h-5 w-5 rounded border-slate-300 text-blue-600"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <h3 className="text-xs font-semibold uppercase text-slate-500">Match effects</h3>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {preview.consequenceLines.map(line => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {applyError && (
            <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
              {applyError}
            </p>
          )}
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <button type="button" onClick={onClose} className="btn-secondary min-h-11">Cancel</button>
          <button
            type="button"
            disabled={!preview}
            onClick={apply}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-bold text-white disabled:opacity-40 ${
              intent.kind === 'remove' ? 'bg-rose-700' : 'bg-blue-700'
            }`}
          >
            {intent.kind === 'remove' ? <Trash2 size={17} aria-hidden /> : <RotateCcw size={17} aria-hidden />}
            {intent.kind === 'remove' ? 'Remove' : 'Restore'}
          </button>
        </footer>
      </section>
    </div>
  )
}

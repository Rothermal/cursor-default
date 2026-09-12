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
  | { kind: 'restore'; eventId: string; scope?: BasketballTimelineRemovalScope }

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

  const baseRestoreResult = useMemo(() => intent.kind === 'restore'
    ? previewBasketballTimelineRestore(state, intent.eventId, [], undefined, intent.scope ?? 'event')
    : null, [intent, state])

  const previewResult = useMemo(() => {
    if (intent.kind === 'remove') {
      return previewBasketballTimelineRemoval(state, intent.eventId, intent.scope)
    }
    if (selectedDependentIds.length === 0 && baseRestoreResult) return baseRestoreResult
    return previewBasketballTimelineRestore(
      state,
      intent.eventId,
      selectedDependentIds,
      baseRestoreResult?.ok
        ? {
            eventLabel: baseRestoreResult.value.eventLabel,
            restoreOptions: baseRestoreResult.value.restoreOptions,
            streamFingerprint: baseRestoreResult.value.streamFingerprint,
          }
        : undefined,
      intent.scope ?? 'event'
    )
  }, [
    baseRestoreResult,
    intent,
    selectedDependentIds,
    state,
  ])

  const preview = previewResult.ok ? previewResult.value : null
  const baseRestorePreview = baseRestoreResult?.ok ? baseRestoreResult.value : null
  const displayPreview = preview ?? baseRestorePreview
  const restoreOptions = baseRestorePreview?.restoreOptions ?? []
  const previewError = previewResult.ok ? null : previewResult.message
  const title = intent.kind === 'remove'
    ? intent.scope === 'capture_group' ? 'Remove capture?' : 'Remove event?'
    : intent.scope === 'capture_group' ? 'Restore capture?' : 'Restore event?'

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
      className="fixed inset-0 z-[70] flex items-end justify-center bg-overlay/[0.45] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-timeline-correction-title"
        className="flex max-h-[92vh] w-full flex-col rounded-t-lg bg-surface shadow-2xl sm:max-w-lg sm:rounded-lg sm:border sm:border-line"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-timeline-correction-title" className="text-base font-bold text-content">
              {title}
            </h2>
            {displayPreview && (
              <p className="mt-0.5 truncate text-sm font-medium text-content-muted">
                {displayPreview.eventLabel}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted"
            aria-label="Close correction review"
            title="Close"
          >
            <X size={19} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {intent.kind === 'restore' && restoreOptions.length > 0 && (
            <fieldset className="mb-4 border-y border-line py-3">
              <legend className="text-xs font-semibold uppercase text-content-muted">Related removed events</legend>
              <p className="mt-1 text-xs text-content-muted">Nothing extra is restored unless selected.</p>
              <div className="mt-2 space-y-1">
                {restoreOptions.map(option => (
                  <label key={option.eventId} className="flex min-h-11 items-center gap-3 py-1 text-sm font-medium text-content">
                    <input
                      type="checkbox"
                      checked={selectedDependentIds.includes(option.eventId)}
                      onChange={event => setSelectedDependentIds(current => event.target.checked
                        ? [...current, option.eventId]
                        : current.filter(id => id !== option.eventId))}
                      className="h-5 w-5 shrink-0 rounded border-line-strong text-accent accent-accent"
                    />
                    <span className="min-w-0 break-words">{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {preview === null ? (
            <p role="alert" className="flex gap-2 rounded-md border border-warning-line bg-warning px-3 py-3 text-sm font-medium text-warning-content">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden />
              <span className="min-w-0 break-words">{previewError}</span>
            </p>
          ) : (
            <>
              <h3 className="text-xs font-semibold uppercase text-content-muted">Match effects</h3>
              <ul className="mt-2 space-y-2 text-sm text-content">
                {preview.consequenceLines.map(line => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-content-subtle" />
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {applyError && (
            <p role="alert" className="mt-4 break-words rounded-md border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">
              {applyError}
            </p>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-line bg-surface px-4 py-3">
          <button type="button" onClick={onClose} className="btn-secondary min-h-11">Cancel</button>
          <button
            type="button"
            disabled={!preview}
            onClick={apply}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-bold disabled:bg-control-disabled disabled:text-content-disabled ${
              intent.kind === 'remove' ? 'bg-danger-action text-danger-action-content' : 'bg-accent text-accent-content'
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

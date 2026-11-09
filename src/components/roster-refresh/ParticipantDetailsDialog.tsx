import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useModalFocus } from '../../hooks/useModalFocus'

export interface ParticipantDetailsInput {
  number: string
  position: string
  alsoUpdateRoster: boolean
}

interface ParticipantDetailsDialogProps {
  displayName: string
  number: string | null
  position: string | null
  /** Show "Also update team roster" (unchecked by default). */
  canUpdateRoster: boolean
  busy: boolean
  errorMessage: string | null
  maxLength: number
  /** False for sports whose game position is tactical (Soccer): number only. */
  showPosition?: boolean
  onSave: (input: ParticipantDetailsInput) => void
  onClose: () => void
}

/** RTN-2 shared per-player "Edit number / position" dialog. */
export default function ParticipantDetailsDialog({
  displayName, number, position, canUpdateRoster, busy, errorMessage, maxLength, showPosition = true, onSave, onClose,
}: ParticipantDetailsDialogProps) {
  const [nextNumber, setNextNumber] = useState(number ?? '')
  const [nextPosition, setNextPosition] = useState(position ?? '')
  const [alsoUpdateRoster, setAlsoUpdateRoster] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const numberRef = useRef<HTMLInputElement>(null)
  useModalFocus({ enabled: true, dialogRef, initialFocusRef: numberRef, onClose })
  const unchanged = nextNumber.trim() === (number ?? '') && nextPosition.trim() === (position ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-16 sm:items-center sm:p-4" onClick={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="participant-details-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="participant-details-title" className="text-base font-bold text-content">{showPosition ? 'Edit number / position' : 'Edit number'}</h2>
            <p className="break-words text-xs text-content-muted">{displayName}. The new number shows everywhere in this game.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted" aria-label="Close edit number and position">
            <X size={18} aria-hidden />
          </button>
        </header>
        <form
          className="space-y-4 px-4 py-4"
          onSubmit={event => {
            event.preventDefault()
            if (unchanged) return
            onSave({ number: nextNumber, position: nextPosition, alsoUpdateRoster })
          }}
        >
          <div className={showPosition ? 'grid grid-cols-[6rem_minmax(0,1fr)] gap-3' : 'grid grid-cols-[6rem] gap-3'}>
            <label className="block text-sm font-semibold text-content">
              Number
              <input ref={numberRef} type="text" value={nextNumber} onChange={event => setNextNumber(event.target.value)} className="input-field mt-1" inputMode="numeric" maxLength={maxLength} placeholder="#" />
            </label>
            {showPosition && <label className="block min-w-0 text-sm font-semibold text-content">
              Position
              <input type="text" value={nextPosition} onChange={event => setNextPosition(event.target.value)} className="input-field mt-1 w-full" maxLength={maxLength} placeholder="Position (optional)" />
            </label>}
          </div>
          {canUpdateRoster && (
            <label className="flex items-center gap-2 text-sm text-content">
              <input type="checkbox" className="h-4 w-4" checked={alsoUpdateRoster} onChange={event => setAlsoUpdateRoster(event.target.checked)} />
              Also update team roster
            </label>
          )}
          {errorMessage && (
            <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">{errorMessage}</p>
          )}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={busy || unchanged} className="btn-primary px-4 py-2 text-sm disabled:bg-control-disabled disabled:text-content-disabled">Save</button>
          </div>
        </form>
      </section>
    </div>
  )
}

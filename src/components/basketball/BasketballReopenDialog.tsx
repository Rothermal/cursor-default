import { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'

interface BasketballReopenDialogProps {
  statusLabel: string
  errorMessage?: string | null
  onSubmit: (reason: string) => void
  onClose: () => void
}

export default function BasketballReopenDialog({
  statusLabel,
  errorMessage,
  onSubmit,
  onClose,
}: BasketballReopenDialogProps) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const trimmedReason = reason.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-12 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-reopen-title"
        className="w-full max-w-lg rounded-lg border border-line bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-reopen-title" className="text-base font-bold text-content">Reopen game</h2>
            <p className="text-xs text-content-muted">{statusLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted" aria-label="Close reopen sheet">
            <X size={18} aria-hidden />
          </button>
        </header>

        <form className="space-y-4 px-4 py-4" onSubmit={event => { event.preventDefault(); if (trimmedReason.length >= 3) onSubmit(trimmedReason) }}>
          <label className="block text-sm font-semibold text-content">
            Reason
            <textarea
              autoFocus
              value={reason}
              onChange={event => setReason(event.target.value)}
              className="input-field mt-1 min-h-24 resize-y"
              maxLength={240}
              placeholder="Why is this game being reopened?"
            />
          </label>
          {errorMessage && <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">{errorMessage}</p>}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={trimmedReason.length < 3} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:bg-control-disabled disabled:text-content-disabled">
              <RotateCcw size={16} aria-hidden />
              Reopen game
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

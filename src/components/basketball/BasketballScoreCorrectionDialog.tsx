import { useEffect, useRef, useState } from 'react'
import { FilePenLine, X } from 'lucide-react'
import type { BasketballTeamSide } from '../../lib/basketball/types'

interface BasketballScoreCorrectionDialogProps {
  trackedTeamName: string
  opponentName: string
  trackedScore: number
  opponentScore: number
  errorMessage?: string | null
  onSubmit: (input: { teamSide: BasketballTeamSide; delta: number; note: string }) => void
  onClose: () => void
}

export default function BasketballScoreCorrectionDialog({
  trackedTeamName,
  opponentName,
  trackedScore,
  opponentScore,
  errorMessage,
  onSubmit,
  onClose,
}: BasketballScoreCorrectionDialogProps) {
  const [teamSide, setTeamSide] = useState<BasketballTeamSide>('tracked')
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const deltaRef = useRef<HTMLInputElement>(null)
  const parsedDelta = Number(delta)
  const validDelta = Number.isInteger(parsedDelta) && parsedDelta !== 0

  useEffect(() => {
    deltaRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-16 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-score-correction-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id="basketball-score-correction-title" className="text-base font-bold text-content">
            Official score correction
          </h2>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted" aria-label="Close score correction">
            <X size={18} aria-hidden />
          </button>
        </header>

        <form
          className="space-y-4 px-4 py-4"
          onSubmit={event => {
            event.preventDefault()
            if (!validDelta || !note.trim()) return
            onSubmit({ teamSide, delta: parsedDelta, note: note.trim() })
          }}
        >
          <div className="grid grid-cols-2 rounded-lg bg-surface-muted p-1" role="group" aria-label="Team to correct">
            {([['tracked', trackedTeamName, trackedScore], ['opponent', opponentName, opponentScore]] as const).map(([side, name, score]) => (
              <button
                key={side}
                type="button"
                onClick={() => setTeamSide(side)}
                className={`min-h-12 rounded-md px-2 py-1 text-sm font-semibold ${teamSide === side ? 'bg-surface text-content shadow-sm' : 'text-content-muted'}`}
                aria-pressed={teamSide === side}
              >
                <span className="block line-clamp-1 break-words">{name}</span>
                <span className="block text-xs font-normal">{score} points</span>
              </button>
            ))}
          </div>

          <label className="block text-sm font-semibold text-content">
            Signed adjustment
            <input
              ref={deltaRef}
              type="number"
              step="1"
              value={delta}
              onChange={event => setDelta(event.target.value)}
              className="input-field mt-1"
              placeholder="Example: -2 or 3"
            />
          </label>

          <label className="block text-sm font-semibold text-content">
            Reason
            <textarea
              value={note}
              onChange={event => setNote(event.target.value)}
              className="input-field mt-1 min-h-20 resize-none"
              maxLength={240}
              placeholder="Official correction note"
            />
          </label>

          {errorMessage && <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">{errorMessage}</p>}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={!validDelta || !note.trim()} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:bg-control-disabled disabled:text-content-disabled">
              <FilePenLine size={16} aria-hidden />
              Apply
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

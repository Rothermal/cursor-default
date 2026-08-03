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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 pt-16 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-score-correction-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 id="basketball-score-correction-title" className="text-base font-bold text-slate-800">
            Official score correction
          </h2>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500" aria-label="Close score correction">
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
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="group" aria-label="Team to correct">
            {([['tracked', trackedTeamName, trackedScore], ['opponent', opponentName, opponentScore]] as const).map(([side, name, score]) => (
              <button
                key={side}
                type="button"
                onClick={() => setTeamSide(side)}
                className={`min-h-12 rounded-md px-2 py-1 text-sm font-semibold ${teamSide === side ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
                aria-pressed={teamSide === side}
              >
                <span className="block line-clamp-1 break-words">{name}</span>
                <span className="block text-xs font-normal">{score} points</span>
              </button>
            ))}
          </div>

          <label className="block text-sm font-semibold text-slate-700">
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

          <label className="block text-sm font-semibold text-slate-700">
            Reason
            <textarea
              value={note}
              onChange={event => setNote(event.target.value)}
              className="input-field mt-1 min-h-20 resize-none"
              maxLength={240}
              placeholder="Official correction note"
            />
          </label>

          {errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{errorMessage}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={!validDelta || !note.trim()} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40">
              <FilePenLine size={16} aria-hidden />
              Apply
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

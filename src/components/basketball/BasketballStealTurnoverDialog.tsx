import { useEffect, useState } from 'react'
import { Link2, X } from 'lucide-react'
import type { BasketballTurnoverTarget } from '../../lib/basketball/directCommands'

interface TurnoverCandidate {
  playerId: string
  label: string
}

interface BasketballStealTurnoverDialogProps {
  stealerLabel: string
  turnoverTeamName: string
  candidates: TurnoverCandidate[]
  errorMessage?: string | null
  onSubmit: (target: BasketballTurnoverTarget) => void
  onClose: () => void
}

export default function BasketballStealTurnoverDialog({
  stealerLabel,
  turnoverTeamName,
  candidates,
  errorMessage,
  onSubmit,
  onClose,
}: BasketballStealTurnoverDialogProps) {
  const [selection, setSelection] = useState('team')
  const [unknownLabel, setUnknownLabel] = useState('')

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const target = (): BasketballTurnoverTarget | null => {
    if (selection === 'team') return { kind: 'team' }
    if (selection === 'unknown') {
      return unknownLabel.trim() ? { kind: 'unknown', label: unknownLabel.trim() } : null
    }
    return { kind: 'player', playerId: selection }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 pt-16 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-steal-turnover-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-steal-turnover-title" className="text-base font-bold text-slate-800">Steal + turnover</h2>
            <p className="truncate text-xs text-slate-500">Steal: {stealerLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500" aria-label="Close steal and turnover">
            <X size={18} aria-hidden />
          </button>
        </header>

        <form
          className="space-y-4 px-4 py-4"
          onSubmit={event => {
            event.preventDefault()
            const value = target()
            if (value) onSubmit(value)
          }}
        >
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-700">Turnover by {turnoverTeamName}</legend>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
              {[{ id: 'team', label: `${turnoverTeamName} team` }, ...candidates.map(candidate => ({ id: candidate.playerId, label: candidate.label })), { id: 'unknown', label: 'Unknown player' }].map(option => (
                <label key={option.id} className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${selection === option.id ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700'}`}>
                  <input type="radio" name="turnover-actor" value={option.id} checked={selection === option.id} onChange={() => setSelection(option.id)} />
                  <span className="break-words">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {selection === 'unknown' && (
            <label className="block text-sm font-semibold text-slate-700">
              Player label
              <input autoFocus type="text" value={unknownLabel} onChange={event => setUnknownLabel(event.target.value)} className="input-field mt-1" maxLength={80} placeholder="Unknown player label" />
            </label>
          )}

          {errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{errorMessage}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={target() === null} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40">
              <Link2 size={16} aria-hidden />
              Record both
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

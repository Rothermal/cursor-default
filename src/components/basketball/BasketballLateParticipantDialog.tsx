import { useEffect, useRef, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import type { BasketballTeamSide } from '../../lib/basketball/types'

interface BasketballLateParticipantDialogProps {
  trackedTeamName: string
  opponentName: string
  defaultSide: BasketballTeamSide
  errorMessage?: string | null
  onAdd: (input: { teamSide: BasketballTeamSide; displayName: string; number: string }) => void
  onClose: () => void
}

export default function BasketballLateParticipantDialog({
  trackedTeamName,
  opponentName,
  defaultSide,
  errorMessage,
  onAdd,
  onClose,
}: BasketballLateParticipantDialogProps) {
  const [teamSide, setTeamSide] = useState<BasketballTeamSide>(defaultSide)
  const [displayName, setDisplayName] = useState('')
  const [number, setNumber] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
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
        aria-labelledby="basketball-add-participant-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 id="basketball-add-participant-title" className="text-base font-bold text-slate-800">
              Add participant
            </h2>
            <p className="text-xs text-slate-500">Available immediately for this game.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500" aria-label="Close add participant">
            <X size={18} aria-hidden />
          </button>
        </header>

        <form
          className="space-y-4 px-4 py-4"
          onSubmit={event => {
            event.preventDefault()
            if (!displayName.trim()) return
            onAdd({ teamSide, displayName, number })
          }}
        >
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Team</span>
            <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="group" aria-label="Participant team">
              {([
                ['tracked', trackedTeamName],
                ['opponent', opponentName],
              ] as const).map(([side, label]) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setTeamSide(side)}
                  className={`min-h-10 rounded-md px-2 text-sm font-semibold ${
                    teamSide === side ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                  aria-pressed={teamSide === side}
                >
                  <span className="line-clamp-2 break-words">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <label className="block text-sm font-semibold text-slate-700">
              Number
              <input
                type="text"
                value={number}
                onChange={event => setNumber(event.target.value)}
                className="input-field mt-1"
                inputMode="numeric"
                maxLength={8}
                placeholder="#"
              />
            </label>
            <label className="block min-w-0 text-sm font-semibold text-slate-700">
              Name
              <input
                ref={nameRef}
                type="text"
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                className="input-field mt-1 w-full"
                maxLength={80}
                placeholder="Participant name"
              />
            </label>
          </div>

          {errorMessage && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
              {errorMessage}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={!displayName.trim()} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40">
              <UserPlus size={16} aria-hidden />
              Add
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

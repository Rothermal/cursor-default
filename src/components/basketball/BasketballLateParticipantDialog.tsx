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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-16 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-add-participant-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="basketball-add-participant-title" className="text-base font-bold text-content">
              Add participant
            </h2>
            <p className="text-xs text-content-muted">Available immediately for this game.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted" aria-label="Close add participant">
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
            <span className="mb-1.5 block text-sm font-semibold text-content">Team</span>
            <div className="grid grid-cols-2 rounded-lg bg-surface-muted p-1" role="group" aria-label="Participant team">
              {([
                ['tracked', trackedTeamName],
                ['opponent', opponentName],
              ] as const).map(([side, label]) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setTeamSide(side)}
                  className={`min-h-10 rounded-md px-2 text-sm font-semibold ${
                    teamSide === side ? 'bg-surface text-content shadow-sm' : 'text-content-muted'
                  }`}
                  aria-pressed={teamSide === side}
                >
                  <span className="line-clamp-2 break-words">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <label className="block text-sm font-semibold text-content">
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
            <label className="block min-w-0 text-sm font-semibold text-content">
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
            <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">
              {errorMessage}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={!displayName.trim()} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:bg-control-disabled disabled:text-content-disabled">
              <UserPlus size={16} aria-hidden />
              Add
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import type { BasketballFreeThrowTripStatus } from '../../lib/basketball/foulFreeThrowCommands'

export interface BasketballFreeThrowShooterCandidate {
  playerId: string
  label: string
}

interface BasketballFreeThrowTripDialogProps {
  trip: BasketballFreeThrowTripStatus
  teamName: string
  candidates: BasketballFreeThrowShooterCandidate[]
  suggestedPlayerId?: string | null
  errorMessage?: string | null
  onRecord: (playerId: string, made: boolean) => void
  onRemove: () => void
  onClose: () => void
}

export default function BasketballFreeThrowTripDialog({
  trip,
  teamName,
  candidates,
  suggestedPlayerId = null,
  errorMessage,
  onRecord,
  onRemove,
  onClose,
}: BasketballFreeThrowTripDialogProps) {
  const initialPlayerId = candidates.some(candidate => candidate.playerId === suggestedPlayerId)
    ? suggestedPlayerId!
    : candidates[0]?.playerId ?? ''
  const [playerId, setPlayerId] = useState(initialPlayerId)
  const activeAttempts = useMemo(
    () => trip.attempts.filter(attempt => !attempt.deleted),
    [trip.attempts]
  )

  useEffect(() => {
    if (!candidates.some(candidate => candidate.playerId === playerId)) {
      setPlayerId(candidates[0]?.playerId ?? '')
    }
  }, [candidates, playerId])

  useEffect(() => {
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
        aria-labelledby="basketball-free-throw-trip-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-free-throw-trip-title" className="text-base font-bold text-slate-800">Awarded free throws</h2>
            <p className="truncate text-xs text-slate-500">
              {teamName} · {trip.oneAndOne ? 'One-and-one' : `${trip.maximumAttempts} shot${trip.maximumAttempts === 1 ? '' : 's'}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500" aria-label="Close free-throw trip">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-700">
              Attempt {trip.nextAttemptNumber ?? trip.maximumAttempts} of {trip.maximumAttempts}
            </span>
            <div className="flex gap-1" aria-label="Recorded attempts">
              {Array.from({ length: trip.maximumAttempts }, (_, index) => {
                const position = index + 1
                const attempt = trip.attempts.find(candidate => candidate.attemptNumber === position)
                return (
                  <span
                    key={position}
                    title={attempt?.deleted ? `Attempt ${position} removed` : attempt ? `Attempt ${position} ${attempt.made ? 'made' : 'missed'}` : `Attempt ${position} pending`}
                    className={`flex h-7 min-w-7 items-center justify-center rounded-md border px-1 text-xs font-bold ${
                      attempt?.deleted
                        ? 'border-slate-200 bg-slate-100 text-slate-400 line-through'
                        : attempt?.made
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : attempt
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-slate-200 bg-white text-slate-400'
                    }`}
                  >
                    {position}
                  </span>
                )
              })}
            </div>
          </div>

          <label className="block text-sm font-semibold text-slate-700">
            Shooter
            <select value={playerId} onChange={event => setPlayerId(event.target.value)} className="input-field mt-1" disabled={candidates.length === 0}>
              {candidates.length === 0 && <option value="">No eligible players</option>}
              {candidates.map(candidate => <option key={candidate.playerId} value={candidate.playerId}>{candidate.label}</option>)}
            </select>
          </label>

          {activeAttempts.length > 0 && (
            <p className="text-xs font-medium text-slate-500">
              {activeAttempts.filter(attempt => attempt.made).length} made · {activeAttempts.filter(attempt => !attempt.made).length} missed
            </p>
          )}

          {errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{errorMessage}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onRecord(playerId, false)} disabled={!trip.open || !playerId} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white active:scale-95 disabled:opacity-40">
              <X size={17} aria-hidden />
              Miss
            </button>
            <button type="button" onClick={() => onRecord(playerId, true)} disabled={!trip.open || !playerId} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white active:scale-95 disabled:opacity-40">
              <Check size={17} aria-hidden />
              Made
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onRemove} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-rose-700">
              <Trash2 size={16} aria-hidden />
              Remove award
            </button>
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Done</button>
          </div>
        </div>
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import ActorSelect, { type ActorOption } from '../ActorSelect'
import type { BasketballFreeThrowTripStatus } from '../../lib/basketball/foulFreeThrowCommands'

export default function BasketballQuickFreeThrowDialog({ teamName, candidates, trips, defaultPlayerId,
  error, onTrip, onRecord, onClose }: {
  teamName: string
  candidates: ActorOption[]
  trips: BasketballFreeThrowTripStatus[]
  defaultPlayerId: string | null
  error: string | null
  onTrip: (trip: BasketballFreeThrowTripStatus) => void
  onRecord: (playerId: string, made: boolean) => void
  onClose: () => void
}) {
  const [playerId, setPlayerId] = useState(candidates.some(candidate => candidate.value === defaultPlayerId) ? defaultPlayerId! : '')
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="Free throw" className="max-h-[90dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-lg border border-line bg-surface p-4" onClick={event => event.stopPropagation()}>
      <header className="flex items-center justify-between gap-2"><h2 className="min-w-0 break-words font-semibold text-content">{teamName} - Free Throw</h2>
        <button type="button" className="shrink-0 p-2 text-content" aria-label="Close free throw" onClick={onClose}><X size={18} /></button></header>
      {trips.length ? trips.map((trip, index) => <button key={trip.eventId} type="button" className="btn-secondary w-full" onClick={() => onTrip(trip)}>
        Award {index + 1}: attempt {trip.nextAttemptNumber} of {trip.maximumAttempts}{trip.oneAndOne ? ' (one-and-one)' : ''}
      </button>) : <>
        <ActorSelect label="Shooter" value={playerId} options={candidates} onChange={setPlayerId} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={() => onRecord(playerId, false)}>Miss</button>
          <button type="button" className="btn-primary" onClick={() => onRecord(playerId, true)}>Made</button>
        </div>
      </>}
      {error && <p role="alert" className="text-sm text-danger-content">{error}</p>}
    </section>
  </div>
}

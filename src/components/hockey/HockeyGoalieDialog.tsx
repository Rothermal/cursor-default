import { X } from 'lucide-react'
import { useId, useState } from 'react'
import { createHockeyUuid } from '../../lib/hockey/id'
import {
  hockeyAvailableParticipants,
  hockeyGoalieChoices,
  hockeyOpponentGoalieChoices,
  hockeyOpponentGoalieLabel,
  type HockeyOpponentGoalie,
  type HockeySide,
  type HockeySportGameState,
} from '../../lib/hockey'

export interface HockeyGoalieChange {
  side: HockeySide
  inParticipantId: string | null
  newOpponentGoalie?: HockeyOpponentGoalie | null
}

interface HockeyGoalieDialogProps {
  sport: HockeySportGameState
  trackedLabel: string
  opponentLabel: string
  /** Returns an error message, or null once the change is recorded. */
  onSubmit: (change: HockeyGoalieChange) => string | null
  onClose: () => void
}

/** Goalie changes and pulls for either net (HKY-2B). New opponent goalies are added here. */
export default function HockeyGoalieDialog({ sport, trackedLabel, opponentLabel, onSubmit, onClose }: HockeyGoalieDialogProps) {
  const titleId = useId()
  const [side, setSide] = useState<HockeySide>('tracked')
  const [newLabel, setNewLabel] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const current = sport.projection.goalieInNet[side]

  const choices = side === 'tracked'
    ? hockeyAvailableParticipants(hockeyGoalieChoices(sport.setup), sport.projection).map(participant => ({
        id: participant.id,
        label: participant.number ? `#${participant.number} ${participant.displayName}` : participant.displayName,
      }))
    : hockeyOpponentGoalieChoices(sport.projection).map(goalie => ({ id: goalie.id, label: hockeyOpponentGoalieLabel(goalie) }))

  const submit = (change: HockeyGoalieChange) => {
    const message = onSubmit(change)
    if (message) setError(message)
  }

  const addOpponentGoalie = () => {
    const label = newLabel.trim() || null
    const number = newNumber.trim() || null
    if (!label && !number) {
      setError('Enter a number or name for the new goalie.')
      return
    }
    const id = createHockeyUuid()
    submit({ side: 'opponent', inParticipantId: id, newOpponentGoalie: { id, label, number } })
  }

  return (
    <div className="fixed inset-0 z-50 bg-overlay/[0.5] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-bold text-content">Goalie change</h2>
          <button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-content-muted" aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-1 rounded-md bg-control p-1">
            {(['tracked', 'opponent'] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={side === value}
                onClick={() => { setSide(value); setError(null) }}
                className={`min-h-10 truncate rounded px-2 text-sm font-semibold ${side === value ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
              >
                {value === 'tracked' ? trackedLabel : opponentLabel}
              </button>
            ))}
          </div>

          <ul className="space-y-2">
            {choices.map(choice => (
              <li key={choice.id}>
                <button
                  type="button"
                  className="btn-secondary w-full justify-between"
                  disabled={choice.id === current}
                  onClick={() => submit({ side, inParticipantId: choice.id })}
                >
                  <span className="truncate">{choice.label}</span>
                  <span className="text-xs text-content-muted">{choice.id === current ? 'In net' : 'Put in net'}</span>
                </button>
              </li>
            ))}
          </ul>

          {side === 'opponent' && (
            <fieldset className="rounded-md border border-line p-3">
              <legend className="px-1 text-xs font-bold uppercase text-content-muted">New opponent goalie</legend>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                <input className="input-field" aria-label="Number" placeholder="#" maxLength={3} value={newNumber} onChange={event => setNewNumber(event.target.value)} />
                <input className="input-field" aria-label="Name" placeholder="Name (optional)" maxLength={80} value={newLabel} onChange={event => setNewLabel(event.target.value)} />
              </div>
              <button type="button" className="btn-secondary mt-2 w-full" onClick={addOpponentGoalie}>Add and put in net</button>
            </fieldset>
          )}

          <button
            type="button"
            className="btn-secondary w-full"
            disabled={current === null}
            onClick={() => submit({ side, inParticipantId: null })}
          >
            {current === null ? 'Net is empty' : 'Pull goalie for an extra attacker'}
          </button>

          {error && (
            <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

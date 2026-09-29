import { useState } from 'react'
import {
  hockeyShootoutEligibleShooters,
  type HockeyActorChoice,
  type HockeyShootoutOutcome,
  type HockeySide,
  type HockeySportGameState,
  type RecordHockeyShootoutAttemptInput,
} from '../../lib/hockey'
import { ActorField } from './hockeyFields'

interface HockeyShootoutPanelProps {
  sport: HockeySportGameState
  sideLabel: (side: HockeySide) => string
  recentOpponentLabels: string[]
  /** False once the match has ended: the panel only shows the attempts. */
  canRecord: boolean
  onStart: (firstSide: HockeySide) => void
  /** Returns an error message, or null once recorded. */
  onAttempt: (input: RecordHockeyShootoutAttemptInput) => string | null
  onEnd: () => void
}

const OUTCOMES: Array<{ value: HockeyShootoutOutcome; label: string }> = [
  { value: 'goal', label: 'Goal' },
  { value: 'saved', label: 'Save' },
  { value: 'missed', label: 'Miss' },
]

/**
 * The shootout (HKY-3C): pick who shoots first, then record each attempt for the side whose
 * turn it is. Attempts are marks per round, never shots or goals in player totals.
 */
export default function HockeyShootoutPanel({
  sport,
  sideLabel,
  recentOpponentLabels,
  canRecord,
  onStart,
  onAttempt,
  onEnd,
}: HockeyShootoutPanelProps) {
  const { setup, projection } = sport
  const shootout = projection.shootout
  const [shooter, setShooter] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!shootout) {
    if (!projection.shootoutAvailable || !canRecord) return null
    return (
      <section className="space-y-2 rounded-md border border-line p-3" aria-label="Shootout">
        <h2 className="font-bold text-content">Shootout</h2>
        <p className="text-sm text-content-muted">Still tied after overtime. Who shoots first?</p>
        <div className="grid grid-cols-2 gap-2">
          {(['tracked', 'opponent'] as const).map(side => (
            <button key={side} type="button" className="btn-secondary" onClick={() => onStart(side)}>
              {sideLabel(side)}
            </button>
          ))}
        </div>
      </section>
    )
  }

  const next = shootout.nextSide
  const record = (outcome: HockeyShootoutOutcome) => {
    const trimmed = shooter.trim()
    const choice: HockeyActorChoice | null = !trimmed || !next
      ? null
      : next === 'tracked' ? { participantId: trimmed } : { label: trimmed }
    const message = onAttempt({ outcome, shooter: choice })
    setError(message)
    if (!message) setShooter('')
  }

  return (
    <section className="space-y-3 rounded-md border border-line p-3" aria-label="Shootout">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold text-content">Shootout</h2>
        <p className="text-sm tabular-nums text-content-muted" aria-label="Shootout goals">
          {shootout.goals.tracked} - {shootout.goals.opponent}
        </p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {(['tracked', 'opponent'] as const).map(side => (
            <tr key={side}>
              <th scope="row" className="w-1/3 truncate py-0.5 pr-2 text-left font-semibold text-content">{sideLabel(side)}</th>
              <td className="py-0.5">
                <span className="flex flex-wrap gap-1">
                  {shootout.attempts.filter(attempt => attempt.side === side).map(attempt => (
                    <span
                      key={attempt.eventId}
                      className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${attempt.outcome === 'goal' ? 'bg-accent text-accent-content' : 'border border-line-strong text-content-muted'}`}
                      aria-label={`Round ${attempt.round}: ${attempt.outcome === 'goal' ? 'goal' : attempt.outcome === 'saved' ? 'saved' : 'missed'}`}
                      title={attempt.shooterLabel ?? setup.participants.find(entry => entry.id === attempt.shooterParticipantId)?.displayName ?? undefined}
                    >
                      {attempt.outcome === 'goal' ? '✓' : '✕'}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shootout.winner ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-content">Shootout won by {sideLabel(shootout.winner)}.</p>
          {canRecord && (
            <button type="button" className="btn-primary w-full" onClick={onEnd}>End game</button>
          )}
        </div>
      ) : canRecord && next ? (
        <div className="space-y-2">
          <p className="text-sm text-content-muted">
            {shootout.suddenDeath ? 'Sudden death, ' : ''}round {shootout.round}: {sideLabel(next)} shooting
          </p>
          <ActorField
            key={next}
            label="Shooter"
            owner={next}
            value={shooter}
            onChange={setShooter}
            trackedOptions={hockeyShootoutEligibleShooters(setup, projection)}
            recentLabels={recentOpponentLabels}
            emptyLabel="Not named"
          />
          <div className="grid grid-cols-3 gap-2">
            {OUTCOMES.map(outcome => (
              <button key={outcome.value} type="button" className="btn-secondary" onClick={() => record(outcome.value)}>
                {outcome.label}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

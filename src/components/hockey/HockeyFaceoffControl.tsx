import { useState } from 'react'
import {
  hockeyFaceoffTakerDefault,
  hockeySkaterChoices,
  hockeyZone,
  HOCKEY_FACEOFF_DOTS,
  type HockeyFaceoffDotId,
  type HockeySide,
  type HockeySportGameState,
} from '../../lib/hockey'

interface HockeyFaceoffControlProps {
  sport: HockeySportGameState
  dotId: HockeyFaceoffDotId
  trackedLabel: string
  recentOpponentLabels: string[]
  /** Returns an error message, or null once the faceoff is recorded. */
  onRecord: (input: { winner: HockeySide; takerParticipantId: string | null; opponentTakerLabel: string | null }) => string | null
  onCancel: () => void
  /** Opens the generic chooser at this dot instead, for a shot or play recorded there. */
  onOther?: () => void
}

/**
 * A faceoff (HKY-2C): after a dot tap, the dot is ringed on the rink and Won or Lost records
 * it with the preselected taker, so a faceoff takes two taps. A chip changes the taker.
 */
export default function HockeyFaceoffControl({
  sport,
  dotId,
  trackedLabel,
  recentOpponentLabels,
  onRecord,
  onCancel,
  onOther,
}: HockeyFaceoffControlProps) {
  const [taker, setTaker] = useState<string | null>(() => hockeyFaceoffTakerDefault(sport.setup, sport.projection))
  const [opponentTaker, setOpponentTaker] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const direction = sport.projection.trackedAttackingDirection ?? sport.setup.firstPeriodAttackingDirection
  const zone = hockeyZone(HOCKEY_FACEOFF_DOTS[dotId], 'tracked', direction)
  const skaters = hockeySkaterChoices(sport.setup)

  const record = (winner: HockeySide) => {
    const message = onRecord({ winner, takerParticipantId: taker, opponentTakerLabel: opponentTaker })
    if (message) setError(message)
  }

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Faceoff">
      <p className="text-sm font-semibold text-content">
        Faceoff at the {dotId.replace(/_/g, ' ')} dot <span className="font-normal text-content-muted">({zone} zone for {trackedLabel})</span>
      </p>
      <div>
        <p className="text-xs font-bold uppercase text-content-muted">{trackedLabel} taker</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {skaters.map(skater => (
            <Chip key={skater.id} pressed={taker === skater.id} onClick={() => setTaker(taker === skater.id ? null : skater.id)}>
              {skater.number ? `#${skater.number}` : skater.displayName}
            </Chip>
          ))}
        </div>
      </div>
      {recentOpponentLabels.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase text-content-muted">Opponent taker (optional)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {recentOpponentLabels.map(label => (
              <Chip key={label} pressed={opponentTaker === label} onClick={() => setOpponentTaker(opponentTaker === label ? null : label)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className="btn-primary" onClick={() => record('tracked')}>Won</button>
        <button type="button" className="btn-secondary" onClick={() => record('opponent')}>Lost</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {onOther && (
        <button type="button" className="min-h-9 text-sm font-semibold text-accent underline" onClick={onOther}>
          Record something else at this dot
        </button>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
      )}
    </section>
  )
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${pressed ? 'border-accent bg-accent text-accent-content' : 'border-line-strong text-content-muted'}`}
    >
      {children}
    </button>
  )
}

import {
  formatHockeyClock,
  formatHockeyStrength,
  hockeyPenaltyLabel,
  hockeyPeriodSkaters,
  type HockeyBoxEntry,
  type HockeyPenaltyBoxReading,
  type HockeyPenaltyRecord,
  type HockeySide,
  type HockeySportGameState,
} from '../../lib/hockey'

interface HockeyPenaltyBoxProps {
  sport: HockeySportGameState
  reading: HockeyPenaltyBoxReading
  sideLabel: (side: HockeySide) => string
  /** Anchored games only; asks for a reason and records the release. */
  onRelease?: (entry: HockeyBoxEntry) => void
}

/**
 * The compact penalty box under the scoreboard (HKY-3A): each side's running and waiting
 * penalties with the time left, and the strength. Clockless games list this period's
 * penalties without timers. Nothing renders while the box is empty at even strength.
 */
export default function HockeyPenaltyBox({ sport, reading, sideLabel, onRelease }: HockeyPenaltyBoxProps) {
  const projection = sport.projection
  const byId = new Map(projection.penalties.map(record => [record.eventId, record]))
  const name = (participantId: string | null, label: string | null) => {
    if (participantId) {
      const participant = sport.setup.participants.find(entry => entry.id === participantId)
      if (participant) return participant.number ? `#${participant.number}` : participant.displayName
    }
    return label ?? ''
  }

  if (!projection.clock) {
    const period = projection.activePeriodId
    const listed = projection.penalties.filter(record => record.periodId === period && record.durationMs > 0)
    if (listed.length === 0) return null
    return (
      <ul className="space-y-0.5 text-xs text-content-muted" aria-label="Penalties this period">
        {listed.map(record => (
          <li key={record.eventId} className="truncate">
            {[`${sideLabel(record.side)}:`, name(record.serverParticipantId ?? record.offenderParticipantId, record.serverLabel ?? record.offenderLabel), hockeyPenaltyLabel(record)].filter(Boolean).join(' ')}
          </li>
        ))}
      </ul>
    )
  }

  const strength = reading.strength
  const entries = [...reading.box.tracked, ...reading.box.opponent]
  const period = projection.periods.find(entry => entry.id === projection.activePeriodId) ?? { kind: 'regulation' as const }
  const full = hockeyPeriodSkaters(sport.setup, period)
  const fullStrength = !strength || (strength.tracked.skatersOnIce === full && strength.opponent.skatersOnIce === full)
  if (entries.length === 0 && fullStrength && reading.box.notes.length === 0) return null

  return (
    <div className="flex flex-wrap items-start gap-2 text-xs" aria-label="Penalty box">
      {strength && (
        <span className="shrink-0 rounded bg-control px-1.5 py-0.5 font-bold tabular-nums text-content" aria-label={`Strength ${formatHockeyStrength(strength)}`}>
          {formatHockeyStrength(strength)}
        </span>
      )}
      <ul className="min-w-0 flex-1 space-y-0.5">
        {entries.map(entry => {
          const record = byId.get(entry.penaltyEventId) as HockeyPenaltyRecord | undefined
          const who = name(entry.participantId, entry.label)
          const what = record ? hockeyPenaltyLabel(record).split(',')[0] : entry.class
          return (
            <li key={`${entry.penaltyEventId}:${entry.segment}`} className="flex min-h-7 items-center gap-2">
              <span className={`min-w-0 flex-1 truncate ${entry.status === 'waiting' ? 'text-content-muted' : 'text-content'}`}>
                {[sideLabel(entry.side), who, what].filter(Boolean).join(' ')}{entry.segment === 2 ? ' (2nd half)' : ''}{entry.cancelled ? ', coincidental' : ''}
              </span>
              <span className="shrink-0 tabular-nums text-content-muted">
                {entry.status === 'waiting' ? `waiting ${formatHockeyClock(entry.remainingMs)}` : formatHockeyClock(entry.remainingMs)}
              </span>
              {onRelease && (
                <button
                  type="button"
                  className="shrink-0 rounded border border-line-strong px-2 py-0.5 font-semibold text-content-muted"
                  onClick={() => onRelease(entry)}
                  aria-label={`Release ${[sideLabel(entry.side), who, what].filter(Boolean).join(' ')} early`}
                >
                  Release
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {reading.box.notes.length > 0 && (
        <p className="basis-full text-warning-content">{reading.box.notes.map(note => note.message).join(' ')}</p>
      )}
    </div>
  )
}

import type {
  BaseballOpponentLineupView,
  BaseballTrackedLineupView,
} from '../../lib/baseball'

interface BaseballLineupPanelProps {
  tracked: BaseballTrackedLineupView
  opponent: BaseballOpponentLineupView
  names: { tracked: string; opponent: string }
  /** Substitute and the opponent edits only work while play is live. */
  canChange: boolean
  /** Why the Substitute button is disabled, when it is. */
  substituteHint: string | null
  onSubstitute: () => void
  onOpponentPitchingChange: () => void
  onSelectPlayer: (id: string) => void
  onEditOpponentSlot: (id: string) => void
}

const STATUS_LABELS = { batting: 'Batting', up_next: 'Up next' } as const

/**
 * The Lineup tab (BSB-4A): our batting order, defense and bench, and their batting slots
 * and pitcher. Tapping a player shows their game; changes go through Substitute. Nothing
 * here writes until a sheet confirms.
 */
export default function BaseballLineupPanel({
  tracked,
  opponent,
  names,
  canChange,
  substituteHint,
  onSubstitute,
  onOpponentPitchingChange,
  onSelectPlayer,
  onEditOpponentSlot,
}: BaseballLineupPanelProps) {
  const notBatting = tracked.defense.filter(row => row.doesNotBat)
  return (
    <div className="space-y-4">
      <section className="space-y-2" aria-label={`${names.tracked} lineup`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase text-content-muted">{names.tracked}</h2>
          <button type="button" className="btn-primary min-h-11 px-4" disabled={!canChange || substituteHint !== null} onClick={onSubstitute}>
            Substitute
          </button>
        </div>
        {substituteHint && <p className="text-xs text-content-muted">{substituteHint}</p>}
        {tracked.openPositions.length > 0 && (
          <p role="status" className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
            Open: {tracked.openPositions.join(', ')}. Fill {tracked.openPositions.length === 1 ? 'it' : 'them'} with a defensive replacement or a position switch before your team takes the field.
          </p>
        )}
        <ol className="space-y-1">
          {tracked.cards.map(card => (
            <li key={card.slot}>
              <button
                type="button"
                className={`flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-1 text-left text-sm ${card.status === 'batting' ? 'border-accent bg-accent/10' : 'border-line'}`}
                onClick={() => onSelectPlayer(card.id)}
                aria-label={`${card.slot}. ${card.name}, ${card.position}${card.status ? `, ${STATUS_LABELS[card.status]}` : ''}`}
              >
                <span className="w-5 tabular-nums text-content-muted">{card.slot}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-content">{card.name}</span>
                {card.status && <span className="text-xs font-semibold text-accent">{STATUS_LABELS[card.status]}</span>}
                <span className="w-10 text-right text-content-muted">{card.position === 'No position' ? '–' : card.position}</span>
                <span className="w-8 text-right text-xs text-content-muted">{card.bats ? `B ${card.bats}` : ''}</span>
              </button>
            </li>
          ))}
        </ol>
        {notBatting.map(row => (
          <button
            key={row.position}
            type="button"
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-line px-3 text-left text-sm"
            onClick={() => row.id && onSelectPlayer(row.id)}
          >
            <span className="flex-1 text-content">{row.code}: {row.name}</span>
            <span className="text-xs text-content-muted">does not bat</span>
          </button>
        ))}
        <details className="rounded-md border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-content">Defense</summary>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {tracked.defense.map(row => (
              <li key={row.position} className={row.id ? 'text-content' : 'font-semibold text-warning-content'}>
                <span className="inline-block w-8 text-content-muted">{row.code}</span>
                {row.name ?? 'Open'}
              </li>
            ))}
          </ul>
        </details>
        <div>
          <h3 className="text-xs font-bold uppercase text-content-muted">Bench</h3>
          {tracked.bench.length === 0 ? (
            <p className="text-sm text-content-muted">Nobody on the bench.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {tracked.bench.map(entry => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full flex-col justify-center rounded-md border border-line px-3 py-1 text-left text-sm"
                    onClick={() => onSelectPlayer(entry.id)}
                  >
                    <span className="text-content">{entry.name}</span>
                    <span className={`text-xs ${entry.status === 'out' ? 'text-content-muted' : 'text-content'}`}>{entry.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2" aria-label={`${names.opponent} lineup`}>
        <h2 className="text-sm font-bold uppercase text-content-muted">{names.opponent}</h2>
        <ol className="space-y-1">
          {opponent.slots.map(slot => (
            <li key={slot.id}>
              <button
                type="button"
                className={`flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-1 text-left text-sm ${slot.status === 'batting' ? 'border-accent bg-accent/10' : 'border-line'}`}
                disabled={!canChange}
                onClick={() => onEditOpponentSlot(slot.id)}
                aria-label={`Edit ${names.opponent} batter ${slot.slot}, ${slot.name}`}
              >
                <span className="w-5 tabular-nums text-content-muted">{slot.slot}</span>
                <span className="min-w-0 flex-1 truncate text-content">{slot.name}</span>
                {slot.status && <span className="text-xs font-semibold text-accent">{STATUS_LABELS[slot.status]}</span>}
                <span className="w-10 text-right text-content-muted">{slot.position ?? ''}</span>
                <span className="w-8 text-right text-xs text-content-muted">{slot.bats ? `B ${slot.bats}` : ''}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
          <span className="flex-1 text-content">
            Pitching: {opponent.pitcher?.name ?? 'Unknown'}
            {opponent.pitcher?.throws && <span className="text-content-muted"> · throws {opponent.pitcher.throws}</span>}
          </span>
          <button type="button" className="btn-secondary min-h-11 px-3" disabled={!canChange} onClick={onOpponentPitchingChange}>
            Change
          </button>
        </div>
      </section>
    </div>
  )
}

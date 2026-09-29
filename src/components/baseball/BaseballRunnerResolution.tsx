import {
  BASEBALL_REASON_LABELS,
  baseballResolutionDestinations,
  baseballResolutionIssues,
  baseballResolutionReasons,
  setBaseballResolutionDestination,
  type BaseballMovementFrom,
  type BaseballMovementReason,
  type BaseballResolutionDestination,
  type BaseballResolutionRow,
  type BaseballTerminalKind,
} from '../../lib/baseball'
import BaseballFielderPicker from './BaseballFielderPicker'

interface BaseballRunnerResolutionProps {
  title: string
  rows: BaseballResolutionRow[]
  onChange: (rows: BaseballResolutionRow[]) => void
  /** Runner and batter names by id. */
  names: Record<string, string>
  /** What the capture does to the plate appearance; decides the reason choices. */
  terminal: BaseballTerminalKind | null
  fielderCount: number
  /** The out row that fielder taps on the diamond add to. */
  activeRunnerId: string | null
  onActivate: (runnerId: string) => void
  /** The engine's message after a rejected Confirm; the choices stay in place. */
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

const FROM_LABELS: Record<BaseballMovementFrom, string> = { batter: 'Batter', first: 'On 1st', second: 'On 2nd', third: 'On 3rd' }
const TO_LABELS: Record<BaseballResolutionDestination, string> = {
  stay: 'Stays',
  first: 'To 1st',
  second: 'To 2nd',
  third: 'To 3rd',
  home: 'Scores',
  out: 'Out',
}

/**
 * Runner resolution (BSB-3B, shared with BSB-3C): one row per runner and the batter, each
 * with a destination, a reason and, for an out, the fielder sequence.
 */
export default function BaseballRunnerResolution({
  title,
  rows,
  onChange,
  names,
  terminal,
  fielderCount,
  activeRunnerId,
  onActivate,
  error,
  onCancel,
  onConfirm,
}: BaseballRunnerResolutionProps) {
  const issues = baseballResolutionIssues(rows)
  const reasons = baseballResolutionReasons(terminal)
  const update = (index: number, row: BaseballResolutionRow) => onChange(rows.map((entry, at) => (at === index ? row : entry)))

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Runners">
      <h2 className="font-bold text-content">{title}</h2>
      {rows.length === 0 && <p className="text-sm text-content-muted">No runners on base.</p>}
      <ul className="space-y-2">
        {rows.map((row, index) => {
          const isBatter = row.from === 'batter'
          const active = row.to === 'out' && row.runnerId === activeRunnerId
          const reasonChoices: readonly BaseballMovementReason[] = reasons.includes(row.reason) ? reasons : [row.reason, ...reasons]
          return (
            <li
              key={row.runnerId}
              className={`space-y-2 rounded-md border p-2 ${issues[row.runnerId] ? 'border-danger-line' : active ? 'border-accent' : 'border-line'}`}
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase text-content-muted">{FROM_LABELS[row.from]}</p>
                  <p className="truncate text-sm font-semibold text-content">{names[row.runnerId] ?? 'Runner'}</p>
                </div>
                <label className="sr-only" htmlFor={`destination-${row.runnerId}`}>
                  Where {names[row.runnerId] ?? 'the runner'} ends up
                </label>
                <select
                  id={`destination-${row.runnerId}`}
                  className="input-field min-h-11 w-28 px-2 py-2 text-sm font-semibold"
                  value={row.to}
                  onChange={event => {
                    const next = setBaseballResolutionDestination(row, event.target.value as BaseballResolutionDestination)
                    update(index, next)
                    if (next.to === 'out') onActivate(row.runnerId)
                  }}
                >
                  {baseballResolutionDestinations(row.from).map(destination => (
                    <option key={destination} value={destination}>{TO_LABELS[destination]}</option>
                  ))}
                </select>
              </div>

              {!isBatter && row.to !== 'stay' && (
                <label className="flex items-center gap-2 text-sm text-content-muted">
                  <span className="shrink-0">Why</span>
                  <select
                    className="input-field min-h-11 flex-1 px-2 py-2 text-sm"
                    value={row.reason}
                    onChange={event => update(index, { ...row, reason: event.target.value as BaseballMovementReason })}
                  >
                    {reasonChoices.map(reason => (
                      <option key={reason} value={reason}>{BASEBALL_REASON_LABELS[reason]}</option>
                    ))}
                  </select>
                </label>
              )}

              {row.to === 'out' && (
                active ? (
                  <BaseballFielderPicker
                    label="Fielders on this out"
                    hint="Tap the fielders on the diamond, or their position numbers."
                    fielderCount={fielderCount}
                    sequence={row.fielders}
                    onChange={fielders => update(index, { ...row, fielders })}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between rounded-md border border-line px-3 text-sm"
                    onClick={() => onActivate(row.runnerId)}
                  >
                    <span className="text-content-muted">Fielders</span>
                    <span className="font-semibold tabular-nums text-content">{row.fielders.length ? row.fielders.join('-') : 'Add'}</span>
                  </button>
                )
              )}

              {issues[row.runnerId] && (
                <p className="text-sm font-semibold text-danger-content">{issues[row.runnerId]}</p>
              )}
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onConfirm}>Confirm</button>
      </div>
    </section>
  )
}

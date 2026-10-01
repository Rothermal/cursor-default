import {
  BASEBALL_REASON_LABELS,
  baseballResolutionDestinations,
  baseballResolutionIssues,
  activateBaseballResolutionRow,
  setBaseballResolutionDraftDestination,
  updateBaseballResolutionDraftRow,
  type BaseballMovementFrom,
  type BaseballMovementReason,
  type BaseballResolutionDestination,
  type BaseballResolutionDraft,
  type BaseballResolutionRow,
  type BaseballResolutionTransition,
} from '../../lib/baseball'
import BaseballFielderPicker from './BaseballFielderPicker'

interface BaseballRunnerResolutionProps {
  title: string
  draft: BaseballResolutionDraft
  /** Each interaction sends one transition, applied to the latest draft. */
  onChange: (transition: BaseballResolutionTransition) => void
  /** Runner and batter names by id. */
  names: Record<string, string>
  /** Reason choices for runner rows (running reasons between pitches, play reasons on a completed plate appearance). */
  reasons: readonly BaseballMovementReason[]
  fielderCount: number
  /** Whether RBI overrides take effect; only on the event that completes a plate appearance. */
  allowRbi: boolean
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

type Override = boolean | null | undefined

const OVERRIDE_VALUE = (value: Override) => (value === true ? 'yes' : value === false ? 'no' : 'rules')
const OVERRIDE_FROM = (value: string): boolean | null => (value === 'yes' ? true : value === 'no' ? false : null)

/**
 * Per-row overrides (BSB-3C), collapsed by default: the erring fielder on an advance, and
 * for a runner who scores, earned, RBI (only when it can take effect) and whether the run
 * counts. "By the rules" leaves the engine's documented rules in charge.
 */
function Advanced({
  row,
  fielderCount,
  allowRbi,
  onChange,
}: {
  row: BaseballResolutionRow
  fielderCount: number
  allowRbi: boolean
  onChange: (transition: BaseballResolutionTransition) => void
}) {
  const overridden = row.errorBy !== null || [row.earned, allowRbi ? row.rbi : null, row.runCounts].some(value => value !== null && value !== undefined)
  const set = (patch: Parameters<typeof updateBaseballResolutionDraftRow>[1]) => onChange(updateBaseballResolutionDraftRow(row.runnerId, patch))
  return (
    <details className="rounded-md border border-line px-2 py-1 text-sm" open={overridden || undefined}>
      <summary className="flex min-h-9 cursor-pointer items-center font-semibold text-content-muted">
        Advanced{overridden ? ' (changed)' : ''}
      </summary>
      <div className="space-y-2 pb-1 pt-1">
        {row.to !== 'out' && (
          <OverrideSelect
            label="Error by"
            value={row.errorBy === null ? '' : String(row.errorBy)}
            options={[['', 'No error'], ...Array.from({ length: fielderCount }, (_, index) => [String(index + 1), `Fielder ${index + 1}`] as [string, string])]}
            onChange={value => set({ errorBy: value === '' ? null : Number(value) })}
          />
        )}
        {row.to === 'home' && (
          <>
            <OverrideSelect label="Earned run" value={OVERRIDE_VALUE(row.earned)} options={TRI_STATE} onChange={value => set({ earned: OVERRIDE_FROM(value) })} />
            {allowRbi && <OverrideSelect label="RBI" value={OVERRIDE_VALUE(row.rbi)} options={TRI_STATE} onChange={value => set({ rbi: OVERRIDE_FROM(value) })} />}
            <OverrideSelect label="Run counts" value={OVERRIDE_VALUE(row.runCounts)} options={TRI_STATE} onChange={value => set({ runCounts: OVERRIDE_FROM(value) })} />
          </>
        )}
      </div>
    </details>
  )
}

const TRI_STATE: Array<[string, string]> = [['rules', 'By the rules'], ['yes', 'Yes'], ['no', 'No']]

function OverrideSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-content-muted">
      <span className="w-24 shrink-0">{label}</span>
      <select className="input-field min-h-11 flex-1 px-2 py-2 text-sm" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  )
}

/**
 * Runner resolution (BSB-3B, shared with BSB-3C): one row per runner and the batter, each
 * with a destination, a reason and, for an out, the fielder sequence.
 */
export default function BaseballRunnerResolution({
  title,
  draft,
  onChange,
  names,
  reasons,
  fielderCount,
  allowRbi,
  error,
  onCancel,
  onConfirm,
}: BaseballRunnerResolutionProps) {
  const { rows, activeRunnerId } = draft
  const issues = baseballResolutionIssues(rows)

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Runners">
      <h2 className="font-bold text-content">{title}</h2>
      {rows.length === 0 && <p className="text-sm text-content-muted">No runners on base.</p>}
      <ul className="space-y-2">
        {rows.map(row => {
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
                  onChange={event =>
                    onChange(setBaseballResolutionDraftDestination(row.runnerId, event.target.value as BaseballResolutionDestination))}
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
                    onChange={event => onChange(updateBaseballResolutionDraftRow(row.runnerId, { reason: event.target.value as BaseballMovementReason }))}
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
                    onChange={fielders => onChange(updateBaseballResolutionDraftRow(row.runnerId, { fielders }))}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between rounded-md border border-line px-3 text-sm"
                    onClick={() => onChange(activateBaseballResolutionRow(row.runnerId))}
                  >
                    <span className="text-content-muted">Fielders</span>
                    <span className="font-semibold tabular-nums text-content">{row.fielders.length ? row.fielders.join('-') : 'Add'}</span>
                  </button>
                )
              )}

              {row.to !== 'stay' && (
                <Advanced row={row} fielderCount={fielderCount} allowRbi={allowRbi} onChange={onChange} />
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

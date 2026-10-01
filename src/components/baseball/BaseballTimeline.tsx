import { AlertTriangle, RotateCcw } from 'lucide-react'
import type {
  BaseballTimeline as BaseballTimelineModel,
  BaseballTimelineFilter,
  BaseballTimelineRow,
} from '../../lib/baseball'

interface BaseballTimelineProps {
  timeline: BaseballTimelineModel
  filter: BaseballTimelineFilter
  names: { tracked: string; opponent: string }
  onFilter: (filter: BaseballTimelineFilter) => void
  /** Opens a play's details, where it can be removed. */
  onSelect: (id: string) => void
  onRestore: (id: string) => void
  onRestoreGroup: (receiptId: string) => void
}

/**
 * The Timeline tab (BSB-4C): every play by half-inning, newest first, with the half's line.
 * Removed rows stay listed under their half, collapsed, with Restore. Game-flow rows are shown
 * for context and never removed on their own. Nothing here writes until a preview confirms.
 */
export default function BaseballTimeline({ timeline, filter, names, onFilter, onSelect, onRestore, onRestoreGroup }: BaseballTimelineProps) {
  const filtered = filter.half !== 'all' || filter.side !== 'all' || filter.correctedOnly
  return (
    <div className="space-y-3">
      <details className="rounded-md border border-line bg-surface" open={filtered}>
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-content">
          Filters{filtered ? ` · ${timeline.hiddenCount} hidden` : ''}
        </summary>
        <div className="grid gap-2 px-3 pb-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-content-muted">
            Half-inning
            <select
              className="input-field mt-1 min-h-11 w-full"
              value={filter.half}
              onChange={event => onFilter({ ...filter, half: event.target.value })}
            >
              <option value="all">All</option>
              {timeline.halfOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-content-muted">
            Team
            <select
              className="input-field mt-1 min-h-11 w-full"
              value={filter.side}
              onChange={event => onFilter({ ...filter, side: event.target.value as BaseballTimelineFilter['side'] })}
            >
              <option value="all">Both</option>
              <option value="tracked">{names.tracked}</option>
              <option value="opponent">{names.opponent}</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm text-content">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={filter.correctedOnly}
              onChange={event => onFilter({ ...filter, correctedOnly: event.target.checked })}
            />
            Corrected only
          </label>
        </div>
      </details>

      {timeline.halves.length === 0 ? (
        <p className="text-sm text-content-muted">{filtered ? 'No plays match these filters.' : 'Nothing recorded yet.'}</p>
      ) : (
        timeline.halves.map(half => (
          <section key={half.key} aria-labelledby={`timeline-${half.key}`} className="space-y-1">
            <h2 id={`timeline-${half.key}`} className="flex flex-wrap items-baseline gap-x-2 text-sm font-bold text-content">
              <span className="uppercase text-content-muted">{half.label}</span>
              <span className="text-xs font-normal text-content-muted">
                {names[half.battingSide]} batting{half.line ? ` · ${half.line}` : ''}
              </span>
            </h2>
            {half.rows.length > 0 && (
              <ol className="divide-y divide-line rounded-md bg-surface text-sm">
                {half.rows.map(row => <ActiveRow key={row.id} row={row} onSelect={onSelect} />)}
              </ol>
            )}
            {half.removedRows.length > 0 && (
              <details className="rounded-md border border-dashed border-line">
                <summary className="flex min-h-10 cursor-pointer items-center px-3 text-xs font-semibold text-content-muted">
                  Removed ({half.removedRows.length})
                </summary>
                <ol className="divide-y divide-line text-sm">
                  {half.removedRows.map(row => (
                    <RemovedRow key={row.id} row={row} onRestore={onRestore} onRestoreGroup={onRestoreGroup} />
                  ))}
                </ol>
              </details>
            )}
          </section>
        ))
      )}
    </div>
  )
}

function ActiveRow({ row, onSelect }: { row: BaseballTimelineRow; onSelect: (id: string) => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={row.kind === 'play' ? 'underline decoration-line-strong underline-offset-2' : 'text-content-muted'}>{row.label}</span>
        {row.warning && (
          <span className="mt-0.5 flex items-start gap-1 text-xs text-warning-content">
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" /> {row.warning}
          </span>
        )}
      </span>
      {row.revised && <span className="shrink-0 rounded border border-line px-1 text-xs text-content-muted">Revised</span>}
    </>
  )
  return (
    <li className="flex min-h-11 items-center px-3 py-1">
      {row.kind === 'play' ? (
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-2 text-left text-content"
          onClick={() => onSelect(row.id)}
          aria-label={`Details: ${row.label}, ${row.halfLabel}`}
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2">{body}</div>
      )}
    </li>
  )
}

function RemovedRow({ row, onRestore, onRestoreGroup }: { row: BaseballTimelineRow; onRestore: (id: string) => void; onRestoreGroup: (receiptId: string) => void }) {
  const group = row.group
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-content-muted line-through decoration-content-muted/60">{row.label}</span>
        <button
          type="button"
          className="btn-secondary inline-flex min-h-10 shrink-0 items-center gap-1 px-3 text-sm"
          onClick={() => onRestore(row.id)}
          aria-label={`Restore ${row.label}`}
        >
          <RotateCcw size={16} aria-hidden="true" /> Restore
        </button>
      </div>
      {group && group.restorable && (
        <button
          type="button"
          className="text-xs font-semibold text-accent underline underline-offset-2"
          onClick={() => onRestoreGroup(group.receiptId)}
        >
          Restore together ({group.size} rows removed in one correction)
        </button>
      )}
      {group && group.changedLabels.length > 0 && (
        <p className="text-xs text-content-muted">
          Changed since it was removed: {group.changedLabels.join('; ')}. Restore rows one at a time.
        </p>
      )}
    </li>
  )
}

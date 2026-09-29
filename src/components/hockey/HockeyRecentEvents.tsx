import { RotateCcw, Undo2 } from 'lucide-react'
import { formatHockeyClock, type HockeyRecentEventRow } from '../../lib/hockey'

interface HockeyRecentEventsProps {
  rows: HockeyRecentEventRow[]
  canRestore: boolean
  onUndo: () => void
  onRestore: () => void
}

/**
 * Recent Events (HKY-2C): capture units newest first, with game-flow rows for context.
 * Only the newest capture can be undone; Restore brings back the unit just undone.
 */
export default function HockeyRecentEvents({ rows, canRestore, onUndo, onRestore }: HockeyRecentEventsProps) {
  return (
    <section aria-labelledby="hockey-recent-events">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 id="hockey-recent-events" className="text-sm font-bold uppercase text-content-muted">Recent events</h2>
        {canRestore && (
          <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 text-sm" onClick={onRestore}>
            <RotateCcw size={16} aria-hidden="true" /> Restore
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-content-muted">Nothing recorded yet.</p>
      ) : (
        <ol className="mt-2 divide-y divide-line rounded-md bg-surface text-sm">
          {rows.map(row => (
            <li key={row.id} className="flex min-h-11 items-center gap-3 px-3 py-1">
              <span className={`min-w-0 flex-1 truncate ${row.capture ? 'text-content' : 'text-content-muted'}`}>{row.label}</span>
              <span className="shrink-0 tabular-nums text-xs text-content-muted">
                {row.periodLabel}
                {row.elapsedMs !== null ? ` ${formatHockeyClock(row.elapsedMs)}` : ''}
              </span>
              {row.undoable && (
                <button
                  type="button"
                  className="btn-secondary inline-flex shrink-0 items-center gap-1 px-3 text-sm"
                  onClick={onUndo}
                  aria-label={`Undo ${row.label}`}
                >
                  <Undo2 size={16} aria-hidden="true" /> Undo
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

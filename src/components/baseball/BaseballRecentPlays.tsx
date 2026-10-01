import { RotateCcw, Undo2 } from 'lucide-react'
import type { BaseballRecentRow } from '../../lib/baseball'

interface BaseballRecentPlaysProps {
  rows: BaseballRecentRow[]
  canRestore: boolean
  onUndo: () => void
  onRestore: () => void
  /** Opens a play's read-only details. */
  onSelect: (id: string) => void
}

/**
 * Recent plays (BSB-3D): capture units newest first, with game-flow rows and half-inning
 * dividers for context. Only the newest play can be undone; Restore brings back the play
 * just undone until the next capture. Tapping a play opens its details, read-only.
 */
export default function BaseballRecentPlays({ rows, canRestore, onUndo, onRestore, onSelect }: BaseballRecentPlaysProps) {
  return (
    <section aria-labelledby="baseball-recent-plays">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 id="baseball-recent-plays" className="text-sm font-bold uppercase text-content-muted">Recent plays</h2>
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
          {rows.map(row => row.kind === 'divider' ? (
            <li key={row.id} className="bg-surface-muted px-3 py-1 text-xs font-bold uppercase text-content-muted">
              {row.label}
            </li>
          ) : (
            <li key={row.id} className="flex min-h-11 items-center gap-3 px-3 py-1">
              {row.kind === 'play' ? (
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left text-content"
                  onClick={() => onSelect(row.id)}
                  aria-label={`Details: ${row.label}, ${row.halfLabel}`}
                >
                  <span className="min-w-0 flex-1 underline decoration-line-strong underline-offset-2">{row.label}</span>
                  <span className="shrink-0 text-xs text-content-muted">{row.halfLabel}</span>
                </button>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-content-muted">{row.label}</span>
                  <span className="shrink-0 text-xs text-content-muted">{row.halfLabel}</span>
                </>
              )}
              {row.kind === 'play' && row.undoable && (
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

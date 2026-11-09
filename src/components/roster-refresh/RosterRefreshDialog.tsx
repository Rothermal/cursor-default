import { useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useModalFocus } from '../../hooks/useModalFocus'
import { describeRosterUpdate, type RosterRefreshDiff } from '../../lib/rosterRefresh'

export interface RosterRefreshSelection {
  updateParticipantIds: string[]
  additionPlayerIds: string[]
}

interface RosterRefreshDialogProps {
  teamName: string
  loading: boolean
  loadError: string | null
  diff: RosterRefreshDiff | null
  applyError: string | null
  busy: boolean
  /** Why roster additions can't be applied right now (e.g. the clock is running). */
  additionsBlockedReason?: string | null
  onRetry: () => void
  onApply: (selection: RosterRefreshSelection) => void
  onClose: () => void
}

/**
 * RTN-2 shared roster refresh dialog: lists number/position changes from the
 * team roster (checked by default) and roster players not in the game
 * (unchecked by default). Sport neutral; each sport applies the selection.
 */
export default function RosterRefreshDialog({
  teamName, loading, loadError, diff, applyError, busy, additionsBlockedReason, onRetry, onApply, onClose,
}: RosterRefreshDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useModalFocus({ enabled: true, dialogRef, initialFocusRef: closeRef, onClose })
  const [skippedUpdates, setSkippedUpdates] = useState<Set<string>>(new Set())
  const [chosenAdditions, setChosenAdditions] = useState<Set<string>>(new Set())

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  const selectedUpdates = diff?.updates.filter(update => !skippedUpdates.has(update.participantId)) ?? []
  const selectedAdditions = diff?.additions.filter(addition => chosenAdditions.has(addition.playerId)) ?? []
  const nothingToApply = selectedUpdates.length === 0 && selectedAdditions.length === 0
  const blocked = selectedAdditions.length > 0 && Boolean(additionsBlockedReason)
  const empty = diff !== null && diff.updates.length === 0 && diff.additions.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 px-3 pb-3 pt-16 sm:items-center sm:p-4" onClick={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="roster-refresh-title"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="roster-refresh-title" className="text-base font-bold text-content">Refresh from roster</h2>
            <p className="break-words text-xs text-content-muted">Current numbers and positions from {teamName}. Stats stay with each player.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content-muted" aria-label="Close roster refresh">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {loading && <p className="animate-pulse text-sm text-content-muted">Loading the team roster...</p>}
          {loadError && (
            <div role="alert" className="space-y-2 rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
              <p>{loadError}</p>
              <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={onRetry}>Retry</button>
            </div>
          )}
          {empty && <p role="status" className="text-sm text-content-muted">This game already matches the team roster.</p>}

          {diff && diff.updates.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold text-content">Changes ({diff.updates.length})</legend>
              {diff.updates.map(update => (
                <label key={update.participantId} className="flex min-h-11 items-start gap-3 rounded-lg border border-line px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={!skippedUpdates.has(update.participantId)}
                    onChange={() => setSkippedUpdates(value => toggle(value, update.participantId))}
                  />
                  <span className="min-w-0">
                    <span className="block break-words font-semibold text-content">{update.displayName}</span>
                    <span className="block break-words text-sm text-content-muted">{describeRosterUpdate(update)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {diff && diff.additions.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold text-content">On the roster, not in this game ({diff.additions.length})</legend>
              {diff.additions.map(addition => (
                <label key={addition.playerId} className="flex min-h-11 items-start gap-3 rounded-lg border border-line px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={chosenAdditions.has(addition.playerId)}
                    onChange={() => setChosenAdditions(value => toggle(value, addition.playerId))}
                  />
                  <span className="min-w-0">
                    <span className="block break-words font-semibold text-content">{addition.number ? `#${addition.number} ` : ''}{addition.name}</span>
                    <span className="block text-sm text-content-muted">Add to the bench{addition.position ? `, ${addition.position}` : ''}</span>
                  </span>
                </label>
              ))}
              {blocked && <p className="text-xs text-warning-content">{additionsBlockedReason}</p>}
            </fieldset>
          )}

          {diff && diff.unmatched.length > 0 && (
            <p className="text-xs text-content-muted">
              No longer on the roster, kept in this game: {diff.unmatched.map(item => item.displayName).join(', ')}.
            </p>
          )}

          {applyError && (
            <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">{applyError}</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
          <button
            type="button"
            disabled={busy || loading || !diff || nothingToApply || blocked}
            onClick={() => onApply({
              updateParticipantIds: selectedUpdates.map(update => update.participantId),
              additionPlayerIds: selectedAdditions.map(addition => addition.playerId),
            })}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:bg-control-disabled disabled:text-content-disabled"
          >
            <RefreshCw size={16} aria-hidden />
            Apply
          </button>
        </footer>
      </section>
    </div>
  )
}

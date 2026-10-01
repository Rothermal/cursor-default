import {
  BASEBALL_HALF_END_OPTIONS,
  type BaseballEndGameOption,
  type BaseballGameEndOutcome,
  type BaseballHalfInningEndReason,
  type BaseballTeamSide,
} from '../../lib/baseball'
import BaseballChip from './BaseballChip'

export interface BaseballEndHalfDraft {
  reason: BaseballHalfInningEndReason | null
  note: string
}

export interface BaseballEndGameDraft {
  outcome: BaseballGameEndOutcome | null
  note: string
  winner: BaseballTeamSide | null
}

function Actions({ ready, confirm, onCancel, onConfirm }: { ready: boolean; confirm: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      <button type="button" className="btn-primary" disabled={!ready} onClick={onConfirm}>{confirm}</button>
    </div>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
  ) : null
}

function NoteField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1 text-sm font-semibold text-content">
      <span>{label}</span>
      <input className="input-field" value={value} maxLength={200} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

/** End the half-inning early (BSB-3D): time limit, mercy or another reason, with an optional note. */
export function BaseballEndHalfSheet({
  draft,
  onChange,
  halfLabel,
  error,
  onCancel,
  onConfirm,
}: {
  draft: BaseballEndHalfDraft
  onChange: (draft: BaseballEndHalfDraft) => void
  halfLabel: string
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="End half-inning">
      <h2 className="font-bold text-content">End {halfLabel} early</h2>
      <p className="text-sm text-content-muted">Runners on base are left on base. The third out ends a half on its own.</p>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">Reason</legend>
        <div className="grid grid-cols-3 gap-2">
          {BASEBALL_HALF_END_OPTIONS.map(option => (
            <BaseballChip
              key={option.reason}
              label={option.label}
              selected={draft.reason === option.reason}
              onClick={() => onChange({ ...draft, reason: option.reason })}
            />
          ))}
        </div>
      </fieldset>
      <NoteField label="Note (optional)" value={draft.note} onChange={note => onChange({ ...draft, note })} />
      <ErrorLine error={error} />
      <Actions ready={draft.reason !== null} confirm="End half" onCancel={onCancel} onConfirm={onConfirm} />
    </section>
  )
}

/** End the game (BSB-3D): the outcomes this moment allows, a winner for a forfeit and a reason to suspend or abandon. */
export function BaseballEndGameSheet({
  draft,
  onChange,
  options,
  names,
  error,
  onCancel,
  onConfirm,
}: {
  draft: BaseballEndGameDraft
  onChange: (draft: BaseballEndGameDraft) => void
  options: BaseballEndGameOption[]
  names: Record<BaseballTeamSide, string>
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const chosen = options.find(option => option.outcome === draft.outcome) ?? null
  const ready = chosen !== null &&
    (!chosen.needsReason || draft.note.trim().length > 0) &&
    (!chosen.needsWinner || draft.winner !== null)
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="End game">
      <h2 className="font-bold text-content">End game</h2>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">How it ended</legend>
        <div className="grid grid-cols-2 gap-2">
          {options.map(option => (
            <BaseballChip
              key={option.outcome}
              label={option.label}
              selected={draft.outcome === option.outcome}
              onClick={() => onChange({ ...draft, outcome: option.outcome })}
            />
          ))}
        </div>
      </fieldset>
      {chosen?.needsWinner && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase text-content-muted">Winner</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['tracked', 'opponent'] as const).map(side => (
              <BaseballChip key={side} label={names[side]} selected={draft.winner === side} onClick={() => onChange({ ...draft, winner: side })} />
            ))}
          </div>
        </fieldset>
      )}
      {chosen && (
        <NoteField
          label={chosen.needsReason ? 'Reason' : 'Note (optional)'}
          value={draft.note}
          onChange={note => onChange({ ...draft, note })}
        />
      )}
      {chosen?.outcome === 'suspended' && (
        <p className="text-sm text-content-muted">A suspended game can be reopened later to finish it.</p>
      )}
      <ErrorLine error={error} />
      <Actions ready={ready} confirm="End game" onCancel={onCancel} onConfirm={onConfirm} />
    </section>
  )
}

/** Reopen a finished, suspended or abandoned game, with a reason. */
export function BaseballReopenSheet({
  reason,
  onChange,
  error,
  onCancel,
  onConfirm,
}: {
  reason: string
  onChange: (reason: string) => void
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Reopen game">
      <h2 className="font-bold text-content">Reopen game</h2>
      <p className="text-sm text-content-muted">Play continues from where it ended. The ending stays in the history.</p>
      <NoteField label="Reason" value={reason} onChange={onChange} />
      <ErrorLine error={error} />
      <Actions ready={reason.trim().length > 0} confirm="Reopen" onCancel={onCancel} onConfirm={onConfirm} />
    </section>
  )
}

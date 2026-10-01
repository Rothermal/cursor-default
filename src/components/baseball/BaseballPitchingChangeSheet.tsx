import type { BaseballPitchHand, BaseballPitchingChangeOption, BaseballPitchingChangeOptions } from '../../lib/baseball'
import BaseballHandChoice from './BaseballHandChoice'

export type BaseballPitchingChangeDraft =
  | { side: 'tracked'; selectedId: string | null }
  | { side: 'opponent'; label: string; number: string; throws: BaseballPitchHand | null }

interface BaseballPitchingChangeSheetProps {
  draft: BaseballPitchingChangeDraft
  onChange: (draft: BaseballPitchingChangeDraft) => void
  /** The tracked team's two kinds of change; unused for the opponent. */
  options: BaseballPitchingChangeOptions
  teamName: string
  currentPitcher: string
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Pitching change (BSB-3D, Q2). For the tracked team: a bench player replaces the pitcher,
 * or a fielder swaps with the pitcher, and the sheet says exactly what happens before
 * Confirm. For the opponent: the new pitcher's label or number.
 */
export default function BaseballPitchingChangeSheet({
  draft,
  onChange,
  options,
  teamName,
  currentPitcher,
  error,
  onCancel,
  onConfirm,
}: BaseballPitchingChangeSheetProps) {
  const selected = draft.side === 'tracked'
    ? [...options.bench, ...options.fielders].find(option => option.incomingId === draft.selectedId) ?? null
    : null
  const ready = draft.side === 'tracked' ? selected !== null : Boolean(draft.label.trim() || draft.number.trim())

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Pitching change">
      <h2 className="font-bold text-content">{teamName} pitching change</h2>
      <p className="text-sm text-content-muted">Pitching now: {currentPitcher}. The count carries over.</p>

      {draft.side === 'tracked' ? (
        <>
          <OptionGroup
            legend="From the bench"
            empty="No bench players are available."
            options={options.bench}
            selectedId={draft.selectedId}
            onSelect={id => onChange({ side: 'tracked', selectedId: id })}
          />
          <OptionGroup
            legend="Swap with a fielder"
            empty="No fielders to swap with."
            options={options.fielders}
            selectedId={draft.selectedId}
            onSelect={id => onChange({ side: 'tracked', selectedId: id })}
          />
          {selected && (
            <div className="rounded-md border border-accent px-3 py-2 text-sm text-content" aria-live="polite">
              {selected.summary.map(line => <p key={line}>{line}</p>)}
            </div>
          )}
          <p className="text-xs text-content-muted">
            For a double switch, use Substitute on the Lineup tab.
          </p>
        </>
      ) : (
        <>
          <label className="block space-y-1 text-sm font-semibold text-content">
            <span>Name or label</span>
            <input
              className="input-field"
              value={draft.label}
              maxLength={60}
              onChange={event => onChange({ ...draft, label: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-sm font-semibold text-content">
            <span>Number</span>
            <input
              className="input-field"
              inputMode="numeric"
              value={draft.number}
              maxLength={4}
              onChange={event => onChange({ ...draft, number: event.target.value })}
            />
          </label>
          <BaseballHandChoice
            legend="Throws"
            options={['L', 'R']}
            value={draft.throws}
            onChange={throws => onChange({ ...draft, throws: throws as BaseballPitchHand | null })}
          />
          {!ready && <p className="text-sm text-content-muted">Give the new pitcher a label or a number.</p>}
        </>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!ready} onClick={onConfirm}>Confirm</button>
      </div>
    </section>
  )
}

function OptionGroup({
  legend,
  empty,
  options,
  selectedId,
  onSelect,
}: {
  legend: string
  empty: string
  options: BaseballPitchingChangeOption[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold uppercase text-content-muted">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-content-muted">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {options.map(option => (
            <button
              key={option.incomingId}
              type="button"
              aria-pressed={option.incomingId === selectedId}
              className={`${option.incomingId === selectedId ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-left text-sm leading-tight`}
              onClick={() => onSelect(option.incomingId)}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  )
}

import {
  BASEBALL_SUBSTITUTION_KIND_LABELS,
  baseballAvailableSubstitutionKinds,
  baseballSubstitutionGroup,
  selectedBaseballSubstitution,
  type BaseballSubstitutionChoices,
  type BaseballSubstitutionDraft,
} from '../../lib/baseball'

interface BaseballSubstitutionSheetProps {
  teamName: string
  choices: BaseballSubstitutionChoices
  draft: BaseballSubstitutionDraft
  onChange: (draft: BaseballSubstitutionDraft) => void
  /** Opens the BSB-3D pitching change sheet instead. */
  onPitchingChange: (() => void) | null
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * One substitution for the tracked team (BSB-4A): pick the kind, then who or where, then
 * the player. Only legal choices are listed, and the summary says exactly what happens
 * before Confirm. Engine rejections stay in the sheet, word for word.
 */
export default function BaseballSubstitutionSheet({
  teamName,
  choices,
  draft,
  onChange,
  onPitchingChange,
  error,
  onCancel,
  onConfirm,
}: BaseballSubstitutionSheetProps) {
  const kinds = baseballAvailableSubstitutionKinds(choices)
  const groups = draft.kind ? choices[draft.kind] : []
  const group = baseballSubstitutionGroup(choices, draft)
  const selected = selectedBaseballSubstitution(choices, draft)

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Substitution">
      <h2 className="font-bold text-content">{teamName} substitution</h2>

      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">Kind</legend>
        {kinds.length === 0 && !onPitchingChange ? (
          <p className="text-sm text-content-muted">No substitutions are possible right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {kinds.map(kind => (
              <button
                key={kind}
                type="button"
                aria-pressed={draft.kind === kind}
                className={`${draft.kind === kind ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-sm leading-tight`}
                onClick={() => onChange({ kind, groupKey: null, optionKey: null })}
              >
                {BASEBALL_SUBSTITUTION_KIND_LABELS[kind]}
              </button>
            ))}
            {onPitchingChange && (
              <button type="button" className="btn-secondary min-h-11 px-2 text-sm leading-tight" onClick={onPitchingChange}>
                Pitching change
              </button>
            )}
          </div>
        )}
      </fieldset>

      {draft.kind && groups.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase text-content-muted">
            {draft.kind === 'defensive' ? 'Position' : draft.kind === 'position_change' ? 'Who moves' : 'Runner'}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {groups.map(entry => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={group?.key === entry.key}
                className={`${group?.key === entry.key ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-left text-sm leading-tight`}
                onClick={() => onChange({ ...draft, groupKey: entry.key, optionKey: null })}
              >
                {entry.title}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {group && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase text-content-muted">{group.title}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.options.map(entry => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={entry.key === selected?.key}
                className={`${entry.key === selected?.key ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-left text-sm leading-tight`}
                onClick={() => onChange({ ...draft, groupKey: group.key, optionKey: entry.key })}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {selected && (
        <div className="rounded-md border border-accent px-3 py-2 text-sm text-content" aria-live="polite">
          {selected.summary.map(line => <p key={line}>{line}</p>)}
        </div>
      )}

      <p className="text-xs text-content-muted">A double switch comes with a later update.</p>

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!selected} onClick={onConfirm}>Confirm</button>
      </div>
    </section>
  )
}

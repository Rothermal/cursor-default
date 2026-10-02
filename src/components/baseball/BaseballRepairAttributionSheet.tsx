import { baseballRoleLabel } from '../../lib/baseball'

interface BaseballRepairAttributionSheetProps {
  label: string
  halfLabel: string
  /** Roles whose stamp differs from the replayed lineup, with the warning. */
  roles: Array<{ role: string; message: string }>
  selected: string[]
  onChange: (selected: string[]) => void
  error: string | null
  onCancel: () => void
  onPreview: () => void
}

/**
 * Repair attribution (BSB-4D): restamps the chosen roles to the player the lineup shows at
 * that point. The preview shows each role's credit before and after; nothing is saved here.
 */
export default function BaseballRepairAttributionSheet({
  label,
  halfLabel,
  roles,
  selected,
  onChange,
  error,
  onCancel,
  onPreview,
}: BaseballRepairAttributionSheetProps) {
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Repair attribution">
      <div>
        <h2 className="font-bold text-content">Repair attribution</h2>
        <p className="text-xs text-content-muted">{label} · {halfLabel}</p>
      </div>
      <p className="text-sm text-content-muted">
        Credit the chosen roles to the player the lineup shows for this play. Other roles keep their credit.
      </p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Roles</legend>
        {roles.map(entry => (
          <label key={entry.role} className="flex min-h-11 items-start gap-3 rounded-md border border-line px-3 py-2">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-[rgb(var(--accent))]"
              checked={selected.includes(entry.role)}
              onChange={event => onChange(event.target.checked
                ? [...selected, entry.role]
                : selected.filter(role => role !== entry.role))}
            />
            <span className="text-sm text-content">
              <span className="block font-semibold">{baseballRoleLabel(entry.role)}</span>
              <span className="block text-xs text-content-muted">{entry.message}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={selected.length === 0} onClick={onPreview}>Preview</button>
      </div>
    </section>
  )
}

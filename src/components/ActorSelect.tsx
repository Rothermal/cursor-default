import { useId } from 'react'

export interface ActorOption { value: string; label: string }

/** Presentation only: callers own ordering, eligibility and empty-value semantics. */
export default function ActorSelect({ label, value, options, onChange, disabled = false,
  emptyOption = { value: '', label: 'Unattributed' } }: {
  label: string
  value: string
  options: ActorOption[]
  onChange: (value: string) => void
  disabled?: boolean
  emptyOption?: ActorOption | null
}) {
  const id = useId()
  const present = options.some(option => option.value === value) || emptyOption?.value === value
  return <label htmlFor={id} className="block min-w-0 text-sm font-semibold text-content">
    {label}
    <select id={id} aria-label={label} className="input-field mt-1 w-full min-w-0" value={value}
      disabled={disabled} onChange={event => onChange(event.target.value)}>
      {!present && <option value={value} disabled>Player unavailable - choose again</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      {emptyOption && <option value={emptyOption.value}>{emptyOption.label}</option>}
    </select>
  </label>
}

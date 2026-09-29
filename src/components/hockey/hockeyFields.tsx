import { useId, type ReactNode } from 'react'
import ActorSelect from '../ActorSelect'
import { hockeyParticipantLabel, type HockeyMatchParticipant, type HockeySide } from '../../lib/hockey'

/** Shared form pieces for the Hockey capture dialogs. */

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-bold uppercase text-content-muted">{label}</legend>
      {children}
    </fieldset>
  )
}

export function Choices<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  columns?: 2 | 3 | 4
}) {
  return (
    <div className={`grid gap-1 rounded-md bg-control p-1 ${columns === 4 ? 'grid-cols-4' : columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`min-h-10 truncate rounded px-2 text-sm font-semibold ${option.value === value ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A dressed-player select for the tracked side, or a label input with recent chips for the opponent. */
export function ActorField({
  label,
  owner,
  value,
  onChange,
  trackedOptions,
  recentLabels,
  emptyLabel,
  disabled = false,
}: {
  label: string
  owner: HockeySide
  value: string
  onChange: (value: string) => void
  trackedOptions: HockeyMatchParticipant[]
  recentLabels: string[]
  emptyLabel: string
  disabled?: boolean
}) {
  const inputId = useId()
  if (owner === 'tracked') {
    return (
      <ActorSelect
        label={label}
        value={value}
        options={trackedOptions.map(participant => ({ value: participant.id, label: hockeyParticipantLabel(participant) }))}
        onChange={onChange}
        disabled={disabled}
        emptyOption={{ value: '', label: emptyLabel }}
      />
    )
  }
  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="block text-sm font-semibold text-content">{label}</label>
      <input
        id={inputId}
        className="input-field mt-1 w-full"
        maxLength={80}
        placeholder={`${emptyLabel}, or #12 / name`}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      />
      {recentLabels.length > 0 && !disabled && (
        <div className="mt-1 flex flex-wrap gap-1" aria-label={`Recent opponent players for ${label.toLowerCase()}`}>
          {recentLabels.map(recent => (
            <button
              key={recent}
              type="button"
              aria-pressed={value === recent}
              onClick={() => onChange(value === recent ? '' : recent)}
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${value === recent ? 'border-accent bg-accent text-accent-content' : 'border-line-strong text-content-muted'}`}
            >
              {recent}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


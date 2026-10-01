interface BaseballHandChoiceProps {
  legend: string
  options: ReadonlyArray<'L' | 'R' | 'S'>
  value: 'L' | 'R' | 'S' | null
  /** Tapping the chosen hand again clears it (unknown). */
  onChange: (value: 'L' | 'R' | 'S' | null) => void
  compact?: boolean
}

const LABELS = { L: 'Left', R: 'Right', S: 'Switch' } as const

/** Optional handedness (BSB-4A): L / R (/ S), or nothing when unknown. */
export default function BaseballHandChoice({ legend, options, value, onChange, compact = false }: BaseballHandChoiceProps) {
  return (
    <fieldset className={compact ? 'flex items-center gap-1' : 'space-y-1'}>
      <legend className={compact ? 'sr-only' : 'text-sm font-semibold text-content'}>{legend}</legend>
      <div className="flex gap-1">
        {options.map(option => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            aria-label={`${legend} ${LABELS[option]}`}
            title={`${legend} ${LABELS[option]}`}
            className={`${value === option ? 'btn-primary' : 'btn-secondary'} ${compact ? 'h-9 w-9 px-0' : 'min-h-11 px-3'} text-sm`}
            onClick={() => onChange(value === option ? null : option)}
          >
            {compact ? option : LABELS[option]}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

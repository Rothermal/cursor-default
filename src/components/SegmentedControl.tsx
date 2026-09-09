interface SegmentOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div className="rounded-xl border border-line bg-surface p-1" role="tablist" aria-label={label}>
      <div className="grid grid-cols-3 gap-1">
        {options.map(option => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-10 rounded-lg px-2 text-sm font-semibold ${
                selected
                  ? 'bg-accent text-accent-content'
                  : 'text-content-muted hover:bg-surface-muted'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

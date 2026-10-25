type TrackerSide = 'tracked' | 'opponent'

/** Presentation only: the sport decides how this context seeds its next capture. */
export default function TrackerSideSelector({ side, labels, onChange }: {
  side: TrackerSide
  labels: Record<TrackerSide, string>
  onChange: (side: TrackerSide) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-md bg-control p-1" role="group" aria-label="Recording team">
      {(['tracked', 'opponent'] as const).map(value => (
        <button key={value} type="button" aria-pressed={side === value} title={labels[value]}
          onClick={() => onChange(value)}
          className={`min-h-11 min-w-0 break-words rounded px-2 py-2 text-sm font-semibold leading-tight [overflow-wrap:anywhere] ${side === value ? 'bg-accent text-accent-content' : 'text-content-muted'}`}>
          {labels[value]}
        </button>
      ))}
    </div>
  )
}

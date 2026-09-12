import type { SportTheme } from '../../types'

export interface PeriodToggleProps {
  /** Total number of selectable periods (base halves/quarters + any OT added). */
  periods: number
  periodLabels: string[]
  currentPeriod: number
  onPeriodChange: (period: number) => void
  onAddOvertime: () => void
  sportTheme: SportTheme
  /** Label for the add-OT control (e.g. "+ OT"). */
  addOvertimeLabel: string
}

export default function PeriodToggle({
  periods,
  periodLabels,
  currentPeriod,
  onPeriodChange,
  onAddOvertime,
  addOvertimeLabel,
}: PeriodToggleProps) {
  const compact = periods >= 6
  return (
    <div className="flex flex-wrap gap-2 items-center justify-center py-2 max-w-full">
      {Array.from({ length: periods }, (_, i) => {
        const p = i + 1
        const label = periodLabels[i] ?? `Period ${p}`
        const active = p === currentPeriod
        return (
          <button
            key={p}
            type="button"
            onClick={() => onPeriodChange(p)}
            className={`
              max-w-full break-words rounded-lg font-semibold transition-transform active:scale-95
              border
              ${compact ? 'px-2 py-1.5 text-[10px] leading-tight' : 'px-3 py-2 text-xs'}
              ${active
                ? 'bg-accent text-accent-content border-transparent shadow-sm'
                : 'bg-surface text-content-muted border-line hover:bg-control-hover'
              }
            `}
          >
            {label}
          </button>
        )
      })}
      <button
        type="button"
        onClick={onAddOvertime}
        className={`
          max-w-full break-words rounded-lg px-3 py-2 text-xs font-semibold border border-dashed transition-transform active:scale-95
          border-line-strong text-content bg-control hover:bg-control-hover
        `}
      >
        {addOvertimeLabel}
      </button>
    </div>
  )
}

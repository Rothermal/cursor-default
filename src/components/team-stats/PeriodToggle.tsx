import type { SportTheme } from '../../types'

export interface PeriodToggleProps {
  periods: number
  periodLabels: string[]
  currentPeriod: number
  onPeriodChange: (period: number) => void
  onAddOvertime: () => void
  sportTheme: SportTheme
  addOvertimeLabel: string
}

export default function PeriodToggle({
  periods,
  periodLabels,
  currentPeriod,
  onPeriodChange,
  onAddOvertime,
  sportTheme,
  addOvertimeLabel,
}: PeriodToggleProps) {
  return (
    <div className="flex flex-wrap gap-2 items-center justify-center py-2">
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
              rounded-lg px-3 py-2 text-xs font-semibold transition-all active:scale-95
              border
              ${active
                ? `${sportTheme.bg} text-white border-transparent shadow-sm`
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
          rounded-lg px-3 py-2 text-xs font-semibold border border-dashed transition-all active:scale-95
          ${sportTheme.border} ${sportTheme.text} bg-white hover:bg-slate-50
        `}
      >
        {addOvertimeLabel}
      </button>
    </div>
  )
}

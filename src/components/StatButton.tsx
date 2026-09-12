import { useState } from 'react'
import type { StatColor } from '../types'

const colorStyles: Record<StatColor, { bg: string; activeBg: string; text: string; badge: string }> = {
  amber: { bg: 'bg-stat-amber-surface', activeBg: 'bg-stat-amber-active', text: 'text-stat-amber-content', badge: 'bg-stat-amber-badge text-stat-amber-badge-content' },
  sky: { bg: 'bg-stat-sky-surface', activeBg: 'bg-stat-sky-active', text: 'text-stat-sky-content', badge: 'bg-stat-sky-badge text-stat-sky-badge-content' },
  emerald: { bg: 'bg-stat-emerald-surface', activeBg: 'bg-stat-emerald-active', text: 'text-stat-emerald-content', badge: 'bg-stat-emerald-badge text-stat-emerald-badge-content' },
  violet: { bg: 'bg-stat-violet-surface', activeBg: 'bg-stat-violet-active', text: 'text-stat-violet-content', badge: 'bg-stat-violet-badge text-stat-violet-badge-content' },
  rose: { bg: 'bg-stat-rose-surface', activeBg: 'bg-stat-rose-active', text: 'text-stat-rose-content', badge: 'bg-stat-rose-badge text-stat-rose-badge-content' },
  slate: { bg: 'bg-stat-slate-surface', activeBg: 'bg-stat-slate-active', text: 'text-stat-slate-content', badge: 'bg-stat-slate-badge text-stat-slate-badge-content' },
  orange: { bg: 'bg-stat-orange-surface', activeBg: 'bg-stat-orange-active', text: 'text-stat-orange-content', badge: 'bg-stat-orange-badge text-stat-orange-badge-content' },
  red: { bg: 'bg-stat-red-surface', activeBg: 'bg-stat-red-active', text: 'text-stat-red-content', badge: 'bg-stat-red-badge text-stat-red-badge-content' },
  blue: { bg: 'bg-stat-blue-surface', activeBg: 'bg-stat-blue-active', text: 'text-stat-blue-content', badge: 'bg-stat-blue-badge text-stat-blue-badge-content' },
  green: { bg: 'bg-stat-green-surface', activeBg: 'bg-stat-green-active', text: 'text-stat-green-content', badge: 'bg-stat-green-badge text-stat-green-badge-content' },
  indigo: { bg: 'bg-stat-indigo-surface', activeBg: 'bg-stat-indigo-active', text: 'text-stat-indigo-content', badge: 'bg-stat-indigo-badge text-stat-indigo-badge-content' },
  teal: { bg: 'bg-stat-teal-surface', activeBg: 'bg-stat-teal-active', text: 'text-stat-teal-content', badge: 'bg-stat-teal-badge text-stat-teal-badge-content' },
  cyan: { bg: 'bg-stat-cyan-surface', activeBg: 'bg-stat-cyan-active', text: 'text-stat-cyan-content', badge: 'bg-stat-cyan-badge text-stat-cyan-badge-content' },
  pink: { bg: 'bg-stat-pink-surface', activeBg: 'bg-stat-pink-active', text: 'text-stat-pink-content', badge: 'bg-stat-pink-badge text-stat-pink-badge-content' },
}

interface StatButtonProps {
  label: string
  shortLabel: string
  value: number
  color: StatColor
  pointValue?: number
  /** Optional line under the header row (e.g. game total for period-scoped team stats). */
  subtitle?: string
  /** When set, + is disabled at this count (inclusive). */
  maxValue?: number
  onIncrement: () => void
  onDecrement: () => void
  onAttemptDecrement?: () => void
  /** If provided, renders a middle "A" (attempt/miss) button between − and +. */
  onAttempt?: () => void
  /** Number of misses logged; combined with value to display made/total in badge. */
  attemptCount?: number
  disabled?: boolean
  incrementDisabled?: boolean
  attemptIncrementDisabled?: boolean
  decrementDisabled?: boolean
  attemptDecrementDisabled?: boolean
}

export default function StatButton({
  label,
  shortLabel,
  value,
  color,
  pointValue,
  subtitle,
  maxValue,
  onIncrement,
  onDecrement,
  onAttemptDecrement,
  onAttempt,
  attemptCount = 0,
  disabled = false,
  incrementDisabled = false,
  attemptIncrementDisabled = false,
  decrementDisabled = false,
  attemptDecrementDisabled = false,
}: StatButtonProps) {
  const [flash, setFlash] = useState(false)
  const [attemptFlash, setAttemptFlash] = useState(false)
  const styles = colorStyles[color] || colorStyles.slate
  const hasAttempt = Boolean(onAttempt)
  const totalAttempts = value + attemptCount

  const handleIncrement = () => {
    onIncrement()
    setFlash(true)
    setTimeout(() => setFlash(false), 150)
  }

  const handleAttempt = () => {
    onAttempt?.()
    setAttemptFlash(true)
    setTimeout(() => setAttemptFlash(false), 150)
  }

  return (
    <div
      className={`
        ${flash ? styles.activeBg : styles.bg}
        ${styles.text}
        rounded-xl border border-line p-3
        transition-transform duration-150 select-none
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium truncate" title={label}>
          {shortLabel}
          {pointValue ? <span className="ml-1">(+{pointValue})</span> : null}
        </span>
        <span
          className={`${styles.badge} text-xs font-bold rounded-full px-1.5 min-w-[1.5rem] h-6 flex items-center justify-center`}
        >
          {hasAttempt ? `${value}/${totalAttempts}` : value}
        </span>
      </div>
      {subtitle ? (
        <p className="text-[11px] mb-2 leading-tight">{subtitle}</p>
      ) : null}
      <div className="flex gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onDecrement() }}
          disabled={disabled || decrementDisabled || value === 0}
          aria-label={`Decrease ${label}`}
          className="flex-1 h-10 rounded-lg bg-control text-content border border-line text-lg font-bold
                     active:scale-95 transition-transform disabled:bg-control-disabled disabled:text-content-disabled"
        >
          −
        </button>
        {hasAttempt && (
          onAttemptDecrement ? (
            <button
              onClick={(e) => { e.stopPropagation(); onAttemptDecrement() }}
              disabled={disabled || attemptDecrementDisabled || attemptCount === 0}
              aria-label={`Decrease missed ${label} attempt`}
              className="flex-1 h-10 rounded-lg bg-surface border border-line text-xs font-bold
                         active:scale-95 transition-transform disabled:bg-control-disabled disabled:text-content-disabled"
            >
              -M
            </button>
          ) : null
        )}
        {hasAttempt && (
          <button
            onClick={(e) => { e.stopPropagation(); handleAttempt() }}
            disabled={disabled || attemptIncrementDisabled}
            aria-label={`Record missed ${label} attempt`}
            className={`flex-1 h-10 rounded-lg text-content text-sm font-bold
                        active:scale-95 transition-transform shadow-sm disabled:bg-control-disabled disabled:text-content-disabled
                        ${attemptFlash ? 'bg-control-hover' : 'bg-control'}`}
            title="Record missed attempt"
          >
            {onAttemptDecrement ? '+M' : 'A'}
          </button>
        )}
        <button
          onClick={handleIncrement}
          disabled={disabled || incrementDisabled || (maxValue !== undefined && value >= maxValue)}
          aria-label={`Increase ${label}`}
          className={`${hasAttempt ? 'flex-1' : 'flex-[2]'} h-10 rounded-lg ${styles.badge} text-lg font-bold
                      active:scale-95 transition-transform shadow-sm disabled:bg-control-disabled disabled:text-content-disabled disabled:pointer-events-none`}
        >
          +
        </button>
      </div>
    </div>
  )
}

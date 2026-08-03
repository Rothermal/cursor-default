import { useState } from 'react'
import type { StatColor } from '../types'

const colorStyles: Record<StatColor, { bg: string; activeBg: string; text: string; badge: string }> = {
  amber:   { bg: 'bg-amber-50',   activeBg: 'bg-amber-100',   text: 'text-amber-800',   badge: 'bg-amber-500' },
  sky:     { bg: 'bg-sky-50',     activeBg: 'bg-sky-100',     text: 'text-sky-800',     badge: 'bg-sky-500' },
  emerald: { bg: 'bg-emerald-50', activeBg: 'bg-emerald-100', text: 'text-emerald-800', badge: 'bg-emerald-500' },
  violet:  { bg: 'bg-violet-50',  activeBg: 'bg-violet-100',  text: 'text-violet-800',  badge: 'bg-violet-500' },
  rose:    { bg: 'bg-rose-50',    activeBg: 'bg-rose-100',    text: 'text-rose-800',    badge: 'bg-rose-500' },
  slate:   { bg: 'bg-slate-100',  activeBg: 'bg-slate-200',   text: 'text-slate-700',   badge: 'bg-slate-500' },
  orange:  { bg: 'bg-orange-50',  activeBg: 'bg-orange-100',  text: 'text-orange-800',  badge: 'bg-orange-500' },
  red:     { bg: 'bg-red-50',     activeBg: 'bg-red-100',     text: 'text-red-800',     badge: 'bg-red-500' },
  blue:    { bg: 'bg-blue-50',    activeBg: 'bg-blue-100',    text: 'text-blue-800',    badge: 'bg-blue-500' },
  green:   { bg: 'bg-green-50',   activeBg: 'bg-green-100',   text: 'text-green-800',   badge: 'bg-green-500' },
  indigo:  { bg: 'bg-indigo-50',  activeBg: 'bg-indigo-100',  text: 'text-indigo-800',  badge: 'bg-indigo-500' },
  teal:    { bg: 'bg-teal-50',    activeBg: 'bg-teal-100',    text: 'text-teal-800',    badge: 'bg-teal-500' },
  cyan:    { bg: 'bg-cyan-50',    activeBg: 'bg-cyan-100',    text: 'text-cyan-800',    badge: 'bg-cyan-500' },
  pink:    { bg: 'bg-pink-50',    activeBg: 'bg-pink-100',    text: 'text-pink-800',    badge: 'bg-pink-500' },
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
        rounded-xl border border-slate-200 p-3
        transition-colors duration-150 select-none
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium truncate" title={label}>
          {shortLabel}
          {pointValue ? <span className="opacity-60 ml-1">(+{pointValue})</span> : null}
        </span>
        <span
          className={`${styles.badge} text-white text-xs font-bold rounded-full px-1.5 min-w-[1.5rem] h-6 flex items-center justify-center`}
        >
          {hasAttempt ? `${value}/${totalAttempts}` : value}
        </span>
      </div>
      {subtitle ? (
        <p className="text-[11px] text-slate-500 mb-2 leading-tight">{subtitle}</p>
      ) : null}
      <div className="flex gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onDecrement() }}
          disabled={disabled || decrementDisabled || value === 0}
          aria-label={`Decrease ${label}`}
          className="flex-1 h-10 rounded-lg bg-white/60 border border-slate-200 text-lg font-bold
                     active:scale-95 transition-transform disabled:opacity-30"
        >
          −
        </button>
        {hasAttempt && (
          onAttemptDecrement ? (
            <button
              onClick={(e) => { e.stopPropagation(); onAttemptDecrement() }}
              disabled={disabled || attemptDecrementDisabled || attemptCount === 0}
              aria-label={`Decrease missed ${label} attempt`}
              className="flex-1 h-10 rounded-lg bg-white/60 border border-slate-200 text-xs font-bold
                         active:scale-95 transition-transform disabled:opacity-30"
            >
              -M
            </button>
          ) : null
        )}
        {hasAttempt && (
          <button
            onClick={(e) => { e.stopPropagation(); handleAttempt() }}
            disabled={disabled}
            aria-label={`Record missed ${label} attempt`}
            className={`flex-1 h-10 rounded-lg text-white text-sm font-bold
                        active:scale-95 transition-transform shadow-sm disabled:opacity-30
                        ${attemptFlash ? 'bg-slate-600' : 'bg-slate-500'}`}
            title="Record missed attempt"
          >
            {onAttemptDecrement ? '+M' : 'A'}
          </button>
        )}
        <button
          onClick={handleIncrement}
          disabled={disabled || (maxValue !== undefined && value >= maxValue)}
          aria-label={`Increase ${label}`}
          className={`${hasAttempt ? 'flex-1' : 'flex-[2]'} h-10 rounded-lg ${styles.badge} text-white text-lg font-bold
                      active:scale-95 transition-transform shadow-sm disabled:opacity-30 disabled:pointer-events-none`}
        >
          +
        </button>
      </div>
    </div>
  )
}

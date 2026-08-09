import { Ban, Flag, Pause, Play, RotateCcw, Square } from 'lucide-react'
import type { BasketballSportGameState } from '../../lib/basketball/types'

interface BasketballLifecycleControlsProps {
  sportState: BasketballSportGameState
  errorMessage?: string | null
  onEndPeriod: () => void
  onStartNextPeriod: () => void
  onComplete: () => void
  onSuspend: () => void
  onAbandon: () => void
  onReopen: () => void
}

export default function BasketballLifecycleControls({
  sportState,
  errorMessage,
  onEndPeriod,
  onStartNextPeriod,
  onComplete,
  onSuspend,
  onAbandon,
  onReopen,
}: BasketballLifecycleControlsProps) {
  const { projection, setup } = sportState
  const current = projection.periods.find(period => period.id === projection.currentPeriodId)
  const regulationComplete = setup.rulesSnapshot.regulationSegments.every(segment =>
    projection.completedPeriodIds.includes(segment.id)
  )
  const tied = projection.score.tracked === projection.score.opponent
  const nextLabel = nextPeriodLabel(sportState)

  return (
    <section aria-label="Basketball game lifecycle" className="mt-3 border-y border-slate-200 bg-white px-3 py-2.5">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-slate-500">Period</p>
          <p className="truncate text-sm font-bold text-slate-800">{lifecycleStatusLabel(sportState)}</p>
        </div>

        {projection.status === 'in_progress' && current && (
          <button
            type="button"
            onClick={onEndPeriod}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 active:scale-95"
          >
            <Square size={15} aria-hidden />
            End {current.label}
          </button>
        )}

        {projection.status === 'period_break' && (!regulationComplete || tied) && nextLabel && (
          <button
            type="button"
            onClick={onStartNextPeriod}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white active:scale-95"
          >
            <Play size={16} aria-hidden />
            Start {nextLabel}
          </button>
        )}

        {projection.status === 'period_break' && regulationComplete && !tied && (
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white active:scale-95"
          >
            <Flag size={16} aria-hidden />
            End Game
          </button>
        )}

        {(projection.status === 'ended' || projection.status === 'suspended') && (
          <button
            type="button"
            onClick={onReopen}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 active:scale-95"
          >
            <RotateCcw size={16} aria-hidden />
            Reopen
          </button>
        )}
      </div>

      {(projection.status === 'in_progress' || projection.status === 'period_break') && (
        <div className="mt-2 flex justify-end gap-2 border-t border-slate-100 pt-2">
          <button type="button" onClick={onSuspend} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">
            <Pause size={15} aria-hidden />
            Suspend
          </button>
          <button type="button" onClick={onAbandon} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700">
            <Ban size={15} aria-hidden />
            Abandon
          </button>
        </div>
      )}

      {projection.status === 'period_break' && (
        <p className="mt-1 text-xs text-slate-500" role="status">
          {regulationComplete && tied
            ? 'The score is tied. Start overtime to continue.'
            : regulationComplete
              ? 'Period complete. End the game when ready.'
              : 'Period complete. Start the next period when ready.'}
        </p>
      )}
      {(projection.status === 'ended' || projection.status === 'suspended') && (
        <p className="mt-1 text-xs text-slate-500" role="status">{resultLabel(projection.result)}</p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
          {errorMessage}
        </p>
      )}
    </section>
  )
}

function lifecycleStatusLabel(sportState: BasketballSportGameState): string {
  const { projection } = sportState
  const current = projection.periods.find(period => period.id === projection.currentPeriodId)
  if (projection.status === 'suspended') return `Suspended - ${current?.label ?? 'period unavailable'}`
  if (projection.status === 'ended') {
    return projection.endReason === 'abandoned' ? 'Abandoned' : 'Final'
  }
  if (projection.status === 'period_break') return `${current?.label ?? 'Period'} complete`
  return current?.label ?? 'Unavailable'
}

function nextPeriodLabel(sportState: BasketballSportGameState): string | null {
  const { projection, setup } = sportState
  const current = projection.periods.find(period => period.id === projection.currentPeriodId)
  if (!current) return null
  const rules = setup.rulesSnapshot
  if (current.order < rules.regulationSegments.length) {
    return rules.regulationSegments.find(segment => segment.order === current.order + 1)?.label ?? null
  }
  const overtimeNumber = current.order - rules.regulationSegments.length + 1
  return overtimeNumber === 1
    ? rules.overtimeTemplate.label
    : `${rules.overtimeTemplate.label} ${overtimeNumber}`
}

function resultLabel(result: BasketballSportGameState['projection']['result']): string {
  switch (result) {
    case 'tracked_win': return 'Tracked team won'
    case 'opponent_win': return 'Opponent won'
    case 'draw': return 'Draw'
    case 'suspended': return 'Suspended'
    case 'abandoned': return 'Abandoned'
    default: return 'Complete'
  }
}

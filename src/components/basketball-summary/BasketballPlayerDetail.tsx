import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
  formatBasketballPercentage,
  formatBasketballRatio,
  type BasketballPlayerReviewRow,
} from '../../lib/basketball/summaryDetails'
import { formatBasketballDurationMs } from '../../lib/basketball/duration'

interface Props {
  player: BasketballPlayerReviewRow
  onClose: () => void
}

export default function BasketballPlayerDetail({ player, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const line = player.line
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-player-detail-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-lg sm:rounded-lg"
      >
        <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded bg-blue-100 text-sm font-bold text-blue-800">
            {player.number ?? '-'}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="basketball-player-detail-title" className="truncate font-bold text-slate-900">
              {player.displayName}
            </h2>
            <p className="truncate text-xs text-slate-500">
              {player.rosterStatus} roster{player.lateAdded ? ' / added during game' : ''}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded text-slate-500 hover:bg-slate-100"
            aria-label="Close player detail"
            title="Close"
          >
            <X size={20} />
          </button>
        </header>

        <StatSection title="Participation" rows={[
          ['Opening assignment', player.participation.started ? 'Starter' : player.rosterStatus === 'dnp' ? 'DNP' : 'Bench'],
          ['Final appearance', appearanceLabel(player)],
          [player.participation.basis === 'interval_derived' ? 'Playing time' : 'Recorded manual time', player.participation.displayTime],
          ['Stints', player.participation.basis === 'interval_derived' ? player.participation.stintCount : 'Not available'],
          ['Plus-minus', formatPlusMinus(player.participation.plusMinus)],
        ]} />
        {player.participation.qualityReason && (
          <p className="mx-4 mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {player.participation.qualityReason}
          </p>
        )}
        {player.participation.plusMinus === null && player.participation.plusMinusUnavailableReason && (
          <p className="mx-4 mt-3 text-xs text-slate-500">
            Plus-minus unavailable: {player.participation.plusMinusUnavailableReason}
          </p>
        )}
        {player.participation.intervals.length > 0 && (
          <section className="border-b border-slate-200 px-4 py-4">
            <h3 className="text-xs font-bold uppercase text-slate-500">Stints</h3>
            <div className="mt-2 divide-y divide-slate-100">
              {player.participation.intervals.map((interval, index) => (
                <div key={`${interval.periodId}:${index}`} className="flex items-start justify-between gap-4 py-2 text-sm">
                  <div>
                    <p className="font-semibold text-slate-800">{interval.periodLabel}</p>
                    <p className="text-xs tabular-nums text-slate-500">
                      {formatBasketballDurationMs(interval.startElapsedMs)} to {formatBasketballDurationMs(interval.endElapsedMs)} elapsed
                    </p>
                  </div>
                  <strong className="tabular-nums text-slate-900">{interval.displayDuration}</strong>
                </div>
              ))}
            </div>
          </section>
        )}
        {player.roleHistory.length > 0 && (
          <section className="border-b border-slate-200 px-4 py-4">
            <h3 className="text-xs font-bold uppercase text-slate-500">Role history</h3>
            <div className="mt-2 divide-y divide-slate-100">
              {player.roleHistory.map(role => (
                <div key={role.eventId} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="text-slate-600">
                    {role.periodLabel} at {formatBasketballDurationMs(role.elapsedMs)}
                  </span>
                  <strong className="text-right text-slate-900">
                    {role.position ?? 'No position'}{role.captain ? ' / Captain' : ''}
                  </strong>
                </div>
              ))}
            </div>
          </section>
        )}

        <StatSection title="Scoring" rows={[
          ['Points', line.points],
          ['Field goals', `${line.fieldGoalsMade}-${line.fieldGoalsAttempted}`],
          ['Field goal percentage', formatBasketballPercentage(line.fieldGoalPercentage)],
          ['2-pointers', `${line.twoPointMade}-${line.twoPointAttempted}`],
          ['2-point percentage', formatBasketballPercentage(line.twoPointPercentage)],
          ['3-pointers', `${line.threePointMade}-${line.threePointAttempted}`],
          ['3-point percentage', formatBasketballPercentage(line.threePointPercentage)],
          ['Free throws', `${line.freeThrowsMade}-${line.freeThrowsAttempted}`],
          ['Free throw percentage', formatBasketballPercentage(line.freeThrowPercentage)],
        ]} />
        <StatSection title="Floor game" rows={[
          ['Offensive rebounds', line.offensiveRebounds],
          ['Defensive rebounds', line.defensiveRebounds],
          ['Total rebounds', line.rebounds],
          ['Assists', line.assists],
          ['Steals', line.steals],
          ['Blocks', line.blocks],
          ['Turnovers', line.turnovers],
          ['Personal fouls', line.personalFouls],
          [player.participation.basis === 'interval_derived' ? 'Legacy manual-minute events' : 'Manual minutes', line.manualMinutes],
        ]} />
        <StatSection title="Derived rates" rows={[
          ['Effective FG%', formatBasketballPercentage(line.effectiveFieldGoalPercentage)],
          ['True shooting%', formatBasketballPercentage(line.trueShootingPercentage)],
          ['Assist / turnover', formatBasketballRatio(line.assistToTurnoverRatio)],
        ]} />
        {(player.disqualified || player.ejected || player.captain || player.position) && (
          <StatSection title="Match status" rows={[
            ['Position', player.position ?? 'Not assigned'],
            ['Captain', player.captain ? 'Yes' : 'No'],
            ['Disqualified', player.disqualified ? 'Yes' : 'No'],
            ['Ejected', player.ejected ? 'Yes' : 'No'],
          ]} />
        )}
      </div>
    </div>
  )
}

function appearanceLabel(player: BasketballPlayerReviewRow): string {
  if (player.participation.appeared === true) return 'Played'
  if (player.participation.dnp === true) return 'DNP'
  return 'Not derivable from clockless history'
}

function formatPlusMinus(value: number | null): string {
  if (value === null) return 'Not available'
  return value > 0 ? `+${value}` : String(value)
}

function StatSection({
  title,
  rows,
}: {
  title: string
  rows: Array<[string, string | number]>
}) {
  return (
    <section className="border-b border-slate-200 px-4 py-4 last:border-b-0">
      <h3 className="text-xs font-bold uppercase text-slate-500">{title}</h3>
      <dl className="mt-2 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-9 items-center justify-between gap-4 py-1.5">
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

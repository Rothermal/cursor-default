import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
  formatBasketballPercentage,
  formatBasketballRatio,
  type BasketballPlayerReviewRow,
} from '../../lib/basketball/summaryDetails'

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
          ['Manual minutes', line.manualMinutes],
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

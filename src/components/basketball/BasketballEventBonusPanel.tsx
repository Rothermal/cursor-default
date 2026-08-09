import type { BasketballBonusStatus } from '../../lib/basketball/types'

interface BasketballEventBonusPanelProps {
  periodLabel: string
  trackedTeamName: string
  opponentName: string
  trackedFouls: number
  opponentFouls: number
  trackedStatus: BasketballBonusStatus
  opponentStatus: BasketballBonusStatus
  hasOneAndOne: boolean
}

export default function BasketballEventBonusPanel({
  periodLabel,
  trackedTeamName,
  opponentName,
  trackedFouls,
  opponentFouls,
  trackedStatus,
  opponentStatus,
  hasOneAndOne,
}: BasketballEventBonusPanelProps) {
  return (
    <section className="mt-2 border-y border-slate-200 bg-white px-3 py-2.5" aria-labelledby="basketball-team-fouls-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id="basketball-team-fouls-title" className="text-sm font-bold text-slate-800">Team fouls & bonus</h3>
        <span className="text-xs font-semibold text-slate-500">{periodLabel}</span>
      </div>
      <div className="divide-y divide-slate-100 border-t border-slate-100">
        <BonusRow
          teamName={trackedTeamName}
          opponentName={opponentName}
          foulCount={trackedFouls}
          status={trackedStatus}
          hasOneAndOne={hasOneAndOne}
        />
        <BonusRow
          teamName={opponentName}
          opponentName={trackedTeamName}
          foulCount={opponentFouls}
          status={opponentStatus}
          hasOneAndOne={hasOneAndOne}
        />
      </div>
    </section>
  )
}

function BonusRow({
  teamName,
  opponentName,
  foulCount,
  status,
  hasOneAndOne,
}: {
  teamName: string
  opponentName: string
  foulCount: number
  status: BasketballBonusStatus
  hasOneAndOne: boolean
}) {
  const statusText = status === 'double_bonus'
    ? `${opponentName}: ${hasOneAndOne ? 'Double bonus' : 'Bonus'}`
    : status === 'one_and_one'
      ? `${opponentName}: 1-and-1`
      : 'No bonus'
  const statusClass = status === 'double_bonus'
    ? 'bg-rose-100 text-rose-800'
    : status === 'one_and_one'
      ? 'bg-amber-100 text-amber-900'
      : 'bg-slate-100 text-slate-600'

  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-2">
      <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
        {teamName} <span className="font-normal text-slate-500">{foulCount} foul{foulCount === 1 ? '' : 's'}</span>
      </p>
      <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${statusClass}`}>{statusText}</span>
    </div>
  )
}

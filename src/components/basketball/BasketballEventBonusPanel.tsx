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
    <section className="mt-2 border-y border-line bg-surface px-3 py-2.5" aria-labelledby="basketball-team-fouls-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id="basketball-team-fouls-title" className="text-sm font-bold text-content">Team fouls & bonus</h3>
        <span className="text-xs font-semibold text-content-muted">{periodLabel}</span>
      </div>
      <div className="divide-y divide-line border-t border-line">
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
    ? 'bg-danger text-danger-content'
    : status === 'one_and_one'
      ? 'bg-warning text-warning-content'
      : 'bg-surface-muted text-content-muted'

  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2">
      <p className="min-w-0 truncate text-sm font-semibold text-content">
        {teamName} <span className="font-normal text-content-muted">{foulCount} foul{foulCount === 1 ? '' : 's'}</span>
      </p>
      <span className={`max-w-full break-words rounded-md px-2 py-1 text-xs font-bold ${statusClass}`}>{statusText}</span>
    </div>
  )
}

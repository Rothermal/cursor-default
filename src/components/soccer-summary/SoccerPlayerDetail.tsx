import { ShieldCheck, X } from 'lucide-react'
import {
  formatSoccerReviewDuration,
  formatSoccerReviewRate,
  type SoccerPlayerReviewRow,
} from '../../lib/soccer/summaryPlayers'

interface SoccerPlayerDetailProps {
  player: SoccerPlayerReviewRow
  onClose: () => void
}

export default function SoccerPlayerDetail({
  player,
  onClose,
}: SoccerPlayerDetailProps) {
  const assists = player.stats.primaryAssists + player.stats.secondaryAssists
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-player-detail-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-lg sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center bg-emerald-100 text-sm font-bold text-emerald-800">
            {player.number ?? '-'}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="soccer-player-detail-title"
              className="truncate font-bold text-slate-900"
            >
              {player.displayName}
            </h2>
            <p className="truncate text-xs capitalize text-slate-500">
              {lineupLabel(player.lineupStatus)} - {roleLabel(player.role)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center text-slate-500"
            aria-label="Close"
            title="Close"
          >
            <X size={20} />
          </button>
        </header>

        <section className="border-b border-slate-200 px-4 py-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailValue
              label="Minutes"
              value={player.lineupStatus === 'dnp'
                ? 'DNP'
                : formatSoccerReviewDuration(player.minutesMs)}
            />
            <DetailValue label="Appearances" value={String(player.appearances)} />
          </div>
          {player.cleanSheet.status !== 'not_applicable' && (
            <p className={`mt-4 flex items-center gap-2 text-sm font-semibold ${
              player.cleanSheet.status === 'credited' ||
              player.cleanSheet.status === 'shared'
                ? 'text-emerald-700'
                : player.cleanSheet.status === 'unavailable'
                  ? 'text-amber-700'
                  : 'text-slate-600'
            }`}>
              <ShieldCheck size={17} />
              {player.cleanSheet.label}
            </p>
          )}
        </section>

        <StatSection
          title="Attack"
          rows={[
            ['Goals', player.stats.goals],
            ['Own goals', player.stats.ownGoals],
            ['Assists', assists],
            ['Primary assists', player.stats.primaryAssists],
            ['Secondary assists', player.stats.secondaryAssists],
            ['Shots', player.stats.shots],
            ['Shots on target', player.stats.shotsOnTarget],
            ['Shot accuracy', formatSoccerReviewRate(player.rates.shotAccuracy)],
            ['Goal conversion', formatSoccerReviewRate(player.rates.goalConversion)],
            ['Key passes', player.stats.keyPasses],
            ['Penalty goals / attempts', `${player.stats.penaltyGoals}/${player.stats.penaltyAttempts}`],
            [
              'Direct free-kick goals / attempts',
              `${player.stats.directFreeKickGoals}/${player.stats.directFreeKickAttempts}`,
            ],
          ]}
        />
        <StatSection
          title="Defense"
          rows={[
            ['Tackles won / attempted', `${player.stats.tacklesWon}/${player.stats.tacklesAttempted}`],
            ['Tackles lost', player.stats.tacklesLost],
            ['Tackle win rate', formatSoccerReviewRate(player.rates.tackleWin)],
            ['Interceptions', player.stats.interceptions],
            ['Clearances', player.stats.clearances],
            ['Recoveries', player.stats.recoveries],
            ['Blocked shots', player.stats.blockedShots],
          ]}
        />
        <StatSection
          title="Discipline"
          rows={[
            ['Fouls committed', player.stats.foulsCommitted],
            ['Fouls drawn', player.stats.foulsDrawn],
            ['Yellow cards', player.stats.yellowCards],
            ['Red cards', player.stats.redCards],
          ]}
        />
        <StatSection
          title="Goalkeeping"
          rows={[
            ['Saves', player.stats.goalkeeperSaves],
            ['Goals allowed', player.stats.goalkeeperGoalsAllowed],
            ['Shots on target faced', player.stats.goalkeeperShotsOnTargetFaced],
            ['Save percentage', formatSoccerReviewRate(player.rates.savePercentage)],
            ['Penalties faced', player.stats.goalkeeperPenaltiesFaced],
            ['Penalty saves', player.stats.goalkeeperPenaltySaves],
          ]}
        />

        <IntervalSection player={player} />
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
    <section className="border-b border-slate-200 px-4 py-4">
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

function IntervalSection({ player }: { player: SoccerPlayerReviewRow }) {
  if (player.lineupStatus === 'dnp') return null
  return (
    <section className="px-4 py-4">
      <h3 className="text-xs font-bold uppercase text-slate-500">On field</h3>
      <div className="mt-2 divide-y divide-slate-100">
        {player.onFieldIntervals.map((interval, index) => (
          <div
            key={`${interval.periodId}-${interval.startElapsedMs}-${index}`}
            className="flex min-h-11 items-center justify-between gap-4 py-2"
          >
            <div>
              <p className="text-sm font-semibold text-slate-800">{interval.periodLabel}</p>
              <p className="text-xs tabular-nums text-slate-500">
                {interval.startLabel} - {interval.endLabel}
              </p>
            </div>
            <p className="text-sm font-bold tabular-nums text-slate-700">
              {formatSoccerReviewDuration(interval.durationMs)}
            </p>
          </div>
        ))}
      </div>

      <h3 className="mt-5 text-xs font-bold uppercase text-slate-500">Roles</h3>
      <div className="mt-2 divide-y divide-slate-100">
        {player.roleIntervals.map((interval, index) => (
          <div
            key={`${interval.periodId}-${interval.startElapsedMs}-${interval.role.group}-${index}`}
            className="flex min-h-11 items-center justify-between gap-4 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold capitalize text-slate-800">
                {roleLabel(interval.role)}
              </p>
              <p className="text-xs tabular-nums text-slate-500">
                {interval.periodLabel} - {interval.startLabel} to {interval.endLabel}
              </p>
            </div>
            <p className="shrink-0 text-sm font-bold tabular-nums text-slate-700">
              {formatSoccerReviewDuration(interval.durationMs)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-slate-900">{value}</p>
    </div>
  )
}

function lineupLabel(status: SoccerPlayerReviewRow['lineupStatus']): string {
  if (status === 'starter') return 'Starter'
  if (status === 'substitute') return 'Substitute'
  return 'Did not play'
}

function roleLabel(role: SoccerPlayerReviewRow['role']): string {
  return role.label ?? role.group.replace(/_/g, ' ')
}

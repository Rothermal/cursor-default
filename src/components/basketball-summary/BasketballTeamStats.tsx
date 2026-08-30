import { useMemo } from 'react'
import {
  basketballTeamReview,
  basketballSummaryQualityReview,
  formatBasketballPercentage,
  formatBasketballRatio,
} from '../../lib/basketball/summaryDetails'
import type { BasketballSummarySource } from '../../lib/basketball/summarySource'

interface Props {
  source: BasketballSummarySource
}

export default function BasketballTeamStats({ source }: Props) {
  const review = useMemo(
    () => basketballTeamReview(source.state, source.inspection),
    [source.inspection, source.state]
  )
  const trackedName = source.state.gameInfo?.teamName ?? 'Tracked'
  const opponentName = source.state.gameInfo?.opponentName ?? 'Opponent'
  const tracked = review.totals.tracked
  const opponent = review.totals.opponent
  const quality = useMemo(() => basketballSummaryQualityReview(source.state), [source.state])

  return (
    <main className="mx-auto max-w-4xl px-4 pb-10 pt-5">
      <section aria-labelledby="team-box-score-heading">
        <h2 id="team-box-score-heading" className="text-lg font-bold text-slate-900">Team box score</h2>
        <ComparisonHeader tracked={trackedName} opponent={opponentName} />
        <StatGroup title="Shooting" rows={[
          ['Points', tracked.points, opponent.points],
          ['Field goals', madeAttempted(tracked.fieldGoalsMade, tracked.fieldGoalsAttempted), madeAttempted(opponent.fieldGoalsMade, opponent.fieldGoalsAttempted)],
          ['Field goal %', formatBasketballPercentage(tracked.fieldGoalPercentage), formatBasketballPercentage(opponent.fieldGoalPercentage)],
          ['2-pointers', madeAttempted(tracked.twoPointMade, tracked.twoPointAttempted), madeAttempted(opponent.twoPointMade, opponent.twoPointAttempted)],
          ['3-pointers', madeAttempted(tracked.threePointMade, tracked.threePointAttempted), madeAttempted(opponent.threePointMade, opponent.threePointAttempted)],
          ['Free throws', madeAttempted(tracked.freeThrowsMade, tracked.freeThrowsAttempted), madeAttempted(opponent.freeThrowsMade, opponent.freeThrowsAttempted)],
          ['Effective FG%', formatBasketballPercentage(tracked.effectiveFieldGoalPercentage), formatBasketballPercentage(opponent.effectiveFieldGoalPercentage)],
          ['True shooting%', formatBasketballPercentage(tracked.trueShootingPercentage), formatBasketballPercentage(opponent.trueShootingPercentage)],
        ]} />
        <StatGroup title="Rebounding and floor game" rows={[
          ['Offensive rebounds', tracked.offensiveRebounds, opponent.offensiveRebounds],
          ['Defensive rebounds', tracked.defensiveRebounds, opponent.defensiveRebounds],
          ['Total rebounds', tracked.rebounds, opponent.rebounds],
          ['Assists', tracked.assists, opponent.assists],
          ['Steals', tracked.steals, opponent.steals],
          ['Blocks', tracked.blocks, opponent.blocks],
          ['Turnovers', tracked.turnovers, opponent.turnovers],
          ['Personal fouls', tracked.personalFouls, opponent.personalFouls],
          [quality.clockModel === 'anchored' ? 'Derived player minutes' : 'Recorded manual minutes', tracked.manualMinutes, opponent.manualMinutes],
          ['Assist / turnover', formatBasketballRatio(tracked.assistToTurnoverRatio), formatBasketballRatio(opponent.assistToTurnoverRatio)],
        ]} />
      </section>

      {quality.clockModel === 'anchored' && (
        <section className="mt-8" aria-labelledby="lineup-combinations-heading">
          <h2 id="lineup-combinations-heading" className="text-lg font-bold text-slate-900">Five-player lineups</h2>
          <p className="mt-1 text-sm text-slate-600">
            Time is the intersection of authoritative lineup and running-clock intervals. Plus-minus appears only when scoring coverage is complete.
          </p>
          <div className="mt-3 grid gap-6 md:grid-cols-2">
            <LineupRows name={trackedName} rows={review.lineups.tracked} />
            <LineupRows name={opponentName} rows={review.lineups.opponent} />
          </div>
        </section>
      )}

      <section className="mt-8" aria-labelledby="period-context-heading">
        <h2 id="period-context-heading" className="text-lg font-bold text-slate-900">Period context</h2>
        <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {review.periods.map(period => (
            <div key={period.periodId} className="py-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold text-slate-800">{period.label}</h3>
                <p className="font-bold tabular-nums text-slate-900">
                  {period.score.tracked} - {period.score.opponent}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <PeriodValue value={period.fouls.tracked} />
                <span className="text-center text-slate-500">Team fouls</span>
                <PeriodValue value={period.fouls.opponent} align="right" />
                <PeriodValue value={bonusLabel(period.bonus.tracked)} />
                <span className="text-center text-slate-500">Bonus</span>
                <PeriodValue value={bonusLabel(period.bonus.opponent)} align="right" />
                <PeriodValue value={period.chargedTimeouts.tracked} />
                <span className="text-center text-slate-500">Timeouts</span>
                <PeriodValue value={period.chargedTimeouts.opponent} align="right" />
              </div>
            </div>
          ))}
        </div>
        {review.neutralTimeouts > 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Neutral official/media timeouts: <strong>{review.neutralTimeouts}</strong>
          </p>
        )}
      </section>

      <section className="mt-8" aria-labelledby="attribution-heading">
        <h2 id="attribution-heading" className="text-lg font-bold text-slate-900">Attribution</h2>
        <p className="mt-1 text-sm text-slate-600">
          Team totals are authoritative. These rows explain activity recorded to a team or unknown actor rather than a participant.
        </p>
        <ComparisonHeader tracked={trackedName} opponent={opponentName} />
        <StatGroup title="Team / unknown activity" rows={[
          ['Points', review.attribution.unattributed.tracked.points, review.attribution.unattributed.opponent.points],
          ['Rebounds', review.attribution.unattributed.tracked.rebounds, review.attribution.unattributed.opponent.rebounds],
          ['Assists', review.attribution.unattributed.tracked.assists, review.attribution.unattributed.opponent.assists],
          ['Steals', review.attribution.unattributed.tracked.steals, review.attribution.unattributed.opponent.steals],
          ['Blocks', review.attribution.unattributed.tracked.blocks, review.attribution.unattributed.opponent.blocks],
          ['Turnovers', review.attribution.unattributed.tracked.turnovers, review.attribution.unattributed.opponent.turnovers],
          ['Technicals', review.attribution.technicalFouls.tracked, review.attribution.technicalFouls.opponent],
        ]} />
      </section>

      {review.ejections.length > 0 && (
        <section className="mt-8" aria-labelledby="ejections-heading">
          <h2 id="ejections-heading" className="text-lg font-bold text-slate-900">Ejections</h2>
          <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
            {review.ejections.map(ejection => (
              <div key={ejection.eventId} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-slate-800">{ejection.subjectLabel}</p>
                  <span className="text-xs font-bold uppercase text-slate-500">
                    {ejection.teamSide === 'tracked' ? trackedName : opponentName}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{ejection.reason}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {ejection.source === 'automatic_threshold' ? 'Automatic threshold' : 'Official ruling'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

function LineupRows({
  name,
  rows,
}: {
  name: string
  rows: ReturnType<typeof basketballTeamReview>['lineups']['tracked']
}) {
  return (
    <div>
      <h3 className="border-b border-slate-300 pb-2 text-sm font-bold text-slate-800">{name}</h3>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">No complete five-player interval recorded.</p>
      ) : (
        <div className="divide-y divide-slate-200">
          {rows.map(row => (
            <div key={row.key} className="py-3">
              <p className="text-sm font-semibold text-slate-800">{row.participantLabels.join(', ')}</p>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="tabular-nums">{row.displayTime}</span>
                <strong className="tabular-nums text-slate-800">
                  {row.plusMinus === null ? '+/- unavailable' : row.plusMinus > 0 ? `+${row.plusMinus}` : row.plusMinus}
                </strong>
              </div>
              {!row.complete && row.plusMinusUnavailableReason && (
                <p className="mt-1 text-xs text-amber-700">{row.plusMinusUnavailableReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ComparisonHeader({ tracked, opponent }: { tracked: string; opponent: string }) {
  return (
    <div className="mt-3 grid grid-cols-[1fr_minmax(120px,1.5fr)_1fr] gap-3 border-b border-slate-300 pb-2 text-xs font-bold uppercase text-slate-500">
      <span className="truncate">{tracked}</span>
      <span className="text-center">Stat</span>
      <span className="truncate text-right">{opponent}</span>
    </div>
  )
}

function StatGroup({
  title,
  rows,
}: {
  title: string
  rows: Array<[string, string | number, string | number]>
}) {
  return (
    <div className="border-b border-slate-200 py-4">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      <div className="mt-2 space-y-2">
        {rows.map(([label, tracked, opponent]) => (
          <div key={label} className="grid grid-cols-[1fr_minmax(120px,1.5fr)_1fr] items-center gap-3 text-sm">
            <strong className="tabular-nums text-slate-900">{tracked}</strong>
            <span className="text-center text-slate-500">{label}</span>
            <strong className="text-right tabular-nums text-slate-900">{opponent}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function PeriodValue({ value, align = 'left' }: { value: string | number; align?: 'left' | 'right' }) {
  return (
    <strong className={`${align === 'right' ? 'text-right' : 'text-left'} tabular-nums text-slate-800`}>
      {value}
    </strong>
  )
}

function madeAttempted(made: number, attempted: number): string {
  return `${made}-${attempted}`
}

function bonusLabel(value: 'none' | 'one_and_one' | 'double_bonus'): string {
  if (value === 'one_and_one') return '1-and-1'
  if (value === 'double_bonus') return 'Double'
  return 'None'
}

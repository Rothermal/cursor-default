import type {
  BasketballComparisonSection,
  BasketballMatchLeader,
  BasketballPeriodScore,
  BasketballSummaryResult,
} from '../../lib/basketball/summary'
import type { BasketballSummarySource } from '../../lib/basketball/summarySource'
import {
  basketballRegulationPeriodCount,
  isBasketballMatchRulesV2,
} from '../../lib/basketball/rules'
import { getBasketballRulesProfile } from '../../lib/basketball/profiles'

interface Props {
  source: BasketballSummarySource
  result: BasketballSummaryResult
  periods: BasketballPeriodScore[]
  comparisons: BasketballComparisonSection[]
  leaders: BasketballMatchLeader[]
}

export default function BasketballOverview({
  source,
  result,
  periods,
  comparisons,
  leaders,
}: Props) {
  const gameInfo = source.state.gameInfo
  const basketballState = source.state.sportGameState?.sportId === 'basketball'
    ? source.state.sportGameState
    : null
  const rules = basketballState?.setup.rulesSnapshot
  const rulesSource = basketballState?.setup.rulesSource
  const profile = rules && isBasketballMatchRulesV2(rules) && rulesSource
    ? getBasketballRulesProfile(rulesSource.profileId, rulesSource.profileVersion)
    : null
  const regulationMinutes = rules?.regulationSegments[0]
    ? Math.round(rules.regulationSegments[0].durationMs / 60_000)
    : null
  return (
    <div className="space-y-8 py-5">
      <section aria-labelledby="basketball-result-heading">
        <SectionHeading id="basketball-result-heading" title="Result" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white">
            {result.resultLabel}
          </span>
          <span className="text-sm text-slate-600">{result.gameStateLabel}</span>
        </div>
        <dl className="mt-4 grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <Metadata label="Date" value={formatDate(gameInfo?.date)} />
          <Metadata label="Competition" value={gameInfo?.tournamentName || 'Not specified'} />
          <Metadata
            label="Format"
            value={rules
              ? `${basketballRegulationPeriodCount(rules)} periods${regulationMinutes ? `, ${regulationMinutes} min` : ''}`
              : 'Not available'}
          />
          <Metadata
            label="Rules profile"
            value={rules && isBasketballMatchRulesV2(rules)
              ? profile ? `${profile.label} v${profile.profileVersion}` : 'Custom'
              : rules ? 'Legacy configuration' : 'Not available'}
          />
          <Metadata
            label="Recorder"
            value={source.recorder?.displayName ?? 'This device'}
          />
          <Metadata
            label={source.publication ? 'Publication' : 'Cloud status'}
            value={source.publication
              ? `#${source.publication.publicationNumber} by ${source.publication.finalizedByDisplayName}`
              : source.state.cloudSync.gameStatus || 'Local only'}
          />
        </dl>
      </section>

      <section aria-labelledby="basketball-periods-heading">
        <SectionHeading id="basketball-periods-heading" title="Scoring by period" />
        <div className="mt-3 overflow-x-auto border-y border-slate-200">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Team</th>
                {periods.map(period => (
                  <th key={period.periodId} className="px-3 py-2 text-center">{period.label}</th>
                ))}
                <th className="px-3 py-2 text-center">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              <PeriodRow
                name={gameInfo?.teamName || 'Tracked team'}
                values={periods.map(period => period.tracked)}
                total={result.trackedScore}
              />
              <PeriodRow
                name={gameInfo?.opponentName || 'Opponent'}
                values={periods.map(period => period.opponent)}
                total={result.opponentScore}
              />
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="basketball-comparison-heading">
        <SectionHeading id="basketball-comparison-heading" title="Team comparison" />
        <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
          {comparisons.map(section => (
            <div key={section.id} className="py-4">
              <h3 className="text-sm font-bold text-slate-800">{section.label}</h3>
              <div className="mt-2 space-y-2">
                {section.rows.map(row => (
                  <div key={row.id} className="grid grid-cols-[1fr_minmax(110px,2fr)_1fr] items-center gap-3 text-sm">
                    <strong className="text-left tabular-nums text-slate-900">
                      {formatComparison(row.tracked, row.trackedAttempted)}
                    </strong>
                    <span className="text-center text-slate-500">{row.label}</span>
                    <strong className="text-right tabular-nums text-slate-900">
                      {formatComparison(row.opponent, row.opponentAttempted)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="basketball-leaders-heading">
        <SectionHeading id="basketball-leaders-heading" title="Tracked team leaders" />
        {leaders.length > 0 ? (
          <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
            {leaders.map(category => (
              <div key={category.id} className="bg-white p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">{category.label}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                  {category.leaders[0]?.value}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-700">
                  {category.leaders.map(leader => (
                    `${leader.number ? `#${leader.number} ` : ''}${leader.displayName}`
                  )).join(', ')}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No positive player leaders recorded.</p>
        )}
      </section>
    </div>
  )
}

function SectionHeading({ id, title }: { id: string; title: string }) {
  return <h2 id={id} className="text-lg font-bold text-slate-900">{title}</h2>
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  )
}

function PeriodRow({ name, values, total }: { name: string; values: number[]; total: number }) {
  return (
    <tr className="bg-white">
      <th className="px-3 py-3 text-left font-semibold text-slate-700">{name}</th>
      {values.map((value, index) => (
        <td key={index} className="px-3 py-3 text-center tabular-nums text-slate-700">{value}</td>
      ))}
      <td className="px-3 py-3 text-center font-bold tabular-nums text-slate-900">{total}</td>
    </tr>
  )
}

function formatComparison(value: number, attempted?: number): string {
  return attempted === undefined ? String(value) : `${value}-${attempted}`
}

function formatDate(value: string | undefined): string {
  if (!value) return 'Not specified'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(date)
}

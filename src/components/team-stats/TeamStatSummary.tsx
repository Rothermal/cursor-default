import type { Player, SportConfig, TeamStatsConfig } from '../../types'
import {
  deriveBonusEvents,
  foulCountForPeriod,
  hasTrackedTeamSide,
  maxTeamStatPeriodIndex,
  teamStatActionRows,
  valueForTeamAction,
} from '../../lib/teamStatsSummary'

export interface TeamStatSummaryProps {
  homeTeamPlayer: Player | undefined
  oppTeamPlayer: Player | undefined
  homeTeamName: string
  oppTeamName: string
  config: TeamStatsConfig
  sport: SportConfig
  foulBaseStatId: string
}

export default function TeamStatSummary({
  homeTeamPlayer,
  oppTeamPlayer,
  homeTeamName,
  oppTeamName,
  config,
  sport,
  foulBaseStatId,
}: TeamStatSummaryProps) {
  const homeStats = homeTeamPlayer?.stats ?? {}
  const oppStats = oppTeamPlayer?.stats ?? {}

  const homeTracked = hasTrackedTeamSide(homeStats, sport)
  const oppTracked = hasTrackedTeamSide(oppStats, sport)

  const periodCount = maxTeamStatPeriodIndex(homeStats, oppStats, foulBaseStatId)
  const periodLabels: string[] = []
  for (let p = 1; p <= periodCount; p++) {
    if (p <= config.periodsPerGame) {
      periodLabels.push(config.periodLabels[p - 1] ?? `Period ${p}`)
    } else {
      const otIndex = p - config.periodsPerGame
      const ot = config.overtimeLabel.trim() || 'OT'
      periodLabels.push(otIndex === 1 ? ot : `${ot} ${otIndex}`)
    }
  }

  const homeBonus = deriveBonusEvents(homeStats, config, foulBaseStatId, periodCount, homeTeamName)
  const oppBonus = deriveBonusEvents(oppStats, config, foulBaseStatId, periodCount, oppTeamName)
  const allBonus = [...homeBonus, ...oppBonus].sort((a, b) => {
    if (a.periodIndex !== b.periodIndex) return a.periodIndex - b.periodIndex
    return a.teamLabel.localeCompare(b.teamLabel)
  })

  const otherActions = teamStatActionRows(sport).filter(a => a.id !== foulBaseStatId)

  const bonusEventLabel = (e: (typeof allBonus)[0]): string => {
    if (e.type === 'one_and_one') {
      return `${e.teamLabel}: 1-and-1 in ${e.periodLabel} (${e.foulCount}${ordinal(e.foulCount)} foul)`
    }
    if (e.type === 'bonus_nba') {
      return `${e.teamLabel}: Bonus in ${e.periodLabel} (${e.foulCount}${ordinal(e.foulCount)} foul)`
    }
    return `${e.teamLabel}: Double bonus in ${e.periodLabel} (${e.foulCount}${ordinal(e.foulCount)} foul)`
  }

  const homeFoulTotal = Array.from({ length: periodCount }, (_, i) =>
    foulCountForPeriod(homeStats, foulBaseStatId, i + 1)
  ).reduce((a, b) => a + b, 0)
  const oppFoulTotal = Array.from({ length: periodCount }, (_, i) =>
    foulCountForPeriod(oppStats, foulBaseStatId, i + 1)
  ).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <div className="card border-slate-200">
        <h3 className="text-sm font-semibold text-slate-600 mb-3">Team fouls by period</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 pr-3 font-semibold text-slate-600">Period</th>
                <th className="text-center py-2 px-2 font-semibold text-slate-600">{homeTeamName}</th>
                <th className="text-center py-2 px-2 font-semibold text-slate-600">{oppTeamName}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: periodCount }, (_, i) => {
                const p = i + 1
                const h = foulCountForPeriod(homeStats, foulBaseStatId, p)
                const o = foulCountForPeriod(oppStats, foulBaseStatId, p)
                return (
                  <tr key={p} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-700">{periodLabels[i] ?? `Period ${p}`}</td>
                    <td className="text-center py-2 px-2 tabular-nums">
                      {homeTracked ? h : <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="text-center py-2 px-2 tabular-nums">
                      {oppTracked ? o : <span className="text-slate-400 italic">—</span>}
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="py-2 pr-3">Total</td>
                <td className="text-center py-2 px-2 tabular-nums">
                  {homeTracked ? (
                    homeFoulTotal
                  ) : (
                    <span className="text-slate-400 italic font-normal">Not tracked</span>
                  )}
                </td>
                <td className="text-center py-2 px-2 tabular-nums">
                  {oppTracked ? (
                    oppFoulTotal
                  ) : (
                    <span className="text-slate-400 italic font-normal">Not tracked</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {allBonus.length > 0 && (
        <div className="card border-slate-200">
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Bonus events</h3>
          <p className="text-xs text-slate-500 mb-2">Derived from foul counts and season rules.</p>
          <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
            {allBonus.map((e, idx) => (
              <li key={`${e.teamLabel}-${e.periodIndex}-${e.type}-${idx}`}>{bonusEventLabel(e)}</li>
            ))}
          </ul>
        </div>
      )}

      {otherActions.length > 0 && (
        <div className="card border-slate-200">
          <h3 className="text-sm font-semibold text-slate-600 mb-3">Timeouts / other</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 pr-3 font-semibold text-slate-600">Stat</th>
                  <th className="text-center py-2 px-2 font-semibold text-slate-600">{homeTeamName}</th>
                  <th className="text-center py-2 px-2 font-semibold text-slate-600">{oppTeamName}</th>
                </tr>
              </thead>
              <tbody>
                {otherActions.map(action => {
                  const hv = valueForTeamAction(homeStats, action)
                  const ov = valueForTeamAction(oppStats, action)
                  return (
                    <tr key={action.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3">{action.shortLabel}</td>
                      <td className="text-center py-2 px-2 tabular-nums">
                        {homeTracked ? (
                          hv
                        ) : (
                          <span className="text-slate-400 italic">Not tracked</span>
                        )}
                      </td>
                      <td className="text-center py-2 px-2 tabular-nums">
                        {oppTracked ? (
                          ov
                        ) : (
                          <span className="text-slate-400 italic">Not tracked</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

import type { ReactNode } from 'react'
import type { SportConfig, StatAction, StatCategory } from '../types'
import { computeCategoryTotal } from '../config/sports'

export type StatHighGameMap = Record<string, { game_id: string; value: number } | undefined>

interface Props {
  sport: SportConfig
  /** Career or season totals per stat_id */
  statsRecord: Record<string, number>
  gamesPlayed: number
  /** Per stat_id: best single-game (resolved); used for Best game row links */
  highGames: StatHighGameMap
  /** game_id -> player's resolved stat values for that game */
  resolvedByGame: Record<string, Record<string, number>>
  onOpenGame: (gameId: string) => void | Promise<void>
  loadingHigh?: boolean
  /** Shown under tables (e.g. career score + GP note) */
  footer?: ReactNode
  /** Intro line under title */
  description?: string
  title?: string
}

function bestGameCell(
  action: StatAction,
  missByMadeId: Record<string, StatAction>,
  highGames: StatHighGameMap,
  resolvedByGame: Record<string, Record<string, number>>,
  loadingHigh: boolean,
  onOpenGame: (gameId: string) => void | Promise<void>
): ReactNode {
  if (loadingHigh) return <span className="text-slate-400">…</span>

  const miss = missByMadeId[action.id]
  const row = highGames[action.id]
  if (!row || row.value <= 0) return <>—</>

  const gid = row.game_id
  const stats = resolvedByGame[gid] ?? {}

  const open = () => {
    void onOpenGame(gid)
  }

  if (miss) {
    const made = stats[action.id] ?? 0
    const missVal = stats[miss.id] ?? 0
    const att = made + missVal
    const label = att > 0 ? `${made}/${att}` : String(made)
    return (
      <button
        type="button"
        onClick={open}
        className="text-blue-600 hover:underline font-medium"
      >
        {label}
      </button>
    )
  }

  return (
    <button type="button" onClick={open} className="text-blue-600 hover:underline font-medium">
      {row.value}
    </button>
  )
}

export default function PlayerStatSummaryTables({
  sport,
  statsRecord,
  gamesPlayed,
  highGames,
  resolvedByGame,
  onOpenGame,
  loadingHigh = false,
  footer,
  description,
  title = 'Totals',
}: Props) {
  const gp = gamesPlayed

  const renderCategory = (category: StatCategory) => {
    const missByMadeId: Record<string, StatAction> = {}
    for (const action of category.actions) {
      if (action.madeStatId) missByMadeId[action.madeStatId] = action
    }
    const visibleActions = category.actions.filter(a => !a.madeStatId)

    const catTotal =
      category.showTotal
        ? category.actions.some(a => a.pointValue)
          ? category.actions.reduce(
              (sum, a) => sum + (statsRecord[a.id] || 0) * (a.pointValue || 0),
              0
            )
          : computeCategoryTotal(category, statsRecord)
        : null

    const cellTotals = (action: StatAction) => {
      const miss = missByMadeId[action.id]
      const made = statsRecord[action.id] || 0
      if (miss) {
        const missVal = statsRecord[miss.id] || 0
        const att = made + missVal
        const pct = att > 0 ? Math.round((made / att) * 100) : null
        return (
          <span>
            {made}/{att}
            {pct !== null && <span className="text-slate-400 ml-1">({pct}%)</span>}
          </span>
        )
      }
      return <>{made}</>
    }

    const cellPerGame = (action: StatAction) => {
      if (gp <= 0) return <>—</>
      const miss = missByMadeId[action.id]
      const made = statsRecord[action.id] || 0
      if (miss) {
        const missVal = statsRecord[miss.id] || 0
        const att = made + missVal
        return (
          <>
            {(made / gp).toFixed(1)}/{(att / gp).toFixed(1)}
            <span className="text-slate-400"> /g</span>
          </>
        )
      }
      return (
        <>
          {(made / gp).toFixed(1)}
          <span className="text-slate-400">/g</span>
        </>
      )
    }

    return (
      <div key={category.id} className="mb-6 last:mb-0">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
          {category.name}
          {category.showTotal && (
            <span className="text-slate-400 ml-2 normal-case">— {category.totalLabel}</span>
          )}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 pr-2 font-semibold text-slate-600 w-24" />
                {visibleActions.map(action => {
                  const hasMiss = !!missByMadeId[action.id]
                  return (
                    <th
                      key={action.id}
                      className="text-center py-2 px-2 font-semibold text-slate-600 min-w-[56px]"
                    >
                      {hasMiss ? `${action.shortLabel} M/A` : action.shortLabel}
                    </th>
                  )
                })}
                {category.showTotal && catTotal !== null && (
                  <th className="text-center py-2 px-2 font-bold text-slate-700 min-w-[52px]">TOT</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-2 pr-2 text-slate-500 text-xs font-medium whitespace-nowrap align-top">
                  Total
                </td>
                {visibleActions.map(action => (
                  <td key={action.id} className="text-center py-2 px-2 align-top">
                    {cellTotals(action)}
                  </td>
                ))}
                {category.showTotal && catTotal !== null && (
                  <td className="text-center py-2 px-2 font-semibold text-slate-800 align-top">{catTotal}</td>
                )}
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-1.5 pr-2 text-slate-400 text-xs font-medium whitespace-nowrap align-top">
                  Per game
                </td>
                {visibleActions.map(action => (
                  <td
                    key={`${action.id}-pg`}
                    className="text-center py-1.5 px-2 text-xs text-slate-500 align-top"
                  >
                    {cellPerGame(action)}
                  </td>
                ))}
                {category.showTotal && catTotal !== null && (
                  <td className="text-center py-1.5 px-2 text-xs text-slate-500 align-top">
                    {gp > 0 ? (
                      <>
                        {(catTotal / gp).toFixed(1)}
                        <span className="text-slate-400">/g</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
              </tr>
              <tr>
                <td className="py-1.5 pr-2 text-slate-400 text-xs font-medium whitespace-nowrap align-top">
                  Best game
                </td>
                {visibleActions.map(action => (
                  <td
                    key={`${action.id}-hi`}
                    className="text-center py-1.5 px-2 text-xs text-slate-500 align-top"
                  >
                    {bestGameCell(action, missByMadeId, highGames, resolvedByGame, loadingHigh, onOpenGame)}
                  </td>
                ))}
                {category.showTotal && (
                  <td className="text-center py-1.5 px-2 text-xs text-slate-400 align-top">—</td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <section className="card space-y-2">
      <h2 className="font-semibold text-slate-700">{title}</h2>
      {description && <p className="text-xs text-slate-500">{description}</p>}
      {sport.categories.map(cat => renderCategory(cat))}
      {footer && <div className="text-xs text-slate-500 pt-2 border-t border-slate-100">{footer}</div>}
    </section>
  )
}

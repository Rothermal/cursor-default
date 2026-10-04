import { AlertTriangle, ChevronLeft } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import BaseballBoxScore from '../components/baseball/BaseballBoxScore'
import BaseballPlayerDetailSheet from '../components/baseball/BaseballPlayerDetailSheet'
import { useGame } from '../context/GameContext'
import {
  BASEBALL_SUMMARY_TABS,
  baseballActiveEvents,
  baseballBoxScore,
  baseballPlayerGameDetail,
  baseballSummaryPath,
  baseballSummarySource,
  baseballSummaryView,
  parseBaseballSummaryTab,
  type BaseballSportGameState,
  type BaseballSummaryView,
  type BaseballTeamNames,
} from '../lib/baseball'

/**
 * Read-only Summary for a Baseball event game on this device (BSB-5). Corrections stay on the
 * tracker's Timeline; this page only reads a fresh replay of the stream.
 */
export default function BaseballSummary() {
  const { state } = useGame()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = parseBaseballSummaryTab(searchParams)
  const source = useMemo(() => baseballSummarySource(state), [state])
  const events = useMemo(() => (source.healthy ? baseballActiveEvents(state) : []), [source.healthy, state])
  const [playerId, setPlayerId] = useState<string | null>(null)

  const sport = source.sport
  const names: BaseballTeamNames = {
    tracked: state.gameInfo?.teamName || 'Tracked team',
    opponent: sport?.setup.opponentName || 'Opponent',
  }

  if (!sport) {
    return (
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-6">
        <p className="text-content">There is no Baseball game to summarize.</p>
        <Link to="/sport/baseball" className="btn-secondary inline-block">Back to Baseball</Link>
      </main>
    )
  }

  const view = source.healthy ? baseballSummaryView(sport, names, state.gameInfo?.date || null) : null
  const detail = playerId && source.healthy ? baseballPlayerGameDetail(sport, playerId) : null

  return (
    <main className="mx-auto max-w-2xl space-y-3 px-4 pb-6">
      <header className="flex min-h-14 items-center gap-2 border-b border-line">
        <Link to="/game" className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Back to the game" title="Back to the game">
          <ChevronLeft size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold text-content">{names.tracked} vs {names.opponent}</h1>
          <p className="text-xs text-content-muted">Summary</p>
        </div>
      </header>

      {!source.healthy ? (
        <section className="space-y-2 rounded-md border border-danger-line bg-danger p-4" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger-content" aria-hidden="true" />
            <div>
              <h2 className="font-bold text-danger-content">The Summary is unavailable</h2>
              <p className="mt-1 text-sm text-danger-content">
                This game's record has a problem, so scores and totals are hidden until it is fixed on the tracker.
              </p>
              {source.diagnostic && <p className="mt-2 text-sm font-semibold text-danger-content">{source.diagnostic}</p>}
            </div>
          </div>
          <Link to="/game" className="btn-secondary inline-block">Open the tracker</Link>
        </section>
      ) : (
        <>
          <div role="tablist" aria-label="Summary views" className="grid grid-cols-2 gap-1 rounded-md border border-line p-1">
            {BASEBALL_SUMMARY_TABS.map(entry => (
              <button
                key={entry.tab}
                type="button"
                role="tab"
                aria-selected={tab === entry.tab}
                className={`min-h-10 rounded text-sm font-semibold ${tab === entry.tab ? 'bg-accent text-accent-content' : 'text-content'}`}
                onClick={() => navigate(baseballSummaryPath(entry.tab), { replace: true })}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {view && tab === 'overview' && <Overview view={view} sport={sport} />}
          {tab === 'box' && sport.projection.status !== 'pregame' && (
            <BaseballBoxScore box={baseballBoxScore(sport, events)} names={names} onOpenPlayer={setPlayerId} />
          )}
          {tab === 'box' && sport.projection.status === 'pregame' && (
            <p className="text-sm text-content-muted">The box score fills in once the game starts.</p>
          )}
        </>
      )}

      {detail && (
        <PlayerDialog onClose={() => setPlayerId(null)}>
          <BaseballPlayerDetailSheet detail={detail} onClose={() => setPlayerId(null)} />
        </PlayerDialog>
      )}
    </main>
  )
}

function Overview({ view, sport }: { view: BaseballSummaryView; sport: BaseballSportGameState }) {
  return (
    <div className="space-y-3">
      <section className="space-y-1 rounded-md border border-line bg-surface p-3" aria-label="Result">
        <p className="text-xs font-semibold uppercase text-content-muted">{view.statusLabel}</p>
        <h2 className="text-xl font-bold text-content">{view.scoreLine}</h2>
        {view.outcomeForTracked && <p className="text-sm text-content-muted">{view.outcomeForTracked}</p>}
        {view.note && <p className="text-sm text-content-muted">{view.note}</p>}
      </section>

      {view.warningCount > 0 && (
        <section className="flex items-start gap-2 rounded-md border border-warning-line bg-warning p-3 text-sm text-warning-content">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">
              {view.warningCount === 1 ? '1 play needs a lineup check' : `${view.warningCount} plays need a lineup check`}
            </p>
            {view.firstWarning && <p>{view.firstWarning}</p>}
            <Link to="/game?tab=timeline" className="font-semibold underline">Check on the Timeline</Link>
          </div>
        </section>
      )}

      {sport.projection.status === 'pregame' ? (
        <p className="text-sm text-content-muted">The game has not started yet.</p>
      ) : (
        <section className="rounded-md border border-line bg-surface p-3" aria-label="Line score">
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-max text-center text-sm tabular-nums">
              <caption className="sr-only">Line score</caption>
              <thead>
                <tr className="text-xs text-content-muted">
                  <th scope="col" className="pr-2 text-left font-semibold">Team</th>
                  {view.innings.map(inning => (
                    <th key={inning} scope="col" className="w-6 px-1 font-semibold">{inning}</th>
                  ))}
                  <th scope="col" className="w-7 px-1 font-bold text-content">R</th>
                  <th scope="col" className="w-7 px-1 font-semibold">H</th>
                  <th scope="col" className="w-7 px-1 font-semibold">E</th>
                </tr>
              </thead>
              <tbody>
                {[view.away, view.home].map(row => (
                  <tr key={row.side} className="border-t border-line text-content">
                    <th scope="row" className="max-w-[8rem] truncate py-1 pr-2 text-left font-semibold">{row.name}</th>
                    {row.cells.map((cell, index) => (
                      <td key={index} className="px-1">{cell}</td>
                    ))}
                    <td className="px-1 font-bold">{row.runs}</td>
                    <td className="px-1">{row.hits}</td>
                    <td className="px-1">{row.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-content-muted">
            LOB: {view.away.name} {view.away.leftOnBase}, {view.home.name} {view.home.leftOnBase}
          </p>
        </section>
      )}

      <section className="rounded-md border border-line bg-surface p-3" aria-label="Game facts">
        <h2 className="mb-2 font-bold text-content">Game</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {view.facts.map(fact => (
            <div key={fact.label} className="contents">
              <dt className="text-content-muted">{fact.label}</dt>
              <dd className="text-content">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

function PlayerDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.5] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onClick={event => event.stopPropagation()}
      >
        <span id={titleId} className="sr-only">Player details</span>
        {children}
      </div>
    </div>
  )
}

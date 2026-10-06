import { AlertTriangle, ChevronLeft, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import {
  HOCKEY_SUMMARY_TABS,
  hockeyDecisionSummary,
  hockeyGoalieRows,
  hockeyPenaltyRows,
  hockeyPeriodRows,
  hockeyScoringRows,
  hockeySkaterRows,
  hockeySummaryBackPath,
  hockeySummaryNames,
  hockeySummaryPath,
  hockeySummaryResult,
  hockeyTeamStatRows,
  parseHockeySummaryQuery,
  type HockeyNames,
} from '../lib/hockey/summary'
import {
  loadHockeySummarySource,
  type HockeySummarySource,
} from '../lib/hockey/summarySource'
import type { HockeyGameLines } from '../lib/hockey/gameLines'
import type { HockeySportGameState } from '../lib/hockey/types'

const AUTHORITY_LABELS: Record<HockeySummarySource['kind'], string> = {
  local: 'This device',
  cloud_primary: 'Cloud, not final',
  canonical: 'Final result',
}

/**
 * Summary for a Hockey event game (HKY-6A1): this device's game, or a cloud game by
 * `gameId`. It reads a fresh replay of the selected source and never loads a cloud game
 * into the tracker; corrections stay on the tracker's Timeline.
 */
export default function HockeySummary() {
  const { state } = useGame()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const query = useMemo(() => parseHockeySummaryQuery(searchParams), [searchParams])
  const [source, setSource] = useState<HockeySummarySource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const requestId = useRef(0)
  // A cloud source does not follow the local game; a local one re-reads every change.
  const localState = query.gameId ? null : state

  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    loadHockeySummarySource(localState ?? state, query.gameId)
      .then(next => {
        if (id !== requestId.current) return
        setSource(next)
        setError(null)
      })
      .catch(caught => {
        if (id !== requestId.current) return
        setSource(null)
        setError(caught instanceof Error ? caught.message : 'The Hockey summary could not load.')
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
    // `state` is read only for a local source, which `localState` already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localState, query.gameId, reload])

  const back = hockeySummaryBackPath(query)
  const sport = source?.sport ?? null
  const names: HockeyNames = sport
    ? hockeySummaryNames(source!.state, sport.setup)
    : { tracked: 'Tracked', opponent: 'Opponent' }
  const remote = Boolean(source && source.kind !== 'local')

  return (
    <main className="mx-auto max-w-2xl space-y-3 px-4 pb-6">
      <header className="flex min-h-14 items-center gap-2 border-b border-line">
        <Link to={back} className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Back" title="Back">
          <ChevronLeft size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold text-content">{names.tracked} vs {names.opponent}</h1>
          <p className="text-xs text-content-muted">
            Summary{source ? ` · ${AUTHORITY_LABELS[source.kind]}` : ''}
            {source?.recorderName && remote ? ` · recorded by ${source.recorderName}` : ''}
          </p>
        </div>
        {query.gameId && (
          <button
            type="button"
            onClick={() => setReload(value => value + 1)}
            disabled={loading}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line text-content-muted disabled:text-content-disabled"
            aria-label="Refresh summary"
            title="Refresh summary"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </header>

      {loading && !source && !error && <p className="text-sm text-content-muted animate-pulse">Loading the summary...</p>}

      {error && (
        <section className="space-y-2 rounded-md border border-danger-line bg-danger p-4" role="alert">
          <h2 className="font-bold text-danger-content">The Summary could not load</h2>
          <p className="text-sm text-danger-content">{error}</p>
          <div className="flex flex-wrap gap-2">
            {query.gameId && (
              <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>Try again</button>
            )}
            <Link to={back} className="btn-secondary inline-block">Back</Link>
          </div>
        </section>
      )}

      {source && !sport && (
        <p className="text-content">There is no Hockey game to summarize.</p>
      )}

      {source && sport && !source.healthy && (
        <section className="space-y-2 rounded-md border border-danger-line bg-danger p-4" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger-content" aria-hidden="true" />
            <div>
              <h2 className="font-bold text-danger-content">Totals are unavailable</h2>
              <p className="mt-1 text-sm text-danger-content">
                This game's record has a problem, so scores and totals are hidden until it is fixed on the tracker.
              </p>
              {source.diagnostic && <p className="mt-2 text-sm font-semibold text-danger-content">{source.diagnostic}</p>}
            </div>
          </div>
          {source.kind === 'local' && <Link to="/game?tab=timeline" className="btn-secondary inline-block">Open the Timeline</Link>}
        </section>
      )}

      {source && sport && source.healthy && source.lines && (
        <>
          <div role="tablist" aria-label="Summary views" className="grid grid-cols-3 gap-1 rounded-md border border-line p-1">
            {HOCKEY_SUMMARY_TABS.map(entry => (
              <button
                key={entry.tab}
                type="button"
                role="tab"
                aria-selected={query.tab === entry.tab}
                className={`min-h-11 min-w-0 rounded px-1 text-sm font-semibold ${query.tab === entry.tab ? 'bg-accent text-accent-content' : 'text-content'}`}
                onClick={() => navigate(hockeySummaryPath({ ...query, tab: entry.tab }), { replace: true })}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {query.tab === 'overview' && <Overview source={source} sport={sport} lines={source.lines} names={names} />}
          {query.tab === 'skaters' && <Skaters sport={sport} lines={source.lines} />}
          {query.tab === 'goalies' && <Goalies source={source} sport={sport} lines={source.lines} names={names} />}
          {source.kind === 'local' && (
            <p className="text-xs text-content-muted">
              To change a play, <Link to="/game?tab=timeline" className="font-semibold underline">correct it on the Timeline</Link>.
            </p>
          )}
        </>
      )}
    </main>
  )
}

function Overview({ source, sport, lines, names }: {
  source: HockeySummarySource
  sport: HockeySportGameState
  lines: HockeyGameLines
  names: HockeyNames
}) {
  const result = hockeySummaryResult(sport.projection)
  const periods = hockeyPeriodRows(sport.projection)
  const events = source.inspection.activeEvents
  const scoring = hockeyScoringRows(sport, lines, names)
  const penalties = hockeyPenaltyRows(sport, names)
  const decision = hockeyDecisionSummary(sport, lines)
  const shootout = sport.projection.shootout

  return (
    <div className="space-y-3">
      <section className="space-y-1 rounded-md border border-line bg-surface p-3" aria-label="Result">
        <p className="text-xs font-semibold uppercase text-content-muted">{result.label}</p>
        <h2 className="text-2xl font-bold tabular-nums text-content">
          {names.tracked} {result.scoreText} {names.opponent}
        </h2>
        {result.reason && <p className="text-sm text-content-muted">Reason: {result.reason}</p>}
        {shootout && (
          <p className="text-sm text-content-muted">
            Shootout {shootout.goals.tracked}-{shootout.goals.opponent}
            {shootout.winner ? `, won by ${names[shootout.winner]}` : ''}
          </p>
        )}
        {decision && <p className="text-sm text-content">Goalie of record: {decision.goalie} ({decision.decision})</p>}
      </section>

      {sport.projection.status === 'pregame' ? (
        <p className="text-sm text-content-muted">The game has not started yet.</p>
      ) : (
        <>
          <section className="rounded-md border border-line bg-surface p-3" aria-label="Goals and shots by period">
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-max text-center text-sm tabular-nums">
                <caption className="sr-only">Goals and shots on goal by period</caption>
                <thead>
                  <tr className="text-xs text-content-muted">
                    <th scope="col" className="pr-2 text-left font-semibold">Team</th>
                    {periods.periods.map(period => (
                      <th key={period.periodId} scope="col" className="px-1 font-semibold">{shortPeriod(period.label)}</th>
                    ))}
                    <th scope="col" className="px-1 font-bold text-content">T</th>
                  </tr>
                </thead>
                <tbody>
                  {(['tracked', 'opponent'] as const).map(side => (
                    <tr key={side} className="border-t border-line text-content">
                      <th scope="row" className="max-w-[8rem] truncate py-1 pr-2 text-left font-semibold">{names[side]}</th>
                      {periods.periods.map(period => (
                        <td key={period.periodId} className="px-1">
                          {period.goals[side]}
                          <span className="block text-xs text-content-muted">{period.shotsOnGoal[side]} SOG</span>
                        </td>
                      ))}
                      <td className="px-1 font-bold">
                        {periods.total.goals[side]}
                        <span className="block text-xs font-normal text-content-muted">{periods.total.shotsOnGoal[side]} SOG</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-md border border-line bg-surface p-3" aria-label="Team stats">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Team stats</caption>
              <thead>
                <tr className="text-xs text-content-muted">
                  <th scope="col" className="w-1/3 text-left font-semibold">{names.tracked}</th>
                  <th scope="col" className="w-1/3 font-semibold"><span className="sr-only">Stat</span></th>
                  <th scope="col" className="w-1/3 text-right font-semibold">{names.opponent}</th>
                </tr>
              </thead>
              <tbody>
                {hockeyTeamStatRows(sport, events).map(row => (
                  <tr key={row.label} className="border-t border-line text-content">
                    <td className="py-1 text-left">{row.values.tracked}</td>
                    <th scope="row" className="py-1 text-center text-xs font-semibold text-content-muted">{row.label}</th>
                    <td className="py-1 text-right">{row.values.opponent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sport.projection.clock && (
              <p className="mt-2 text-xs text-content-muted">Power-play chances need a game clock; this game shows power-play goals.</p>
            )}
          </section>

          <section className="rounded-md border border-line bg-surface p-3" aria-label="Scoring summary">
            <h2 className="mb-2 font-bold text-content">Scoring</h2>
            {scoring.length === 0 ? (
              <p className="text-sm text-content-muted">No goals.</p>
            ) : (
              <ol className="space-y-2">
                {scoring.map(goal => (
                  <li key={goal.eventId} className="border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-content">
                      <span className="text-xs text-content-muted">{goal.period}{goal.time ? ` ${goal.time}` : ''}</span>
                      <span className="font-semibold">{goal.scorer}</span>
                      <span className="text-xs text-content-muted">{goal.team}</span>
                      {goal.strength && goal.strength !== 'EV' && <Tag>{goal.strength}</Tag>}
                      {goal.gameWinning && <Tag>GWG</Tag>}
                      <span className="ml-auto font-semibold tabular-nums">{goal.score}</span>
                    </p>
                    <p className="text-xs text-content-muted">
                      {goal.assists.length > 0 ? `Assists: ${goal.assists.join(', ')}` : 'Unassisted'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {lines.coverage.gameWinningGoal === 'unattributed' && (
              <p className="mt-2 text-xs text-content-muted">
                Game-winning goal unattributed: the deciding goal has no recorded scorer, or the score was adjusted.
              </p>
            )}
          </section>

          <section className="rounded-md border border-line bg-surface p-3" aria-label="Penalty summary">
            <h2 className="mb-2 font-bold text-content">Penalties</h2>
            {penalties.length === 0 ? (
              <p className="text-sm text-content-muted">No penalties.</p>
            ) : (
              <ol className="space-y-2">
                {penalties.map(penalty => (
                  <li key={penalty.eventId} className="border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-content">
                      <span className="text-xs text-content-muted">{penalty.period}{penalty.time ? ` ${penalty.time}` : ''}</span>
                      <span className="font-semibold">{penalty.player}</span>
                      <span className="text-xs text-content-muted">{penalty.team}</span>
                    </p>
                    <p className="text-xs text-content-muted">
                      {penalty.penalty}{penalty.servedBy ? `, served by ${penalty.servedBy}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Skaters({ sport, lines }: { sport: HockeySportGameState; lines: HockeyGameLines }) {
  const rows = hockeySkaterRows(sport, lines)
  const [open, setOpen] = useState<string | null>(null)
  if (rows.length === 0) return <p className="text-sm text-content-muted">No skaters were dressed.</p>
  const headers = ['G', 'A', 'PTS', '+/-', 'PIM', 'SOG', 'SAT', 'FO', 'FO%', 'HIT', 'BLK', 'TK', 'GV']
  return (
    <section className="space-y-2 rounded-md border border-line bg-surface p-3" aria-label="Skaters">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-max text-center text-sm tabular-nums">
          <caption className="sr-only">Skater stats</caption>
          <thead>
            <tr className="text-xs text-content-muted">
              <th scope="col" className="sticky left-0 bg-surface pr-2 text-left font-semibold">Skater</th>
              {headers.map(header => <th key={header} scope="col" className="px-1.5 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.participantId} className="border-t border-line text-content">
                <th scope="row" className="sticky left-0 max-w-[9rem] bg-surface py-1 pr-2 text-left font-semibold">
                  <button
                    type="button"
                    className="block max-w-full truncate text-left underline-offset-2 hover:underline"
                    aria-expanded={open === row.participantId}
                    onClick={() => setOpen(current => (current === row.participantId ? null : row.participantId))}
                  >
                    {row.name}
                  </button>
                  {row.removed && <span className="block text-xs font-normal text-danger-content">Removed from game</span>}
                </th>
                <td className="px-1.5">{row.goals}</td>
                <td className="px-1.5">{row.assists}</td>
                <td className="px-1.5 font-semibold">{row.points}</td>
                <td className="px-1.5">{signed(row.plusMinus)}</td>
                <td className="px-1.5">{row.pim}</td>
                <td className="px-1.5">{row.shotsOnGoal}</td>
                <td className="px-1.5">{row.shotAttempts}</td>
                <td className="px-1.5">{row.faceoffs}</td>
                <td className="px-1.5">{row.faceoffPercent ?? '–'}</td>
                <td className="px-1.5">{row.hits}</td>
                <td className="px-1.5">{row.blocks}</td>
                <td className="px-1.5">{row.takeaways}</td>
                <td className="px-1.5">{row.giveaways}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (() => {
        const row = rows.find(entry => entry.participantId === open)
        if (!row) return null
        return (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-line p-2 text-sm sm:grid-cols-4" aria-label={`${row.name} details`}>
            <Detail label="PP points" value={row.powerPlayPoints} />
            <Detail label="SH points" value={row.shortHandedPoints} />
            <Detail label="Game-winning goals" value={row.gameWinningGoals} />
            <Detail label="Empty-net goals" value={row.emptyNetGoals} />
          </dl>
        )
      })()}
      {lines.coverage.plusMinus === 'partial' && (
        <p className="text-xs text-content-muted">
          Plus/minus leaves out {lines.coverage.plusMinusSkippedGoals === 1 ? '1 goal' : `${lines.coverage.plusMinusSkippedGoals} goals`} without
          a complete on-ice set or strength.
        </p>
      )}
      <p className="text-xs text-content-muted">Tap a name for power-play, short-handed, game-winning and empty-net goals.</p>
    </section>
  )
}

function Goalies({ source, sport, lines, names }: {
  source: HockeySummarySource
  sport: HockeySportGameState
  lines: HockeyGameLines
  names: HockeyNames
}) {
  const rows = hockeyGoalieRows(sport, lines, source.inspection.activeEvents)
  const anchored = Boolean(lines.goalieTime)
  return (
    <div className="space-y-3">
      {(['tracked', 'opponent'] as const).map(side => {
        const sideRows = rows.filter(row => row.side === side)
        if (sideRows.length === 0) return null
        return (
          <section key={side} className="space-y-2 rounded-md border border-line bg-surface p-3" aria-label={`${names[side]} goalies`}>
            <h2 className="font-bold text-content">{names[side]}</h2>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-max text-center text-sm tabular-nums">
                <caption className="sr-only">{names[side]} goalie stats</caption>
                <thead>
                  <tr className="text-xs text-content-muted">
                    <th scope="col" className="pr-2 text-left font-semibold">Goalie</th>
                    <th scope="col" className="px-1.5 font-semibold">SA</th>
                    <th scope="col" className="px-1.5 font-semibold">SV</th>
                    <th scope="col" className="px-1.5 font-semibold">GA</th>
                    <th scope="col" className="px-1.5 font-semibold">SV%</th>
                    <th scope="col" className="px-1.5 font-semibold">TOI</th>
                    <th scope="col" className="px-1.5 font-semibold">GAA</th>
                    {side === 'tracked' && <th scope="col" className="px-1.5 font-semibold">DEC</th>}
                  </tr>
                </thead>
                <tbody>
                  {sideRows.map(row => (
                    <tr key={row.id} className="border-t border-line text-content">
                      <th scope="row" className="max-w-[9rem] truncate py-1 pr-2 text-left font-semibold">
                        {row.name}
                        {!row.played && <span className="block text-xs font-normal text-content-muted">Did not play</span>}
                      </th>
                      <td className="px-1.5">{row.shotsAgainst}</td>
                      <td className="px-1.5">{row.saves}</td>
                      <td className="px-1.5">{row.goalsAgainst}</td>
                      <td className="px-1.5">{row.savePercent ?? '–'}</td>
                      <td className="px-1.5">
                        {row.timeInNet === null ? 'Not recorded' : `${row.timeInNet}${row.timeInNetComplete ? '' : '*'}`}
                      </td>
                      <td className="px-1.5">{row.goalsAgainstAverage ?? '–'}</td>
                      {side === 'tracked' && <td className="px-1.5 font-semibold">{row.decision ?? '–'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {side === 'opponent' && (
              <p className="text-xs text-content-muted">From {names.tracked}'s shots, as team context.</p>
            )}
          </section>
        )
      })}
      <p className="text-xs text-content-muted">
        {anchored
          ? `${rows.some(row => row.timeInNet !== null && !row.timeInNetComplete) ? '* Incomplete: the game is not finished, the clock is running, or a goalie change is out of order. ' : ''}GAA is goals against per full regulation game.`
          : 'This game has no clock, so time in net and GAA are not recorded.'}
      </p>
    </div>
  )
}

function Tag({ children }: { children: string }) {
  return <span className="rounded border border-line px-1 text-xs font-semibold text-content-muted">{children}</span>
}

function Detail({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-content-muted">{label}</dt>
      <dd className="font-semibold text-content">{value}</dd>
    </div>
  )
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function shortPeriod(label: string): string {
  if (label.startsWith('Period ')) return label.slice('Period '.length)
  if (label === 'Overtime') return 'OT'
  return label.replace('Overtime ', 'OT')
}

import { AlertTriangle, ChevronLeft } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import BaseballBoxScore from '../components/baseball/BaseballBoxScore'
import BaseballDecisionsSheet from '../components/baseball/BaseballDecisionsSheet'
import BaseballPitchCounts from '../components/baseball/BaseballPitchCounts'
import BaseballPitchPlot from '../components/baseball/BaseballPitchPlot'
import BaseballPlayDetailSheet from '../components/baseball/BaseballPlayDetailSheet'
import BaseballPlayerDetailSheet from '../components/baseball/BaseballPlayerDetailSheet'
import BaseballSprayChart from '../components/baseball/BaseballSprayChart'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import {
  BASEBALL_PITCH_DEFAULT_FILTER,
  BASEBALL_SPRAY_DEFAULT_FILTER,
  BASEBALL_SUMMARY_TABS,
  baseballActiveEvents,
  baseballBoxScore,
  baseballDecisionIssues,
  baseballDecisionLabels,
  baseballDecisionsView,
  baseballPitchCounts,
  baseballPitchLog,
  baseballPitchPlot,
  baseballPlayDetail,
  baseballPlayerGameDetail,
  baseballSprayChart,
  baseballSummaryPlays,
  baseballSummaryPath,
  baseballSummarySource,
  baseballSummaryView,
  parseBaseballSummaryTab,
  saveBaseballPitcherDecisions,
  type BaseballDecisionsView,
  type BaseballPitcherDecisions,
  type BaseballSportGameState,
  type BaseballPitchFilter,
  type BaseballSprayFilter,
  type BaseballSummaryPlays,
  type BaseballSummaryView,
  type BaseballTeamNames,
} from '../lib/baseball'
import { createBaseballUuid } from '../lib/baseball/id'

/**
 * Summary for a Baseball event game on this device (BSB-5). It reads a fresh replay of the
 * stream; corrections stay on the tracker's Timeline. The one thing recorded here is pitcher
 * decisions (BSB-5D), set once the game is final.
 */
export default function BaseballSummary() {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = parseBaseballSummaryTab(searchParams)
  const source = useMemo(() => baseballSummarySource(state), [state])
  const events = useMemo(() => (source.healthy ? baseballActiveEvents(state) : []), [source.healthy, state])
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [playId, setPlayId] = useState<string | null>(null)
  const [scoringOnly, setScoringOnly] = useState(false)
  const [sprayFilter, setSprayFilter] = useState<BaseballSprayFilter>(BASEBALL_SPRAY_DEFAULT_FILTER)
  const [pitchFilter, setPitchFilter] = useState<BaseballPitchFilter>(BASEBALL_PITCH_DEFAULT_FILTER)
  const [decisionDraft, setDecisionDraft] = useState<BaseballPitcherDecisions | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)

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
  const play = playId && source.healthy ? baseballPlayDetail(state, playId, names) : null
  const started = sport.projection.status !== 'pregame'
  const decisions = source.healthy && started ? baseballDecisionsView(sport, events) : null
  // A reopened game closes the sheet: its decisions belonged to the earlier ending.
  const draft = decisions?.canSet ? decisionDraft : null

  const openDecisions = () => {
    if (!decisions) return
    setDecisionError(null)
    setDecisionDraft(structuredClone(decisions.current?.decisions ?? decisions.suggestion.decisions))
  }
  const saveDecisions = () => {
    if (!draft) return
    const result = saveBaseballPitcherDecisions(state, draft, {
      recorderUserId: user?.id ?? null,
      occurredAt: new Date().toISOString(),
      captureCommandId: createBaseballUuid(),
    })
    if (!result.ok) {
      setDecisionError(result.message)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    setDecisionDraft(null)
  }

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
          <div role="tablist" aria-label="Summary views" className="grid grid-cols-5 gap-1 rounded-md border border-line p-1">
            {BASEBALL_SUMMARY_TABS.map(entry => (
              <button
                key={entry.tab}
                type="button"
                role="tab"
                aria-selected={tab === entry.tab}
                className={`min-h-11 min-w-0 rounded px-0.5 text-[13px] font-semibold leading-tight ${tab === entry.tab ? 'bg-accent text-accent-content' : 'text-content'}`}
                onClick={() => navigate(baseballSummaryPath(entry.tab), { replace: true })}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {view && tab === 'overview' && <Overview view={view} sport={sport} decisions={decisions} names={names} onSetDecisions={openDecisions} />}
          {tab === 'box' && started && (
            <BaseballBoxScore
              box={baseballBoxScore(sport, events)}
              names={names}
              decisions={decisions?.current?.decisions ?? null}
              onOpenPlayer={setPlayerId}
            />
          )}
          {tab === 'plays' && started && (
            <Plays
              plays={baseballSummaryPlays(sport, events, names, { scoringOnly })}
              scoringOnly={scoringOnly}
              onScoringOnly={setScoringOnly}
              onOpenPlay={setPlayId}
            />
          )}
          {tab === 'spray' && started && (
            <BaseballSprayChart
              chart={baseballSprayChart(sport, events, sprayFilter)}
              filter={sprayFilter}
              names={names}
              onFilter={setSprayFilter}
              onOpenPlay={setPlayId}
            />
          )}
          {tab === 'pitches' && started && (() => {
            const log = baseballPitchLog(sport, events)
            return (
              <div className="space-y-4">
                <BaseballPitchPlot
                  plot={baseballPitchPlot(sport, log, pitchFilter)}
                  filter={pitchFilter}
                  names={names}
                  onFilter={setPitchFilter}
                  onOpenPlay={setPlayId}
                />
                <BaseballPitchCounts counts={baseballPitchCounts(sport, events, log)} names={names} />
              </div>
            )
          })()}
          {tab !== 'overview' && !started && (
            <p className="text-sm text-content-muted">This view fills in once the game starts.</p>
          )}
        </>
      )}

      {draft && decisions && (
        <SheetDialog label="Pitcher decisions" onClose={() => setDecisionDraft(null)}>
          <BaseballDecisionsSheet
            sport={sport}
            view={decisions}
            names={names}
            draft={draft}
            issues={baseballDecisionIssues(sport, events, draft)}
            error={decisionError}
            onChange={next => {
              setDecisionError(null)
              setDecisionDraft(next)
            }}
            onUseSuggestion={() => setDecisionDraft(structuredClone(decisions.suggestion.decisions))}
            onCancel={() => setDecisionDraft(null)}
            onSave={saveDecisions}
          />
        </SheetDialog>
      )}
      {detail && (
        <SheetDialog label="Player details" onClose={() => setPlayerId(null)}>
          <BaseballPlayerDetailSheet detail={detail} onClose={() => setPlayerId(null)} />
        </SheetDialog>
      )}
      {play && (
        <SheetDialog label="Play details" onClose={() => setPlayId(null)}>
          <BaseballPlayDetailSheet
            detail={play}
            onClose={() => setPlayId(null)}
            note={<>To change this play, <Link to="/game?tab=timeline" className="font-semibold underline">correct it on the Timeline</Link>.</>}
          />
        </SheetDialog>
      )}
    </main>
  )
}

function Overview({ view, sport, decisions, names, onSetDecisions }: {
  view: BaseballSummaryView
  sport: BaseballSportGameState
  decisions: BaseballDecisionsView | null
  names: BaseballTeamNames
  onSetDecisions: () => void
}) {
  return (
    <div className="space-y-3">
      <section className="space-y-1 rounded-md border border-line bg-surface p-3" aria-label="Result">
        <p className="text-xs font-semibold uppercase text-content-muted">{view.statusLabel}</p>
        <h2 className="text-xl font-bold text-content">{view.scoreLine}</h2>
        {view.outcomeForTracked && <p className="text-sm text-content-muted">{view.outcomeForTracked}</p>}
        {view.note && <p className="text-sm text-content-muted">{view.note}</p>}
      </section>

      {decisions?.canSet && <Decisions sport={sport} decisions={decisions} names={names} onSet={onSetDecisions} />}

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

function Decisions({ sport, decisions, names, onSet }: {
  sport: BaseballSportGameState
  decisions: BaseballDecisionsView
  names: BaseballTeamNames
  onSet: () => void
}) {
  const labels = decisions.current ? baseballDecisionLabels(sport, decisions.current.decisions) : null
  const sides = labels ? (['tracked', 'opponent'] as const).filter(side => labels[side].length > 0) : []
  return (
    <section className="space-y-2 rounded-md border border-line bg-surface p-3" aria-label="Pitcher decisions">
      <h2 className="font-bold text-content">Pitcher decisions</h2>
      {!labels ? (
        <p className="text-sm text-content-muted">Not set yet.</p>
      ) : sides.length === 0 ? (
        <p className="text-sm text-content-muted">Set with no decisions.</p>
      ) : (
        <dl className="space-y-1 text-sm">
          {sides.map(side => (
            <div key={side}>
              <dt className="truncate font-semibold text-content">{names[side]}</dt>
              <dd className="text-content">{labels[side].join(' · ')}</dd>
            </div>
          ))}
        </dl>
      )}
      {decisions.issues.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning-line bg-warning p-2 text-sm text-warning-content">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Check decisions</p>
            <p>A later correction changed the game, and these decisions no longer fit it: {decisions.issues[0]}</p>
          </div>
        </div>
      )}
      <button type="button" className="btn-secondary w-full" onClick={onSet}>
        {decisions.current ? 'Change decisions' : 'Set decisions'}
      </button>
    </section>
  )
}

function Plays({ plays, scoringOnly, onScoringOnly, onOpenPlay }: {
  plays: BaseballSummaryPlays
  scoringOnly: boolean
  onScoringOnly: (value: boolean) => void
  onOpenPlay: (playId: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <label className="flex min-h-11 items-center gap-2 text-sm text-content">
          <input type="checkbox" className="h-5 w-5" checked={scoringOnly} onChange={event => onScoringOnly(event.target.checked)} />
          Scoring plays only ({plays.scoringPlays})
        </label>
        <Link to="/game?tab=timeline" className="text-sm font-semibold text-content underline">Correct on the Timeline</Link>
      </div>
      {plays.halves.length === 0 && (
        <p className="text-sm text-content-muted">{scoringOnly ? 'No runs have scored yet.' : 'No plays yet.'}</p>
      )}
      {plays.halves.map(half => (
        <section key={half.key} className="rounded-md border border-line bg-surface" aria-label={`${half.label}, ${half.battingSide === 'tracked' ? 'we bat' : 'they bat'}`}>
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line px-3 py-2">
            <h2 className="font-bold text-content">{half.label}</h2>
            {half.line && <p className="text-xs tabular-nums text-content-muted">{half.line}</p>}
          </header>
          <ol className="divide-y divide-line">
            {half.rows.map(row => (
              <li key={row.id}>
                {row.kind === 'play' ? (
                  <button type="button" className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left text-sm text-content" onClick={() => onOpenPlay(row.id)}>
                    <PlayText row={row} />
                  </button>
                ) : (
                  <div className="flex min-h-11 items-start gap-2 px-3 py-2 text-sm text-content-muted">
                    <PlayText row={row} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function PlayText({ row }: { row: BaseballSummaryPlays['halves'][number]['rows'][number] }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block">{row.label}</span>
        {row.pitches.length > 0 && (
          <span className="block text-xs text-content-muted">Before: {row.pitches.join(', ')}</span>
        )}
        {row.recordedBatter && (
          <span className="block text-xs text-content-muted">Recorded for {row.recordedBatter}</span>
        )}
        {row.warning && (
          <span className="mt-0.5 flex items-start gap-1 text-xs text-warning-content">
            <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
            {row.warning}
          </span>
        )}
      </span>
      {row.runs > 0 && (
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-content">
          {row.runs} {row.runs === 1 ? 'run' : 'runs'}
        </span>
      )}
    </>
  )
}

function SheetDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
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
        <span id={titleId} className="sr-only">{label}</span>
        {children}
      </div>
    </div>
  )
}

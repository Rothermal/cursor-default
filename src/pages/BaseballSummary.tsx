import { AlertTriangle, ChevronLeft, RefreshCw } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
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
  parseBaseballSummaryQuery,
  baseballSummaryBackPath,
  saveBaseballPitcherDecisions,
  type BaseballDecisionsView,
  type BaseballPitcherDecisions,
  type BaseballSportGameState,
  type BaseballPitchFilter,
  type BaseballSprayFilter,
  type BaseballSummaryPlays,
  type BaseballSummaryView,
  type BaseballSummarySource,
  type BaseballSummaryQuery,
  type BaseballTeamNames,
} from '../lib/baseball'
import { createBaseballUuid } from '../lib/baseball/id'
import { isFinalBaseballCloudGame } from '../lib/baseball/cloudPolicy'
import { loadBaseballSummarySource } from '../lib/baseball/summarySource'
import { isCurrentAuthUser } from '../lib/authIdentity'
import { isGameEventEnvelope } from '../lib/gameEvents/envelope'
import { baseballActiveEvents, baseballDecisionEpochId } from '../lib/baseball/units'

/**
 * Summary for a Baseball event game on this device (BSB-5). It reads a fresh replay of the
 * stream; corrections stay on the tracker's Timeline. The one thing recorded here is pitcher
 * decisions (BSB-5D), set once the game is final.
 */
export default function BaseballSummary() {
  const { state, dispatch, activeLocalGameId } = useGame()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const query = useMemo(() => parseBaseballSummaryQuery(searchParams), [searchParams])
  const userId = user?.id ?? null
  const accountRef = useRef({ userId, active: true, blockedState: null as typeof state | null })
  if (accountRef.current.userId !== userId) {
    accountRef.current.active = false
    accountRef.current = { userId, active: true, blockedState: state }
  }
  const account = accountRef.current
  useEffect(() => {
    account.active = true
    return () => { account.active = false }
  }, [account])
  const remoteId = query.gameId || (isFinalBaseballCloudGame(state) ? state.cloudSync.gameId : null)
  const [reload, setReload] = useState(0)
  const requestKey = `${remoteId ?? 'local'}:${searchParams.toString()}:${reload}`
  const requestRef = useRef({ account, key: requestKey })
  if (requestRef.current.account !== account || requestRef.current.key !== requestKey) requestRef.current = { account, key: requestKey }
  const request = requestRef.current
  const [settled, setSettled] = useState<{ request: typeof request; source: BaseballSummarySource | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!remoteId) return
    let active = true
    const assertCurrent = () => {
      if (!active || requestRef.current !== request || !account.active || accountRef.current !== account || !isCurrentAuthUser(userId)) throw new Error('The Summary request is no longer current.')
      if (!userId) throw new Error('Sign in to review a cloud Baseball game.')
    }
    void loadBaseballSummarySource(state, remoteId, undefined, assertCurrent).then(source => {
      assertCurrent()
      setSettled({ request, source, error: null })
    }).catch(caught => {
      if (active && requestRef.current === request && account.active && accountRef.current === account && isCurrentAuthUser(userId)) {
        setSettled({ request, source: null, error: caught instanceof Error ? caught.message : 'The Baseball Summary could not load.' })
      }
    })
    return () => { active = false }
    // Remote review never follows changes to the unrelated active local game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, remoteId, request, userId])

  const localSource = useMemo(() => remoteId ? null : baseballSummarySource(state), [state, remoteId])
  const owned = !state.eventStream?.events.some(event => isGameEventEnvelope(event) && event.recorderUserId !== null && event.recorderUserId !== userId)
  const localAllowed = account.blockedState !== state && owned && isCurrentAuthUser(userId)
  const currentResult = account.active && isCurrentAuthUser(userId) && settled?.request === request ? settled : null
  const source = remoteId ? currentResult?.source ?? null : localAllowed ? localSource : null
  const endingEpoch = source?.healthy ? baseballDecisionEpochId(source.inspection.activeEvents) : null
  const error = remoteId ? currentResult?.error ?? null : !localAllowed ? 'Open this account\'s Baseball game to view its Summary.' : null
  const back = baseballSummaryBackPath(query)
  const latest = useRef({ state, source, activeLocalGameId, request })
  latest.current = { state, source, activeLocalGameId, request }
  const revision = useRef({ source, key: requestKey, value: 0 })
  if (revision.current.source !== source || revision.current.key !== requestKey) {
    revision.current = { source, key: requestKey, value: revision.current.value + 1 }
  }
  const saveDecisions = (draft: BaseballPitcherDecisions): string | null => {
    const current = latest.current
    if (!account.active || accountRef.current !== account || !isCurrentAuthUser(userId) || !localAllowed ||
      current.state !== state || current.source !== source || current.activeLocalGameId !== activeLocalGameId ||
      current.request !== request || source?.kind !== 'local' || isFinalBaseballCloudGame(current.state) ||
      !endingEpoch || baseballDecisionEpochId(baseballActiveEvents(current.state)) !== endingEpoch) {
      return 'This local game changed. Open its decisions again.'
    }
    const result = saveBaseballPitcherDecisions(current.state, draft, {
      recorderUserId: userId, occurredAt: new Date().toISOString(), captureCommandId: createBaseballUuid(),
    })
    if (!result.ok) return result.message
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    return null
  }
  return (
    <>
      {!source && <main className="mx-auto max-w-2xl space-y-3 px-4 py-6">
        {error ? <section role="alert" className="space-y-2 text-danger-content"><h1 className="font-bold">The Summary could not load</h1><p>{error}</p></section>
          : <p className="text-sm text-content-muted animate-pulse">Loading the summary...</p>}
        {error && remoteId && <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>Try again</button>}
        <Link to={back} className="btn-secondary inline-block">Back</Link>
      </main>}
      {source && <BaseballSummaryContent key={revision.current.value} source={source} query={query} back={back}
        correctable={source.kind === 'local' && localAllowed && !isFinalBaseballCloudGame(state)}
        onSaveDecisions={saveDecisions} onRefresh={remoteId ? () => setReload(value => value + 1) : null} />}
    </>
  )
}

/** Every view and dialog reads this one source; a new source/query remounts review state. */
export function BaseballSummaryContent({ source, query, back, correctable, onSaveDecisions, onRefresh }: {
  source: BaseballSummarySource
  query: BaseballSummaryQuery
  back: string
  correctable: boolean
  onSaveDecisions: (draft: BaseballPitcherDecisions) => string | null
  onRefresh: (() => void) | null
}) {
  const navigate = useNavigate()
  const tab = query.tab
  const state = source.state
  const events = source.healthy ? source.inspection.activeEvents : []
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
        {source.diagnostic && <p role="alert" className="text-danger-content">{source.diagnostic}</p>}
        {onRefresh && <button type="button" className="btn-secondary" onClick={onRefresh}>Try again</button>}
        <Link to={back} className="btn-secondary inline-block">Back</Link>
      </main>
    )
  }

  const view = source.healthy ? baseballSummaryView(sport, names, state.gameInfo?.date || null) : null
  const detail = playerId && source.healthy ? baseballPlayerGameDetail(sport, playerId) : null
  const play = playId && source.healthy ? baseballPlayDetail(state, playId, names) : null
  const started = sport.projection.status !== 'pregame'
  const decisions = source.healthy && started ? baseballDecisionsView(sport, events) : null
  // A reopened game closes the sheet: its decisions belonged to the earlier ending.
  const editable = correctable && source.kind === 'local' && !isFinalBaseballCloudGame(state)
  const draft = decisions?.canSet && editable ? decisionDraft : null

  const openDecisions = () => {
    if (!decisions || !editable) return
    setDecisionError(null)
    setDecisionDraft(structuredClone(decisions.current?.decisions ?? decisions.suggestion.decisions))
  }
  const saveDecisions = () => {
    if (!draft) return
    const error = onSaveDecisions(draft)
    if (error) {
      setDecisionError(error)
      return
    }
    setDecisionDraft(null)
  }

  return (
    <main className="mx-auto max-w-2xl space-y-3 px-4 pb-6">
      <header className="flex min-h-14 items-center gap-2 border-b border-line">
        <Link to={back} className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Back" title="Back">
          <ChevronLeft size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold text-content">{names.tracked} vs {names.opponent}</h1>
          <p className="text-xs text-content-muted">Summary · {source.kind === 'local' ? 'This device' : source.kind === 'canonical' ? 'Final result' : 'Cloud, not final'}{source.recorderName && source.kind !== 'local' ? ` · recorded by ${source.recorderName}` : ''}</p>
        </div>
        {onRefresh && <button type="button" onClick={onRefresh} className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Refresh summary" title="Refresh summary"><RefreshCw size={18} /></button>}
      </header>

      {!source.healthy ? (
        <section className="space-y-2 rounded-md border border-danger-line bg-danger p-4" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger-content" aria-hidden="true" />
            <div>
              <h2 className="font-bold text-danger-content">The Summary is unavailable</h2>
              <p className="mt-1 text-sm text-danger-content">
                This game's record has a problem, so scores and totals are hidden.
              </p>
              {source.diagnostic && <p className="mt-2 text-sm font-semibold text-danger-content">{source.diagnostic}</p>}
            </div>
          </div>
          {editable && <Link to="/game" className="btn-secondary inline-block">Open the tracker</Link>}
          {onRefresh && <button type="button" className="btn-secondary" onClick={onRefresh}>Try again</button>}
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
                onClick={() => navigate(baseballSummaryPath({ ...query, tab: entry.tab }), { replace: true })}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {view && tab === 'overview' && <Overview view={view} sport={sport} decisions={decisions} names={names} correctable={editable} onSetDecisions={editable ? openDecisions : null} />}
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
              correctable={editable}
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
            note={editable ? <>To change this play, <Link to="/game?tab=timeline" className="font-semibold underline">correct it on the Timeline</Link>.</> : 'This recording is read-only.'}
          />
        </SheetDialog>
      )}
    </main>
  )
}

function Overview({ view, sport, decisions, names, correctable, onSetDecisions }: {
  view: BaseballSummaryView
  sport: BaseballSportGameState
  decisions: BaseballDecisionsView | null
  names: BaseballTeamNames
  correctable: boolean
  onSetDecisions: (() => void) | null
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
            {correctable && <Link to="/game?tab=timeline" className="font-semibold underline">Check on the Timeline</Link>}
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
  onSet: (() => void) | null
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
      {onSet && <button type="button" className="btn-secondary w-full" onClick={onSet}>
        {decisions.current ? 'Change decisions' : 'Set decisions'}
      </button>}
    </section>
  )
}

function Plays({ plays, scoringOnly, onScoringOnly, onOpenPlay, correctable }: {
  plays: BaseballSummaryPlays
  scoringOnly: boolean
  onScoringOnly: (value: boolean) => void
  onOpenPlay: (playId: string) => void
  correctable: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <label className="flex min-h-11 items-center gap-2 text-sm text-content">
          <input type="checkbox" className="h-5 w-5" checked={scoringOnly} onChange={event => onScoringOnly(event.target.checked)} />
          Scoring plays only ({plays.scoringPlays})
        </label>
        {correctable && <Link to="/game?tab=timeline" className="text-sm font-semibold text-content underline">Correct on the Timeline</Link>}
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

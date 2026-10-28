import { Activity, ChevronLeft, Crosshair, Menu, Pause, Play, Shield, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import HockeyFaceoffControl from '../components/hockey/HockeyFaceoffControl'
import HockeyGoalieDialog, { type HockeyGoalieChange } from '../components/hockey/HockeyGoalieDialog'
import HockeyPenaltyBox from '../components/hockey/HockeyPenaltyBox'
import HockeyPenaltyDialog from '../components/hockey/HockeyPenaltyDialog'
import HockeyPlayDialog, { type HockeyPlayDraft, type HockeyTeamPlayInput } from '../components/hockey/HockeyPlayDialog'
import HockeyRecentEvents from '../components/hockey/HockeyRecentEvents'
import HockeyRink from '../components/hockey/HockeyRink'
import HockeyTimeline, { HockeyTimelineDetail } from '../components/hockey/HockeyTimeline'
import HockeyTimelineEditor, { type HockeyTimelineAction } from '../components/hockey/HockeyTimelineEditor'
import HockeyShootoutPanel from '../components/hockey/HockeyShootoutPanel'
import HockeyShotDialog, { type HockeyShotDraft } from '../components/hockey/HockeyShotDialog'
import TrackerSideSelector from '../components/TrackerSideSelector'
import TrackerDialog from '../components/TrackerDialog'
import TrackerFocusButton from '../components/TrackerFocusButton'
import TrackerSurfaceTools from '../components/TrackerSurfaceTools'
import { useTrackerFocus } from '../hooks/useTrackerFocus'
import { useTeamRole } from '../hooks/useTeamRole'
import { canTrackGames } from '../lib/teamPermissions'
import { HockeyCloudMenuSection, HockeyCloudSyncAlerts } from '../components/hockey/HockeyCloudSync'
import { HOCKEY_FINAL_CLOUD_GAME_MESSAGE, isFinalHockeyCloudGame } from '../lib/hockey/cloudPolicy'
import { hockeySummaryPath } from '../lib/hockey/summary'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import {
  adjustHockeyScore,
  canRestoreHockeyCapture,
  changeHockeyGoalie,
  endHockeyMatch,
  endHockeyPeriod,
  finishDecidedHockeyGame,
  formatHockeyClock,
  formatHockeyFinalScore,
  HOCKEY_RESULT_LABELS,
  formatHockeyPeriod,
  formatHockeyStrength,
  hockeyActivePeriod,
  hockeyClockDisplay,
  hockeyGoalStrengthFor,
  hockeyOnIceLimits,
  hockeyPenaltyBoxNow,
  hockeyRecentEvents,
  hockeyTimeline,
  hockeySpecialTeams,
  hockeySportState,
  interruptHockeyMatch,
  lastHockeyPeriod,
  nearestHockeyFaceoffDot,
  pauseHockeyClock,
  recentHockeyOpponentLabels,
  recordHockeyFaceoff,
  recordHockeyPenalties,
  recordHockeyPlay,
  recordHockeyShootoutAttempt,
  recordHockeyShot,
  recordHockeyTeamEvent,
  recordHockeyTimeout,
  releaseHockeyPenalty,
  reopenHockeyMatch,
  restoreHockeyCapture,
  setHockeyClock,
  setHockeyRinkFlipped,
  startHockeyClock,
  startHockeyGame,
  startHockeyShootout,
  startNextHockeyPeriod,
  undoHockeyCapture,
  HOCKEY_FACEOFF_DOTS,
  type HockeyCommandContext,
  type HockeyCommandResult,
  type HockeyFaceoffDotId,
  type HockeyPlayKind,
  type HockeySide,
  type HockeyTimelineRow,
  type HockeySportGameState,
  type RecordHockeyPenaltiesInput,
  type RecordHockeyPlayInput,
  type RecordHockeyShotInput,
} from '../lib/hockey'
import type { GameEvent, GameEventLocation } from '../lib/gameEvents/types'
import { hockeyTrackerMarkerIds, hockeyTrackerMarkers, type HockeyTrackerFilters } from '../lib/hockey/trackerView'

/**
 * The Hockey event tracker (HKY-2E). Top to bottom: the scoreboard strip with the clock and
 * compact strength context, named recording side, rink, quick row, filters and Recent Events; period and match controls live in the Game
 * menu. Existing event games always open here, whatever the release stage.
 */
export default function HockeyGameTracker() {
  const { state } = useGame()
  const sport = hockeySportState(state)
  if (!sport) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          This Hockey game could not be read. It is kept unchanged on this device.
        </p>
        <Link to="/sport/hockey" className="btn-secondary inline-block">Back to Hockey</Link>
      </main>
    )
  }
  return <HockeyTracker sport={sport} />
}

function HockeyTracker({ sport }: { sport: HockeySportGameState }) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date().toISOString())
  const [shotDraft, setShotDraft] = useState<HockeyShotDraft | null>(null)
  const [goalieOpen, setGoalieOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [penaltyDetailsOpen, setPenaltyDetailsOpen] = useState(false)
  const [captureSide, setCaptureSide] = useState<HockeySide>('tracked')
  const [markerFilters, setMarkerFilters] = useState<HockeyTrackerFilters>({ family: 'all', side: 'all', scope: 'match' })
  const [tap, setTap] = useState<GameEventLocation | null>(null)
  const [faceoffDot, setFaceoffDot] = useState<HockeyFaceoffDotId | null>(null)
  const [playDraft, setPlayDraft] = useState<HockeyPlayDraft | null>(null)
  const [penaltyOpen, setPenaltyOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // The Summary links corrections here with `?tab=timeline`.
  const [tab, setTab] = useState<'track' | 'timeline'>(() => (searchParams.get('tab') === 'timeline' ? 'timeline' : 'track'))
  const [correction, setCorrection] = useState<{ row: HockeyTimelineRow | null; action: HockeyTimelineAction } | null>(null)
  const projection = sport.projection
  const running = projection.clock?.running === true

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 250)
    return () => window.clearInterval(timer)
  }, [running])

  const context = (): HockeyCommandContext => ({
    recorderUserId: user?.id ?? null,
    occurredAt: new Date().toISOString(),
  })

  const apply = (result: HockeyCommandResult) => {
    if (!result.ok) {
      setError(result.message)
      return false
    }
    setError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    return true
  }

  /** Tries without a reason first, then asks when the rules require one. */
  const withReason = (run: (reason: string | null) => HockeyCommandResult, question: string) => {
    const first = run(null)
    if (first.ok || first.code !== 'reason_required') return apply(first)
    const reason = window.prompt(question)
    if (reason) apply(run(reason))
  }

  const askReason = (question: string, run: (reason: string) => HockeyCommandResult) => {
    const reason = window.prompt(question)
    if (reason) apply(run(reason))
  }

  const setClock = () => {
    const rules = sport.setup.rulesSnapshot
    const active = hockeyActivePeriod(projection)
    if (!active || !rules.clock) return
    const shown = window.prompt('Clock time as shown (m:ss)')
    const match = shown ? /^(\d{1,2}):([0-5]\d)$/.exec(shown.trim()) : null
    if (!shown) return
    if (!match) {
      setError('Enter the clock as minutes and seconds, like 12:30.')
      return
    }
    const shownMs = (Number(match[1]) * 60 + Number(match[2])) * 1000
    const elapsedMs = rules.clock.display === 'count_down' ? active.durationMs - shownMs : shownMs
    askReason('Why is the clock changing?', reason => setHockeyClock(state, { elapsedMs, reason }, context()))
  }

  const reading = hockeyClockDisplay(sport, now)
  const penaltyBox = hockeyPenaltyBoxNow(sport, now)
  const period = hockeyActivePeriod(projection) ?? lastHockeyPeriod(projection)
  const direction = projection.trackedAttackingDirection ?? sport.setup.firstPeriodAttackingDirection
  const flipped = sport.capturePreferences.rinkFlipped
  const inProgress = projection.status === 'in_progress'
  // A finalized cloud game is server authority; the guard in the commands refuses edits too.
  const cloudFinal = isFinalHockeyCloudGame(state)
  const active = Boolean(projection.activePeriodId)
  const trackedLabel = state.gameInfo?.teamName || 'Tracked'
  const opponentLabel = state.gameInfo?.opponentName || 'Opponent'
  const sideLabel = (side: HockeySide) => (side === 'tracked' ? trackedLabel : opponentLabel)
  const streamEvents = (state.eventStream?.events ?? []) as GameEvent[]
  const markers = hockeyTrackerMarkers(sport.setup, streamEvents, period?.id ?? null, markerFilters)
  const penaltyCount = projection.clock
    ? penaltyBox.box.tracked.length + penaltyBox.box.opponent.length
    : projection.penalties.filter(record => record.periodId === projection.activePeriodId && record.durationMs > 0).length
  const canCapture = inProgress && active && !projection.decidedInPeriodId
  const teamAccess = useTeamRole(state.cloudSync.teamId)
  const writable = canCapture && !cloudFinal &&
    (!state.cloudSync.teamId || (!teamAccess.loading && canTrackGames(teamAccess.role)))
  const rootRef = useRef<HTMLDivElement>(null)
  const { focused, expand, exit } = useTrackerFocus(writable && tab === 'track' && !projection.shootout, rootRef)
  const [reviewIds, setReviewIds] = useState<string[] | null>(null)
  const timeline = useMemo(() => hockeyTimeline(state, { tracked: trackedLabel, opponent: opponentLabel }), [state, trackedLabel, opponentLabel])
  const reviewRows = timeline.rows.filter(row => row.events.some(event => reviewIds?.includes(event.id)))
  const correctionBlocked = state.cloudSync.teamId && (teamAccess.loading || !canTrackGames(teamAccess.role))
    ? 'Recording access is required to correct this game.'
    : cloudFinal ? HOCKEY_FINAL_CLOUD_GAME_MESSAGE
    : projection.status === 'suspended' || projection.status === 'abandoned'
      ? 'Reopen the game from the Game menu to correct it.' : null
  const recentLabels = recentHockeyOpponentLabels(streamEvents)
  const specialTeams = hockeySpecialTeams(sport.setup, projection, penaltyBox.box)
  const powerPlayLine = (side: HockeySide) => {
    const chances = specialTeams.powerPlayOpportunities?.[side] ?? 0
    const goals = specialTeams.powerPlayGoals[side]
    if (chances === 0 && goals === 0) return null
    return specialTeams.powerPlayOpportunities ? `PP ${goals}/${chances}` : `PPG ${goals}`
  }

  const recordShot = (input: RecordHockeyShotInput): string | null => {
    const result = recordHockeyShot(state, input, context())
    if (!result.ok) return result.message
    apply(result)
    setShotDraft(null)
    return null
  }

  const recordGoalieChange = (change: HockeyGoalieChange): string | null => {
    const result = changeHockeyGoalie(state, change, context())
    if (!result.ok) return result.message
    apply(result)
    setGoalieOpen(false)
    return null
  }

  const recordFaceoff = (input: { winner: HockeySide; takerParticipantId: string | null; opponentTakerLabel: string | null }) => {
    if (!faceoffDot) return null
    const result = recordHockeyFaceoff(state, { dotId: faceoffDot, ...input }, context())
    if (!result.ok) return result.message
    apply(result)
    setFaceoffDot(null)
    return null
  }

  const recordPlay = (input: RecordHockeyPlayInput): string | null => {
    const result = recordHockeyPlay(state, input, context())
    if (!result.ok) return result.message
    apply(result)
    setPlayDraft(null)
    return null
  }

  const recordTeamPlay = (input: HockeyTeamPlayInput): string | null => {
    const result = input.kind === 'timeout'
      ? recordHockeyTimeout(state, { side: input.side }, context())
      : recordHockeyTeamEvent(state, { kind: input.kind, side: input.side, location: input.location }, context())
    if (!result.ok) return result.message
    apply(result)
    setPlayDraft(null)
    return null
  }

  const recordPenalties = (input: RecordHockeyPenaltiesInput): string | null => {
    const result = recordHockeyPenalties(state, input, context())
    if (!result.ok) return result.message
    apply(result)
    setPenaltyOpen(false)
    return null
  }

  /** The tap chooser (HKY-2C): Shot opens the shot dialog here; Faceoff snaps to a dot. */
  const choose = (choice: 'shot' | 'faceoff' | HockeyPlayKind) => {
    if (!tap) return
    const point = { x: tap.x, y: tap.y }
    setTap(null)
    if (choice === 'shot') setShotDraft({ side: captureSide, location: point })
    else if (choice === 'faceoff') setFaceoffDot(nearestHockeyFaceoffDot(point).id)
    else setPlayDraft({ kind: choice, location: point, side: captureSide })
  }

  /** Runs a menu action and closes the menu. */
  const fromMenu = (action: () => void) => () => {
    setMenuOpen(false)
    action()
  }

  const endPeriod = () => withReason(
    reason => endHockeyPeriod(state, { reason }, context()),
    'Why is the period ending before the clock runs out?'
  )

  return (
    <div ref={rootRef} className={focused ? 'tracker-focus flex flex-col bg-canvas text-content' : undefined}>
    <main className={`tracker-main ${focused ? 'flex min-h-0 flex-1 flex-col' : 'max-w-2xl mx-auto px-4 pb-6 space-y-3'}`}>
      <section
        className={focused ? 'tracker-heading relative shrink-0 border-b border-line bg-surface py-1' : 'sticky top-0 z-20 -mx-4 space-y-2 border-b border-line bg-canvas/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur'}
        aria-label="Scoreboard"
      >
        {focused && <div className="absolute left-1 top-1"><TrackerFocusButton focused surface="rink" onExpand={() => void expand()} onExit={exit} /></div>}
        <div className={focused ? 'hidden' : 'flex min-h-10 items-center gap-2'}>
          <Link to="/sport/hockey" className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Back to Hockey" title="Back to Hockey">
            <ChevronLeft size={22} />
          </Link>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1" role="group" aria-label="Tracker view">
            {(['track', 'timeline'] as const).map(id => (
              <button key={id} type="button" aria-pressed={tab === id}
                className={`min-h-11 min-w-0 rounded px-1 text-xs font-semibold ${tab === id ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
                onClick={() => setTab(id)}>{id === 'track' ? 'Track' : 'Timeline'}</button>
            ))}
          </div>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-line-strong px-3 text-sm font-semibold text-content"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
          >
            <Menu size={18} aria-hidden="true" /> Game
          </button>
          {writable && tab === 'track' && !projection.shootout && <TrackerFocusButton focused={false} surface="rink" onExpand={() => void expand()} onExit={exit} />}
        </div>
        <div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 ${focused ? 'px-11' : ''}`} aria-live="polite">
          {(['tracked', 'opponent'] as const).map(side => (
            <div key={side} className={`min-w-0 text-center ${side === 'opponent' ? 'order-3' : ''}`}>
              <p className="truncate text-xs font-bold uppercase text-content-muted">{sideLabel(side)}</p>
              <p className={`${focused ? 'text-lg leading-none' : 'text-3xl'} font-bold tabular-nums`} aria-label={`${sideLabel(side)} score`}>{projection.score[side]}</p>
              <p className={`${focused ? 'hidden' : ''} text-xs text-content-muted`}>
                {[
                  `${projection.shotsOnGoal[side]} SOG`,
                  powerPlayLine(side),
                  projection.timeouts[side] > 0 ? `TO ${projection.timeouts[side]}` : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          ))}
          <div className={`order-2 flex items-center gap-1 ${focused ? 'flex-wrap justify-center' : 'flex-col'}`}>
            <p className="text-center text-[11px] font-semibold text-content-muted">
              {period ? formatHockeyPeriod(period) : 'Not started'}
              {period && !active && inProgress ? ' ended' : ''}
              {!inProgress && projection.status !== 'pregame' ? ` · ${projection.status.replace('_', ' ')}` : ''}
            </p>
            {reading ? (
              <>
                <p
                  className={`${focused ? 'text-lg' : 'text-2xl'} font-bold tabular-nums ${reading.expired ? 'text-danger-content' : ''}`}
                  aria-label="Game clock"
                >
                  {formatHockeyClock(reading.displayMs)}
                </p>
                {inProgress && active && (
                  <button
                    type="button"
                    className={`inline-flex ${focused ? 'h-8 w-8 justify-center' : 'h-10 px-3'} items-center gap-1 rounded-md text-sm font-semibold ${running ? 'bg-control text-content' : 'bg-accent text-accent-content'}`}
                    aria-label={running ? 'Pause' : 'Start'} title={running ? 'Pause' : 'Start'}
                    onClick={() => apply(running ? pauseHockeyClock(state, context()) : startHockeyClock(state, context()))}
                  >
                    {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                    {!focused && (running ? 'Pause' : 'Start')}
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-content-muted">{projection.clock ? '' : 'No clock'}</p>
            )}
          </div>
        </div>
        {projection.status !== 'pregame' && (
          <button type="button" onClick={() => setPenaltyDetailsOpen(true)} aria-label="Open penalty box" aria-haspopup="dialog"
            className={`flex ${focused ? 'min-h-6 border-0' : 'min-h-9 border'} w-full items-center justify-center gap-2 rounded border-line px-2 text-xs font-semibold text-content-muted`}>
            {penaltyBox.strength && <span className="tabular-nums text-content">{formatHockeyStrength(penaltyBox.strength)}</span>}
            <span>{penaltyCount} {penaltyCount === 1 ? 'penalty' : 'penalties'}{!projection.clock ? ' this period' : ''}</span>
          </button>
        )}
        {projection.result && (
          <p className="text-center text-sm font-semibold text-content" aria-label="Final result">
            Final: {HOCKEY_RESULT_LABELS[projection.result.outcome]} {formatHockeyFinalScore(projection.result)}
          </p>
        )}
        {projection.status === 'pregame' && (
          <button type="button" className="btn-primary w-full" onClick={() => apply(startHockeyGame(state, context()))}>
            Start game
          </button>
        )}
        {inProgress && active && reading?.expired && !projection.decidedInPeriodId && (
          <button type="button" className="btn-primary w-full" onClick={endPeriod}>
            End {period ? formatHockeyPeriod(period) : 'period'}
          </button>
        )}
        {inProgress && !active && (
          <div className="grid grid-cols-2 gap-2">
            {projection.nextPeriod ? (
              <button type="button" className="btn-primary" onClick={() => apply(startNextHockeyPeriod(state, context()))}>
                Start {formatHockeyPeriod(projection.nextPeriod)}
              </button>
            ) : <span />}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => withReason(
                reason => endHockeyMatch(state, { reason }, context()),
                'Why is the match ending before its rules complete it?'
              )}
            >
              End game
            </button>
          </div>
        )}
      </section>

      {projection.decidedInPeriodId && inProgress && (
        <section className="rounded-md border border-success-line bg-success p-3 text-success-content">
          <p className="text-sm font-semibold">A team leads in sudden-death overtime, so the game is decided.</p>
          <button type="button" className="btn-primary mt-2 w-full" onClick={() => apply(finishDecidedHockeyGame(state, context()))}>
            End game
          </button>
        </section>
      )}

      {(projection.shootout || projection.shootoutAvailable) && (
        <HockeyShootoutPanel
          sport={sport}
          sideLabel={sideLabel}
          recentOpponentLabels={recentLabels}
          canRecord={inProgress}
          onStart={firstSide => apply(startHockeyShootout(state, { firstSide }, context()))}
          onAttempt={input => {
            const result = recordHockeyShootoutAttempt(state, input, context())
            if (!result.ok) return result.message
            apply(result)
            return null
          }}
          onEnd={() => apply(endHockeyMatch(state, {}, context()))}
          onChangeGoalie={() => setGoalieOpen(true)}
        />
      )}

      {projection.statusReason && (
        <p className="text-sm text-content-muted">Reason: {projection.statusReason}</p>
      )}

      {projection.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warning-line bg-warning p-3 text-sm text-warning-content">
          {projection.warnings.map(warning => <li key={warning.eventId}>{warning.message}</li>)}
        </ul>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}
      <HockeyCloudSyncAlerts state={state} />
      {cloudFinal && (
        <p role="status" className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-content-muted">
          This game is finalized and read-only. An owner or admin can reopen it from Game Info.
        </p>
      )}

      {tab === 'timeline' ? (
        <HockeyTimeline
          {...hockeyTimeline(state, { tracked: trackedLabel, opponent: opponentLabel })}
          participants={sport.setup.participants}
          sideLabel={sideLabel}
          correctionBlocked={cloudFinal
            ? HOCKEY_FINAL_CLOUD_GAME_MESSAGE
            : projection.status === 'suspended' || projection.status === 'abandoned'
              ? 'Reopen the game from the Game menu to correct it.'
              : null}
          onCorrect={(row, action) => setCorrection({ row, action })}
          onAdd={() => setCorrection({ row: null, action: 'add' })}
        />
      ) : (
        <>
        <section className={focused ? 'flex min-h-0 flex-1 flex-col' : 'space-y-2'} aria-label="Rink capture">
          <div className="tracker-team-context">
          <TrackerSideSelector side={captureSide} labels={{ tracked: trackedLabel, opponent: opponentLabel }} onChange={side => {
            setCaptureSide(side)
            setTap(null)
            setFaceoffDot(null)
          }} />
          </div>
          <HockeyRink
            focused={focused}
            trackedDirection={direction}
            captureSide={captureSide}
            flipped={flipped}
            trapezoid={sport.setup.rulesSnapshot.trapezoid}
            trackedLabel={trackedLabel}
            opponentLabel={opponentLabel}
            disabled={!writable}
            markers={markers}
            highlightDotId={faceoffDot}
            onFaceoffDot={dotId => {
              setTap(null)
              setFaceoffDot(dotId)
            }}
            onFlip={() => dispatch({ type: 'HYDRATE_STATE', state: setHockeyRinkFlipped(state, !flipped) })}
            onLocation={location => {
              setFaceoffDot(null)
              setTap(location)
            }}
            onMarker={id => {
              setReviewIds(hockeyTrackerMarkerIds(markers, id))
            }}
          />
          {writable && tap && (
            <CapturePanel focused={focused} title="Record at this spot" onClose={() => setTap(null)}>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" className="btn-primary" onClick={() => choose('shot')}>Shot</button>
                <button type="button" className="btn-secondary" onClick={() => choose('faceoff')}>Faceoff</button>
                <button type="button" className="btn-secondary" onClick={() => choose('hit')}>Hit</button>
                <button type="button" className="btn-secondary" onClick={() => choose('takeaway')}>Takeaway</button>
                <button type="button" className="btn-secondary" onClick={() => choose('giveaway')}>Giveaway</button>
                <button type="button" className="btn-secondary" onClick={() => setTap(null)}>Cancel</button>
              </div>
            </CapturePanel>
          )}
          {writable && faceoffDot && (
            <CapturePanel focused={focused} title="Faceoff" onClose={() => setFaceoffDot(null)}>
            <HockeyFaceoffControl
              key={faceoffDot}
              sport={sport}
              dotId={faceoffDot}
              trackedLabel={trackedLabel}
              recentOpponentLabels={recentLabels}
              onRecord={recordFaceoff}
              onCancel={() => setFaceoffDot(null)}
              onOther={() => {
                setTap({ ...HOCKEY_FACEOFF_DOTS[faceoffDot], attackingDirection: direction })
                setFaceoffDot(null)
              }}
            />
            </CapturePanel>
          )}
          </section>
          <TrackerSurfaceTools focused={focused}>
          {focused && <div className="grid grid-cols-2 gap-2">
            <MenuButton onClick={() => setMenuOpen(true)}>Game actions</MenuButton>
            <MenuButton onClick={() => { exit(); setTab('timeline') }}>Timeline</MenuButton>
            <MenuButton onClick={() => dispatch({ type: 'HYDRATE_STATE', state: setHockeyRinkFlipped(state, !flipped) })}>Flip rink view</MenuButton>
            <MenuButton onClick={() => { exit(); requestAnimationFrame(() => document.getElementById('hockey-cloud-footer')?.scrollIntoView()) }}>Cloud sync</MenuButton>
            <MenuButton onClick={() => navigate('/sport/hockey', { replace: true })}>Dashboard</MenuButton>
          </div>}
          {writable && (
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick capture">
              <button type="button" className="btn-secondary flex min-h-12 min-w-0 flex-col items-center gap-1 px-1 py-2 text-xs" onClick={() => setShotDraft({ side: captureSide, location: null })} aria-label={`${sideLabel(captureSide)} shot`}><Crosshair size={18} />Shot</button>
              <button type="button" className="btn-secondary flex min-h-12 min-w-0 flex-col items-center gap-1 px-1 py-2 text-xs" onClick={() => setPenaltyOpen(true)}><Shield size={18} />Penalty</button>
              <button type="button" className="btn-secondary flex min-h-12 min-w-0 flex-col items-center gap-1 px-1 py-2 text-xs" onClick={() => setGoalieOpen(true)}><UserRound size={18} />Goalie</button>
              <button type="button" className="btn-secondary flex min-h-12 min-w-0 flex-col items-center gap-1 px-1 py-2 text-xs" onClick={() => setPlayDraft({ kind: 'hit', location: null, side: captureSide })}><Activity size={18} />Play</button>
            </div>
          )}

        <details className="border-y border-line py-2">
          <summary className="min-h-9 cursor-pointer text-sm font-semibold text-content-muted">Marker filters <span className="font-normal">{markers.length} shown</span></summary>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs font-semibold text-content-muted">Family
              <select aria-label="Marker family" className="input-field mt-1" value={markerFilters.family} onChange={event => setMarkerFilters(value => ({ ...value, family: event.target.value as HockeyTrackerFilters['family'] }))}>
                <option value="all">All markers</option><option value="shots">Shots</option><option value="plays">Plays</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-content-muted">Team
              <select aria-label="Marker team" className="input-field mt-1" value={markerFilters.side} onChange={event => setMarkerFilters(value => ({ ...value, side: event.target.value as HockeyTrackerFilters['side'] }))}>
                <option value="all">Both teams</option><option value="tracked">{trackedLabel}</option><option value="opponent">{opponentLabel}</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-content-muted">Period
              <select aria-label="Marker period" className="input-field mt-1" value={markerFilters.scope} onChange={event => setMarkerFilters(value => ({ ...value, scope: event.target.value as HockeyTrackerFilters['scope'] }))}>
                <option value="match">Whole game</option><option value="current">Current / latest period</option>
              </select>
            </label>
          </div>
        </details>

        <HockeyRecentEvents
          rows={hockeyRecentEvents(state, { tracked: trackedLabel, opponent: opponentLabel })}
          canRestore={canRestoreHockeyCapture(state)}
          onUndo={() => apply(undoHockeyCapture(state, new Date().toISOString()))}
          onRestore={() => apply(restoreHockeyCapture(state, new Date().toISOString()))}
        />
        </TrackerSurfaceTools>
        </>
      )}

      <div id="hockey-cloud-footer" className="shrink-0"><HockeyCloudMenuSection state={state} onDone={() => {}} compact={focused} /></div>

      {reviewRows.length > 1 && <TrackerDialog title="Events at this location" onClose={() => setReviewIds(null)}>
        {reviewRows.map(row => <MenuButton key={row.id} onClick={() => setReviewIds(row.events.map(event => event.id))}>{row.periodLabel} · {row.label}</MenuButton>)}
      </TrackerDialog>}
      {reviewRows.length === 1 && <HockeyTimelineDetail row={reviewRows[0]} names={timeline.names} sideLabel={sideLabel}
        correctionBlocked={correctionBlocked} onClose={() => setReviewIds(null)}
        onCorrect={action => { setCorrection({ row: reviewRows[0], action }); setReviewIds(null) }} />}

      {penaltyDetailsOpen && (
        <TrackerDialog title="Penalty box" onClose={() => setPenaltyDetailsOpen(false)}>
          {penaltyCount === 0 && <p className="text-sm text-content-muted">No penalties in the box.</p>}
          <HockeyPenaltyBox sport={sport} reading={penaltyBox} sideLabel={sideLabel}
            onRelease={projection.clock && inProgress && active
              ? entry => askReason('Why is this penalty ending early?', reason =>
                  releaseHockeyPenalty(state, { penaltyEventId: entry.penaltyEventId, segment: entry.segment, reason }, context()))
              : undefined} />
        </TrackerDialog>
      )}

      {menuOpen && (
        <TrackerDialog title="Game" onClose={() => setMenuOpen(false)}>
          <MenuButton onClick={fromMenu(() => navigate(hockeySummaryPath({ from: 'tracker' }), { replace: focused }))}>
            {inProgress ? 'Summary (in progress)' : 'Summary'}
          </MenuButton>
          {projection.clock && inProgress && active && (
            <MenuButton disabled={running} onClick={fromMenu(setClock)}>
              Set clock{running ? ' (pause first)' : ''}
            </MenuButton>
          )}
          {inProgress && active && <MenuButton onClick={fromMenu(endPeriod)}>End period</MenuButton>}
          {inProgress && !active && projection.nextPeriod && (
            <MenuButton onClick={fromMenu(() => apply(startNextHockeyPeriod(state, context())))}>
              Start {formatHockeyPeriod(projection.nextPeriod)}
            </MenuButton>
          )}
          {inProgress && !active && (
            <MenuButton
              onClick={fromMenu(() => withReason(
                reason => endHockeyMatch(state, { reason }, context()),
                'Why is the match ending before its rules complete it?'
              ))}
            >
              End game
            </MenuButton>
          )}
          {inProgress && (['tracked', 'opponent'] as const).map(side => (
            <div key={side} className="grid grid-cols-2 gap-2">
              {([1, -1] as const).map(delta => (
                <MenuButton
                  key={delta}
                  onClick={fromMenu(() => askReason(`Why is the ${sideLabel(side)} score changing?`, reason =>
                    adjustHockeyScore(state, { side, delta, reason }, context())))}
                >
                  {sideLabel(side)} {delta > 0 ? '+1' : '-1'}
                </MenuButton>
              ))}
            </div>
          ))}
          {inProgress && (
            <>
              <MenuButton
                onClick={fromMenu(() => askReason('Why is the match suspended?', reason =>
                  interruptHockeyMatch(state, { kind: 'suspended', reason }, context())))}
              >
                Suspend game
              </MenuButton>
              <MenuButton
                onClick={fromMenu(() => askReason('Why is the match abandoned?', reason =>
                  interruptHockeyMatch(state, { kind: 'abandoned', reason }, context())))}
              >
                Abandon game
              </MenuButton>
            </>
          )}
          {!inProgress && !cloudFinal && projection.status !== 'pregame' && (
            <MenuButton
              onClick={fromMenu(() => askReason('Why is the match reopening?', reason =>
                reopenHockeyMatch(state, { reason }, context())))}
            >
              Reopen game
            </MenuButton>
          )}
        </TrackerDialog>
      )}

      {correction && (
        <HockeyTimelineEditor
          key={`${correction.row?.id ?? 'new'}-${correction.action}`}
          state={state}
          row={correction.row}
          action={correction.action}
          labels={{ tracked: trackedLabel, opponent: opponentLabel }}
          recentOpponentLabels={recentLabels}
          recorderUserId={user?.id ?? null}
          onApply={next => {
            setError(null)
            dispatch({ type: 'HYDRATE_STATE', state: next })
            setCorrection(null)
          }}
          onClose={() => setCorrection(null)}
        />
      )}
      {shotDraft && (
        <HockeyShotDialog
          draft={shotDraft}
          sport={sport}
          events={streamEvents}
          recentOpponentLabels={recentLabels}
          trackedLabel={trackedLabel}
          opponentLabel={opponentLabel}
          derivedStrength={side => (penaltyBox.strength ? hockeyGoalStrengthFor(penaltyBox.strength, side) : null)}
          onIceLimits={(() => {
            const activePeriod = hockeyActivePeriod(projection)
            return activePeriod ? hockeyOnIceLimits(sport.setup, projection, activePeriod, reading?.elapsedMs ?? null) : null
          })()}
          onSubmit={recordShot}
          onClose={() => setShotDraft(null)}
        />
      )}
      {goalieOpen && inProgress && (
        <HockeyGoalieDialog
          sport={sport}
          defaultSide={captureSide}
          trackedLabel={trackedLabel}
          opponentLabel={opponentLabel}
          onSubmit={recordGoalieChange}
          onClose={() => setGoalieOpen(false)}
        />
      )}
      {penaltyOpen && (
        <HockeyPenaltyDialog
          sport={sport}
          defaultSide={captureSide}
          recentOpponentLabels={recentLabels}
          trackedLabel={trackedLabel}
          opponentLabel={opponentLabel}
          onSubmit={recordPenalties}
          onClose={() => setPenaltyOpen(false)}
        />
      )}
      {playDraft && (
        <HockeyPlayDialog
          draft={playDraft}
          sport={sport}
          recentOpponentLabels={recentLabels}
          trackedLabel={trackedLabel}
          opponentLabel={opponentLabel}
          onSubmit={recordPlay}
          onTeamSubmit={recordTeamPlay}
          onClose={() => setPlayDraft(null)}
        />
      )}
    </main>
    </div>
  )
}

function MenuButton({ onClick, disabled = false, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="btn-secondary w-full" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function CapturePanel({ focused, title, onClose, children }: { focused: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return focused ? <TrackerDialog title={title} onClose={onClose}>{children}</TrackerDialog>
    : <div className="rounded-md border border-line bg-surface p-3" role="group" aria-label={title}>
      <p className="text-xs font-bold uppercase text-content-muted">{title}</p>{children}
    </div>
}

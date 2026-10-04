import { ChevronLeft, Menu, Pause, Play, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import HockeyFaceoffControl from '../components/hockey/HockeyFaceoffControl'
import HockeyGoalieDialog, { type HockeyGoalieChange } from '../components/hockey/HockeyGoalieDialog'
import HockeyPenaltyBox from '../components/hockey/HockeyPenaltyBox'
import HockeyPenaltyDialog from '../components/hockey/HockeyPenaltyDialog'
import HockeyPlayDialog, { type HockeyPlayDraft, type HockeyTeamPlayInput } from '../components/hockey/HockeyPlayDialog'
import HockeyRecentEvents from '../components/hockey/HockeyRecentEvents'
import HockeyRink from '../components/hockey/HockeyRink'
import HockeyTimeline from '../components/hockey/HockeyTimeline'
import HockeyTimelineEditor, { type HockeyTimelineAction } from '../components/hockey/HockeyTimelineEditor'
import HockeyShootoutPanel from '../components/hockey/HockeyShootoutPanel'
import HockeyShotDialog, { type HockeyShotDraft } from '../components/hockey/HockeyShotDialog'
import { HockeyCloudMenuSection, HockeyCloudSyncAlerts } from '../components/hockey/HockeyCloudSync'
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
  hockeyActivePeriod,
  hockeyClockDisplay,
  hockeyGoalStrengthFor,
  hockeyOnIceLimits,
  hockeyPenaltyBoxNow,
  hockeyPlayMarkers,
  hockeyRecentEvents,
  hockeyTimeline,
  hockeyShotMarkers,
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

/**
 * The Hockey event tracker (HKY-2E). Top to bottom: the scoreboard strip with the clock and
 * the penalty box (HKY-3A), the rink, the quick row and Recent Events; period and match controls live in the Game
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
  const [tap, setTap] = useState<GameEventLocation | null>(null)
  const [faceoffDot, setFaceoffDot] = useState<HockeyFaceoffDotId | null>(null)
  const [playDraft, setPlayDraft] = useState<HockeyPlayDraft | null>(null)
  const [penaltyOpen, setPenaltyOpen] = useState(false)
  const [tab, setTab] = useState<'track' | 'timeline'>('track')
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
  const active = Boolean(projection.activePeriodId)
  const trackedLabel = state.gameInfo?.teamName || 'Tracked'
  const opponentLabel = state.gameInfo?.opponentName || 'Opponent'
  const sideLabel = (side: HockeySide) => (side === 'tracked' ? trackedLabel : opponentLabel)
  const streamEvents = (state.eventStream?.events ?? []) as GameEvent[]
  const canCapture = inProgress && active && !projection.decidedInPeriodId
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
    if (choice === 'shot') setShotDraft({ side: 'tracked', location: point })
    else if (choice === 'faceoff') setFaceoffDot(nearestHockeyFaceoffDot(point).id)
    else setPlayDraft({ kind: choice, location: point })
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
    <main className="max-w-2xl mx-auto px-4 pb-6 space-y-3">
      <section
        className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-line bg-canvas/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur"
        aria-label="Scoreboard"
      >
        <div className="flex min-h-10 items-center gap-2">
          <Link to="/sport/hockey" className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Back to Hockey" title="Back to Hockey">
            <ChevronLeft size={22} />
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-content-muted">
            {period ? formatHockeyPeriod(period) : 'Not started'}
            {period && !active && inProgress ? ' ended' : ''}
            {!inProgress && projection.status !== 'pregame' ? ` · ${projection.status.replace('_', ' ')}` : ''}
          </p>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-line-strong px-3 text-sm font-semibold text-content"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
          >
            <Menu size={18} aria-hidden="true" /> Game
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2" aria-live="polite">
          {(['tracked', 'opponent'] as const).map(side => (
            <div key={side} className={`min-w-0 text-center ${side === 'opponent' ? 'order-3' : ''}`}>
              <p className="truncate text-xs font-bold uppercase text-content-muted">{sideLabel(side)}</p>
              <p className="text-3xl font-bold tabular-nums" aria-label={`${sideLabel(side)} score`}>{projection.score[side]}</p>
              <p className="text-xs text-content-muted">
                {[
                  `${projection.shotsOnGoal[side]} SOG`,
                  powerPlayLine(side),
                  projection.timeouts[side] > 0 ? `TO ${projection.timeouts[side]}` : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          ))}
          <div className="order-2 flex flex-col items-center gap-1">
            {reading ? (
              <>
                <p
                  className={`text-2xl font-bold tabular-nums ${reading.expired ? 'text-danger-content' : ''}`}
                  aria-label="Game clock"
                >
                  {formatHockeyClock(reading.displayMs)}
                </p>
                {inProgress && active && (
                  <button
                    type="button"
                    className={`inline-flex h-10 items-center gap-1 rounded-md px-3 text-sm font-semibold ${running ? 'bg-control text-content' : 'bg-accent text-accent-content'}`}
                    onClick={() => apply(running ? pauseHockeyClock(state, context()) : startHockeyClock(state, context()))}
                  >
                    {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                    {running ? 'Pause' : 'Start'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-content-muted">{projection.clock ? '' : 'No clock'}</p>
            )}
          </div>
        </div>
        {projection.status !== 'pregame' && (
          <HockeyPenaltyBox
            sport={sport}
            reading={penaltyBox}
            sideLabel={sideLabel}
            onRelease={projection.clock && inProgress && active
              ? entry => askReason('Why is this penalty ending early?', reason =>
                  releaseHockeyPenalty(state, { penaltyEventId: entry.penaltyEventId, segment: entry.segment, reason }, context()))
              : undefined}
          />
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

      <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface p-1" role="tablist" aria-label="Tracker view">
        {(['track', 'timeline'] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`min-h-10 rounded text-sm font-semibold ${tab === id ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
            onClick={() => setTab(id)}
          >
            {id === 'track' ? 'Track' : 'Timeline'}
          </button>
        ))}
      </div>

      {tab === 'timeline' ? (
        <HockeyTimeline
          {...hockeyTimeline(state, { tracked: trackedLabel, opponent: opponentLabel })}
          participants={sport.setup.participants}
          sideLabel={sideLabel}
          correctionBlocked={projection.status === 'suspended' || projection.status === 'abandoned'
            ? 'Reopen the game from the Game menu to correct it.'
            : null}
          onCorrect={(row, action) => setCorrection({ row, action })}
          onAdd={() => setCorrection({ row: null, action: 'add' })}
        />
      ) : (
        <>
        <section className="space-y-2" aria-label="Rink capture">
          <HockeyRink
            trackedDirection={direction}
            flipped={flipped}
            trapezoid={sport.setup.rulesSnapshot.trapezoid}
            trackedLabel={trackedLabel}
            opponentLabel={opponentLabel}
            disabled={!canCapture}
            markers={[...hockeyShotMarkers(sport.setup, streamEvents), ...hockeyPlayMarkers(sport.setup, streamEvents)]}
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
          />
          {canCapture && tap && (
            <div className="rounded-md border border-line bg-surface p-3" role="group" aria-label="Record at this spot">
              <p className="text-xs font-bold uppercase text-content-muted">Record at this spot</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" className="btn-primary" onClick={() => choose('shot')}>Shot</button>
                <button type="button" className="btn-secondary" onClick={() => choose('faceoff')}>Faceoff</button>
                <button type="button" className="btn-secondary" onClick={() => choose('hit')}>Hit</button>
                <button type="button" className="btn-secondary" onClick={() => choose('takeaway')}>Takeaway</button>
                <button type="button" className="btn-secondary" onClick={() => choose('giveaway')}>Giveaway</button>
                <button type="button" className="btn-secondary" onClick={() => setTap(null)}>Cancel</button>
              </div>
            </div>
          )}
          {canCapture && faceoffDot && (
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
          )}
          {canCapture && (
            <div className="grid grid-cols-5 gap-2" role="group" aria-label="Quick capture">
              {(['tracked', 'opponent'] as const).map(side => (
                <button
                  key={side}
                  type="button"
                  className="btn-secondary flex min-w-0 flex-col items-center px-1 py-1 leading-tight"
                  onClick={() => setShotDraft({ side, location: null })}
                  aria-label={`${sideLabel(side)} shot`}
                >
                  <span className="w-full truncate text-[11px] font-semibold text-content-muted">{sideLabel(side)}</span>
                  <span>Shot</span>
                </button>
              ))}
              <button type="button" className="btn-secondary px-0.5 text-sm" onClick={() => setPenaltyOpen(true)}>Penalty</button>
              <button type="button" className="btn-secondary px-0.5 text-sm" onClick={() => setGoalieOpen(true)}>Goalie</button>
              <button type="button" className="btn-secondary px-0.5 text-sm" onClick={() => setPlayDraft({ kind: 'hit', location: null })}>Play</button>
            </div>
          )}
        </section>

        <HockeyRecentEvents
          rows={hockeyRecentEvents(state, { tracked: trackedLabel, opponent: opponentLabel })}
          canRestore={canRestoreHockeyCapture(state)}
          onUndo={() => apply(undoHockeyCapture(state, new Date().toISOString()))}
          onRestore={() => apply(restoreHockeyCapture(state, new Date().toISOString()))}
        />
        </>
      )}

      {menuOpen && (
        <GameMenu onClose={() => setMenuOpen(false)}>
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
          {!inProgress && projection.status !== 'pregame' && (
            <MenuButton
              onClick={fromMenu(() => askReason('Why is the match reopening?', reason =>
                reopenHockeyMatch(state, { reason }, context())))}
            >
              Reopen game
            </MenuButton>
          )}
          <HockeyCloudMenuSection state={state} onDone={() => setMenuOpen(false)} />
        </GameMenu>
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
          trackedLabel={trackedLabel}
          opponentLabel={opponentLabel}
          onSubmit={recordGoalieChange}
          onClose={() => setGoalieOpen(false)}
        />
      )}
      {penaltyOpen && (
        <HockeyPenaltyDialog
          sport={sport}
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
  )
}

function GameMenu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
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
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center gap-3 border-b border-line px-4">
          <h2 id={titleId} className="flex-1 font-bold text-content">Game</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Close" title="Close" autoFocus>
            <X size={20} />
          </button>
        </header>
        <div className="space-y-2 p-4">{children}</div>
      </div>
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

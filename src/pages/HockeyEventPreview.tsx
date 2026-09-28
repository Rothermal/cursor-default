import { useEffect, useState } from 'react'
import HockeyGoalieDialog, { type HockeyGoalieChange } from '../components/hockey/HockeyGoalieDialog'
import HockeyRink from '../components/hockey/HockeyRink'
import HockeyShotDialog, { type HockeyShotDraft } from '../components/hockey/HockeyShotDialog'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { createInitialState } from '../lib/gameReducer'
import {
  endHockeyMatch,
  endHockeyPeriod,
  formatHockeyClock,
  formatHockeyPeriod,
  hockeyActivePeriod,
  hockeyClockDisplay,
  hockeyRulesProfiles,
  hockeySportState,
  adjustHockeyScore,
  changeHockeyGoalie,
  finishDecidedHockeyGame,
  hockeyShotMarkers,
  hockeyZone,
  nearestHockeyFaceoffDot,
  recentHockeyOpponentLabels,
  recordHockeyShot,
  type HockeySide,
  type RecordHockeyShotInput,
  HOCKEY_RULES_FIELDS,
  initializeHockeyEventGame,
  interruptHockeyMatch,
  lastHockeyPeriod,
  pauseHockeyClock,
  reopenHockeyMatch,
  setHockeyClock,
  setHockeyRinkFlipped,
  startHockeyClock,
  startHockeyGame,
  startNextHockeyPeriod,
  createHockeyMatchRules,
  DEFAULT_HOCKEY_PROFILE_ID,
  type HockeyAttackingDirection,
  type HockeyClockModel,
  type HockeyCommandContext,
  type HockeyCommandResult,
  type HockeyMatchParticipant,
  type HockeyMatchSetup,
  type HockeyProfileId,
  type HockeyRuleSource,
  type HockeyRulesField,
  type HockeySportGameState,
} from '../lib/hockey'
import { isHockeyEventPreviewAvailable } from '../lib/sportAvailability'
import type { GameEvent, GameEventLocation } from '../lib/gameEvents/types'
import type { GameState } from '../types'

/**
 * Hockey development preview: a plain setup form and a period/clock panel for
 * exercising the Hockey event engine, plus the HKY-2A rink. Taps are shown,
 * not recorded. Production builds never render it.
 */
export default function HockeyEventPreview() {
  const { state } = useGame()
  if (!isHockeyEventPreviewAvailable()) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5">
        <p className="rounded-md border border-info-line bg-info px-3 py-2 text-sm text-info-content">
          Hockey event tracking is not available in this build yet.
        </p>
      </main>
    )
  }
  const sport = hockeySportState(state)
  return sport ? <HockeyLivePanel sport={sport} /> : <HockeySetupForm />
}

function HockeySetupForm() {
  const { state, dispatch, prepareActiveGameMutation, startNewGame } = useGame()
  const { user } = useAuth()
  const [teamName, setTeamName] = useState('Home')
  const [opponentName, setOpponentName] = useState('Visitors')
  const [profileId, setProfileId] = useState<HockeyProfileId>(DEFAULT_HOCKEY_PROFILE_ID)
  const [clockModel, setClockModel] = useState<HockeyClockModel>('anchored')
  const [direction, setDirection] = useState<HockeyAttackingDirection>('left_to_right')
  const [error, setError] = useState<string | null>(null)

  const start = () => {
    const hockey = sports.find(entry => entry.id === 'hockey')
    if (!hockey) return
    const setup = buildPreviewSetup({ profileId, clockModel, direction, opponentName })
    const base: GameState = {
      ...createInitialState(),
      sport: hockey,
      gameInfo: {
        teamName: teamName.trim() || 'Home',
        opponentName: opponentName.trim() || 'Visitors',
        tournamentName: '',
        tournamentId: null,
        date: new Date().toISOString().slice(0, 10),
      },
      players: setup.participants.map(participant => ({
        id: participant.playerId!,
        name: participant.displayName,
        number: participant.number ?? '',
        stats: {},
      })),
    }
    const initialized = initializeHockeyEventGame(base, setup)
    const started = initialized.ok
      ? startHockeyGame(initialized.state, { recorderUserId: user?.id ?? null, occurredAt: new Date().toISOString() })
      : initialized
    if (!started.ok) {
      setError(started.message)
      return
    }
    const hasGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0 || state.eventStream))
    if (hasGame && !prepareActiveGameMutation('new_game_commit')) return
    if (!startNewGame(hockey)) return
    dispatch({ type: 'HYDRATE_STATE', state: started.state })
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <h1 className="text-lg font-bold">Hockey event preview</h1>
      <p className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
        Development only. Uses generated players and saves as a local game.
      </p>
      <label className="block text-sm font-medium text-content">
        Team
        <input className="input-field mt-1" maxLength={80} value={teamName} onChange={event => setTeamName(event.target.value)} />
      </label>
      <label className="block text-sm font-medium text-content">
        Opponent
        <input className="input-field mt-1" maxLength={80} value={opponentName} onChange={event => setOpponentName(event.target.value)} />
      </label>
      <label className="block text-sm font-medium text-content">
        Rules
        <select
          className="input-field mt-1"
          value={profileId}
          onChange={event => setProfileId(event.target.value as HockeyProfileId)}
        >
          {hockeyRulesProfiles().map(profile => (
            <option key={profile.id} value={profile.id}>{profile.label}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-content">
        Clock
        <select
          className="input-field mt-1"
          value={clockModel}
          onChange={event => setClockModel(event.target.value as HockeyClockModel)}
        >
          <option value="anchored">Run the game clock</option>
          <option value="none">No clock</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-content">
        Period 1 attacking direction
        <select
          className="input-field mt-1"
          value={direction}
          onChange={event => setDirection(event.target.value as HockeyAttackingDirection)}
        >
          <option value="left_to_right">Left to right</option>
          <option value="right_to_left">Right to left</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}
      <button type="button" className="btn-primary w-full" onClick={start}>Start game</button>
    </main>
  )
}

function HockeyLivePanel({ sport }: { sport: HockeySportGameState }) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date().toISOString())
  const [lastTap, setLastTap] = useState<GameEventLocation | null>(null)
  const [shotDraft, setShotDraft] = useState<HockeyShotDraft | null>(null)
  const [goalieOpen, setGoalieOpen] = useState(false)
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
    if (!match) return
    const shownMs = (Number(match[1]) * 60 + Number(match[2])) * 1000
    const elapsedMs = rules.clock.display === 'count_down' ? active.durationMs - shownMs : shownMs
    askReason('Why is the clock changing?', reason => setHockeyClock(state, { elapsedMs, reason }, context()))
  }

  const reading = hockeyClockDisplay(sport, now)
  const period = hockeyActivePeriod(projection) ?? lastHockeyPeriod(projection)
  const direction = projection.trackedAttackingDirection ?? sport.setup.firstPeriodAttackingDirection
  const flipped = sport.capturePreferences.rinkFlipped
  const inProgress = projection.status === 'in_progress'
  const active = Boolean(projection.activePeriodId)
  const trackedLabel = state.gameInfo?.teamName || 'Tracked'
  const opponentLabel = state.gameInfo?.opponentName || 'Opponent'
  const streamEvents = (state.eventStream?.events ?? []) as GameEvent[]
  const canCapture = inProgress && active && !projection.decidedInPeriodId

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

  const adjust = (side: HockeySide, delta: 1 | -1) =>
    askReason(`Why is the ${side === 'tracked' ? trackedLabel : opponentLabel} score changing?`, reason =>
      adjustHockeyScore(state, { side, delta, reason }, context()))

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <h1 className="text-lg font-bold">
        {state.gameInfo?.teamName ?? 'Home'} vs {state.gameInfo?.opponentName ?? 'Visitors'}
      </h1>
      <section className="rounded-md bg-surface p-4 space-y-1" aria-live="polite">
        <p className="text-sm text-content-muted">Status: {projection.status.replace('_', ' ')}</p>
        <p className="text-base font-semibold">
          {period ? formatHockeyPeriod(period) : 'Not started'}
          {period && !active && inProgress ? ' (ended)' : ''}
        </p>
        {reading && (
          <p className="text-3xl font-bold tabular-nums" aria-label="Game clock">
            {formatHockeyClock(reading.displayMs)}
          </p>
        )}
        {!projection.clock && <p className="text-sm text-content-muted">No clock for this game.</p>}
        {projection.statusReason && <p className="text-sm text-content-muted">Reason: {projection.statusReason}</p>}
        <dl className="grid grid-cols-2 gap-2 pt-2 text-center">
          {(['tracked', 'opponent'] as const).map(side => (
            <div key={side} className="rounded-md bg-surface-muted p-2">
              <dt className="truncate text-xs font-bold uppercase text-content-muted">{side === 'tracked' ? trackedLabel : opponentLabel}</dt>
              <dd className="text-2xl font-bold tabular-nums" aria-label={`${side === 'tracked' ? trackedLabel : opponentLabel} score`}>{projection.score[side]}</dd>
              <dd className="text-xs text-content-muted">{projection.shotsOnGoal[side]} {projection.shotsOnGoal[side] === 1 ? 'shot' : 'shots'} on goal</dd>
              {inProgress && (
                <dd className="mt-1 flex justify-center gap-1">
                  <button type="button" className="rounded border border-line-strong px-2 text-xs" aria-label={`Add a ${side} goal by adjustment`} onClick={() => adjust(side, 1)}>+1</button>
                  <button type="button" className="rounded border border-line-strong px-2 text-xs" aria-label={`Remove a ${side} goal by adjustment`} onClick={() => adjust(side, -1)}>-1</button>
                </dd>
              )}
            </div>
          ))}
        </dl>
      </section>

      {projection.decidedInPeriodId && inProgress && (
        <section className="rounded-md border border-success-line bg-success p-3 text-success-content">
          <p className="text-sm font-semibold">The overtime goal decided the game.</p>
          <button type="button" className="btn-primary mt-2 w-full" onClick={() => apply(finishDecidedHockeyGame(state, context()))}>
            End game
          </button>
        </section>
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

      <div className="grid grid-cols-2 gap-2">
        {projection.clock && inProgress && active && (
          <>
            <button
              type="button"
              className="btn-primary"
              onClick={() => apply(running ? pauseHockeyClock(state, context()) : startHockeyClock(state, context()))}
            >
              {running ? 'Pause clock' : 'Start clock'}
            </button>
            <button type="button" className="btn-secondary" disabled={running} onClick={setClock}>
              Set clock
            </button>
          </>
        )}
        {inProgress && active && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => withReason(
              reason => endHockeyPeriod(state, { reason }, context()),
              'Why is the period ending before the clock runs out?'
            )}
          >
            End period
          </button>
        )}
        {inProgress && !active && projection.nextPeriod && (
          <button type="button" className="btn-primary" onClick={() => apply(startNextHockeyPeriod(state, context()))}>
            Start {formatHockeyPeriod(projection.nextPeriod)}
          </button>
        )}
        {inProgress && !active && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => withReason(
              reason => endHockeyMatch(state, { reason }, context()),
              'Why is the match ending before its rules complete it?'
            )}
          >
            End match
          </button>
        )}
        {inProgress && (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => askReason('Why is the match suspended?', reason =>
                interruptHockeyMatch(state, { kind: 'suspended', reason }, context()))}
            >
              Suspend
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => askReason('Why is the match abandoned?', reason =>
                interruptHockeyMatch(state, { kind: 'abandoned', reason }, context()))}
            >
              Abandon
            </button>
          </>
        )}
        {!inProgress && projection.status !== 'pregame' && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => askReason('Why is the match reopening?', reason => reopenHockeyMatch(state, { reason }, context()))}
          >
            Reopen
          </button>
        )}
      </div>

      <section className="space-y-2">
        <HockeyRink
          trackedDirection={direction}
          flipped={flipped}
          trapezoid={sport.setup.rulesSnapshot.trapezoid}
          trackedLabel={state.gameInfo?.teamName ?? 'Tracked'}
          opponentLabel={opponentLabel}
          disabled={!canCapture}
          markers={hockeyShotMarkers(sport.setup, streamEvents)}
          onFlip={() => dispatch({ type: 'HYDRATE_STATE', state: setHockeyRinkFlipped(state, !flipped) })}
          onLocation={location => {
            setLastTap(location)
            setShotDraft({ side: 'tracked', location: { x: location.x, y: location.y } })
          }}
        />
        {canCapture && (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShotDraft({ side: 'tracked', location: null })}>{trackedLabel} shot</button>
            <button type="button" className="btn-secondary" onClick={() => setShotDraft({ side: 'opponent', location: null })}>{opponentLabel} shot</button>
            <button type="button" className="btn-secondary" onClick={() => setGoalieOpen(true)}>Goalie</button>
          </div>
        )}
        {lastTap && (
          <p className="text-sm text-content-muted" aria-live="polite">
            Last tap: {hockeyZone(lastTap, 'tracked', direction)} zone for the tracked team,
            nearest dot {nearestHockeyFaceoffDot(lastTap).id.replace(/_/g, ' ')}
          </p>
        )}
      </section>

      {shotDraft && (
        <HockeyShotDialog
          draft={shotDraft}
          sport={sport}
          events={streamEvents}
          recentOpponentLabels={recentHockeyOpponentLabels(streamEvents)}
          trackedLabel={trackedLabel}
          opponentLabel={opponentLabel}
          onSubmit={recordShot}
          onClose={() => setShotDraft(null)}
        />
      )}
      {goalieOpen && (
        <HockeyGoalieDialog
          sport={sport}
          trackedLabel={trackedLabel}
          opponentLabel={opponentLabel}
          onSubmit={recordGoalieChange}
          onClose={() => setGoalieOpen(false)}
        />
      )}

      <section>
        <h2 className="text-sm font-bold uppercase text-content-muted">Events</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {[...(state.eventStream?.events ?? [])].reverse().map((raw, index) => {
            const event = raw as { id?: string; eventType?: string; elapsedMs?: number | null }
            return (
              <li key={event.id ?? index} className="flex justify-between gap-3">
                <span>{event.eventType?.replace('hockey.', '').replace(/_/g, ' ')}</span>
                <span className="tabular-nums text-content-muted">
                  {typeof event.elapsedMs === 'number' ? formatHockeyClock(event.elapsedMs) : ''}
                </span>
              </li>
            )
          })}
        </ol>
      </section>
    </main>
  )
}

function buildPreviewSetup(input: {
  profileId: HockeyProfileId
  clockModel: HockeyClockModel
  direction: HockeyAttackingDirection
  opponentName: string
}): HockeyMatchSetup {
  const clockless = input.clockModel === 'none'
  const rules = createHockeyMatchRules(input.profileId, clockless ? { clockModel: 'none', clock: null } : {})
  const skaterCount = rules.skatersPerSide + 4
  const participants: HockeyMatchParticipant[] = [
    { id: 'goalie-1', playerId: 'preview-goalie-1', displayName: 'Goalie 1', number: '1', position: 'G', dressedAs: 'goalie' },
    ...Array.from({ length: skaterCount }, (_, index): HockeyMatchParticipant => ({
      id: `skater-${index + 1}`,
      playerId: `preview-skater-${index + 1}`,
      displayName: `Skater ${index + 1}`,
      number: String(index + 2),
      position: null,
      dressedAs: 'skater',
    })),
  ]
  const rulesSource = Object.fromEntries(
    HOCKEY_RULES_FIELDS.map(field => [
      field,
      clockless && (field === 'clockModel' || field === 'clock') ? 'match' : 'built_in',
    ])
  ) as Record<HockeyRulesField, HockeyRuleSource>
  return {
    version: 1,
    trackedTeam: 'home',
    opponentName: input.opponentName.trim() || null,
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: rules,
    rulesSource,
    firstPeriodAttackingDirection: input.direction,
    participants,
    openingLineup: {
      goalieParticipantId: 'goalie-1',
      skaterParticipantIds: participants.slice(1, rules.skatersPerSide + 1).map(participant => participant.id),
    },
    opponentGoalie: { id: 'opponent-goalie', label: null, number: null },
  }
}

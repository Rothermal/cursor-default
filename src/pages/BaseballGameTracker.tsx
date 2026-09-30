import { ChevronLeft, Menu, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import BaseballDiamond from '../components/baseball/BaseballDiamond'
import BaseballInPlaySheet from '../components/baseball/BaseballInPlaySheet'
import BaseballPitchPad from '../components/baseball/BaseballPitchPad'
import BaseballQuickPlateAppearance from '../components/baseball/BaseballQuickPlateAppearance'
import BaseballRunnerResolution from '../components/baseball/BaseballRunnerResolution'
import BaseballScoreboard from '../components/baseball/BaseballScoreboard'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import {
  baseballCaptureTerminal,
  baseballDiamondView,
  baseballDroppedThirdStrikeAvailable,
  baseballFallbackReason,
  baseballFieldingPositionCode,
  baseballLineScoreView,
  baseballPersonLabel,
  baseballResolutionIssues,
  baseballResolutionMovements,
  baseballScoreboardView,
  baseballSportState,
  commitBaseballCapture,
  createBaseballResolutionRows,
  addBaseballResolutionFielder,
  cycleBaseballResolutionDraftRow,
  emptyBaseballInPlayDraft,
  findBaseballRulesProfile,
  proposeBaseballCaptureMovements,
  setBaseballCapturePreferences,
  startBaseballGame,
  substituteBaseball,
  type BaseballBattedBall,
  type BaseballCommandContext,
  type BaseballCommandResult,
  type BaseballInPlayDraft,
  type BaseballMatchSetup,
  type BaseballPendingCapture,
  type BaseballPitchLocation,
  type BaseballPitchResult,
  type BaseballQuickPlateAppearanceResult,
  type BaseballResolutionDraft,
  type BaseballResolutionRow,
  type BaseballResolutionTransition,
  type BaseballSportGameState,
} from '../lib/baseball'
import { createBaseballUuid } from '../lib/baseball/id'
import { isBaseballEventPreviewAvailable } from '../lib/sportAvailability'

const BATTING_FORMAT_LABELS: Record<string, string> = {
  standard: 'Standard (nine bat)',
  designated_hitter: 'Designated hitter',
  extra_hitter: 'Extra hitters',
  continuous: 'Continuous order',
}

const PENDING_END_REASON = 'The game can end on this play. Ending the game arrives in a later update.'

/** What the recorder is doing below the diamond. Nothing is written until a step commits. */
type CaptureFlow =
  | { step: 'idle' }
  | { step: 'dropped_third'; capture: Extract<BaseballPendingCapture, { source: 'pitch' }> }
  | { step: 'in_play'; capture: BaseballPendingCapture; draft: BaseballInPlayDraft }
  | { step: 'quick' }
  | { step: 'resolve'; capture: BaseballPendingCapture; draft: BaseballResolutionDraft; error: string | null }
  | { step: 'opponent_label'; slotId: string; label: string; number: string }

/**
 * The live Baseball tracker: the scoreboard strip, the diamond and the pitch pad showing
 * the current projection (BSB-3A), with pitches, the in-play sheet, runner resolution and
 * Quick PA (BSB-3B). Between-pitch running, endings and Undo follow in BSB-3C and BSB-3D.
 */
export default function BaseballGameTracker() {
  const { state } = useGame()
  if (!isBaseballEventPreviewAvailable()) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5">
        <p className="rounded-md border border-info-line bg-info px-3 py-2 text-sm text-info-content">
          Baseball event tracking is not available in this build yet.
        </p>
      </main>
    )
  }
  const sport = baseballSportState(state)
  if (!sport) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          This Baseball game could not be read. It is kept as it was saved; start a new game to continue.
        </p>
        <Link to="/sport/baseball" className="btn-secondary inline-block">Back to Baseball</Link>
      </main>
    )
  }
  return <BaseballTracker sport={sport} />
}

function BaseballTracker({ sport }: { sport: BaseballSportGameState }) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pitchLocation, setPitchLocation] = useState<BaseballPitchLocation | null>(null)
  const [flow, setFlow] = useState<CaptureFlow>({ step: 'idle' })
  const [runnersMovedArmed, setRunnersMovedArmed] = useState(false)
  const { setup, projection, capturePreferences } = sport
  const fielderCount = setup.rulesSnapshot.defensivePlayers

  const names = {
    tracked: state.gameInfo?.teamName || 'Tracked team',
    opponent: setup.opponentName || 'Opponent',
  }
  const sideName = (side: 'tracked' | 'opponent') => names[side]
  const diamond = baseballDiamondView(sport)
  const inProgress = projection.status === 'in_progress'

  const start = () => {
    const result = startBaseballGame(state, { recorderUserId: user?.id ?? null, occurredAt: new Date().toISOString() })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const setPreference = (patch: Parameters<typeof setBaseballCapturePreferences>[1]) =>
    dispatch({ type: 'HYDRATE_STATE', state: setBaseballCapturePreferences(state, patch) })

  const context = (): BaseballCommandContext => ({
    recorderUserId: user?.id ?? null,
    occurredAt: new Date().toISOString(),
    // One id per capture so BSB-3D Undo can remove the whole unit.
    captureCommandId: createBaseballUuid(),
  })

  const applied = (result: BaseballCommandResult): boolean => {
    if (!result.ok) {
      setError(result.message)
      return false
    }
    setError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    return true
  }

  const openResolution = (capture: BaseballPendingCapture) => {
    const terminal = baseballCaptureTerminal(sport, capture)
    const rows = createBaseballResolutionRows(
      projection,
      proposeBaseballCaptureMovements(sport, capture),
      terminal !== null,
      baseballFallbackReason(terminal)
    )
    setError(null)
    setFlow({
      step: 'resolve',
      capture,
      draft: { rows, activeRunnerId: rows.find(row => row.to === 'out' && row.fielders.length === 0)?.runnerId ?? null },
      error: null,
    })
  }

  // Functional updates so several edits in one event never overwrite each other.
  const updateResolution = (transition: BaseballResolutionTransition) =>
    setFlow(previous => (previous.step === 'resolve' ? { ...previous, draft: transition(previous.draft), error: null } : previous))
  const updateInPlay = (edit: (draft: BaseballInPlayDraft) => BaseballInPlayDraft) =>
    setFlow(previous => (previous.step === 'in_play' ? { ...previous, draft: edit(previous.draft) } : previous))

  const finishCapture = () => {
    setFlow({ step: 'idle' })
    setPitchLocation(null)
    setRunnersMovedArmed(false)
  }

  /** Saves at once with the proposal, or opens runner resolution when the recorder must choose. */
  const proceed = (capture: BaseballPendingCapture) => {
    const terminal = baseballCaptureTerminal(sport, capture)
    const needsResolution =
      runnersMovedArmed || terminal === 'in_play' || (capture.source === 'pitch' && capture.droppedThirdStrike)
    if (needsResolution) {
      openResolution(capture)
      return
    }
    if (applied(commitBaseballCapture(state, capture, proposeBaseballCaptureMovements(sport, capture), context()))) {
      finishCapture()
    }
  }

  const onPitchResult = (result: BaseballPitchResult) => {
    const capture = {
      source: 'pitch' as const,
      result,
      pitchLocation: capturePreferences.trackPitchLocation ? pitchLocation : null,
      battedBall: null,
      droppedThirdStrike: false,
    }
    if (result === 'in_play') {
      setFlow({ step: 'in_play', capture, draft: emptyBaseballInPlayDraft() })
      return
    }
    if (baseballCaptureTerminal(sport, capture) === 'strikeout' && baseballDroppedThirdStrikeAvailable(sport)) {
      setFlow({ step: 'dropped_third', capture })
      return
    }
    proceed(capture)
  }

  const onQuickResult = (choice: { result: BaseballQuickPlateAppearanceResult; finalBalls: number | null; finalStrikes: number | null }) => {
    const capture = { source: 'quick' as const, battedBall: null, ...choice }
    if (choice.result === 'in_play') {
      setFlow({ step: 'in_play', capture, draft: emptyBaseballInPlayDraft() })
      return
    }
    proceed(capture)
  }

  const onBattedBall = (capture: BaseballPendingCapture, battedBall: BaseballBattedBall) =>
    openResolution({ ...capture, battedBall })

  const confirmResolution = () => {
    if (flow.step !== 'resolve') return
    const issues = Object.values(baseballResolutionIssues(flow.draft.rows))
    if (issues.length > 0) {
      setFlow({ ...flow, error: issues[0]! })
      return
    }
    const result = commitBaseballCapture(state, flow.capture, baseballResolutionMovements(flow.draft.rows), context())
    if (!result.ok) {
      // Keep every choice in place so the recorder can fix what the engine rejected.
      setFlow({ ...flow, error: result.message })
      return
    }
    applied(result)
    finishCapture()
  }

  const saveOpponentLabel = () => {
    if (flow.step !== 'opponent_label') return
    const slot = projection.opponentSlotDetails[flow.slotId]
    if (!slot) return
    const result = substituteBaseball(state, 'opponent', {
      kind: 'opponent_slot',
      slotId: flow.slotId,
      label: flow.label.trim() || null,
      number: flow.number.trim() || null,
      position: slot.position,
      bats: slot.bats,
    }, context())
    if (applied(result)) setFlow({ step: 'idle' })
  }

  const rowNames = (rows: BaseballResolutionRow[]) =>
    Object.fromEntries(rows.map(row => [row.runnerId, baseballPersonLabel(sport, row.runnerId).name]))

  const batterSlot = diamond.batter ? projection.opponentSlotDetails[diamond.batter.id] : undefined
  const canCapture = inProgress && projection.pendingEnd === null
  const showRunnersMoved =
    Boolean(projection.bases.first || projection.bases.second || projection.bases.third) ||
    baseballDroppedThirdStrikeAvailable(sport)

  const profile = findBaseballRulesProfile(setup.rulesSnapshot.profileId)

  return (
    <main className="max-w-2xl mx-auto px-4 pb-6 space-y-3">
      <BaseballScoreboard
        view={baseballScoreboardView(sport, names)}
        lineScore={baseballLineScoreView(sport, names)}
        leading={(
          <Link to="/sport/baseball" className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Back to Baseball" title="Back to Baseball">
            <ChevronLeft size={22} />
          </Link>
        )}
        trailing={(
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-line-strong px-3 text-sm font-semibold text-content"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
          >
            <Menu size={18} aria-hidden="true" /> Game
          </button>
        )}
      />

      <p className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
        Development preview. Runner plays between pitches, pitching changes and Undo come next. This game stays on this device.
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}

      {projection.status === 'pregame' && (
        <section className="space-y-3">
          <p className="text-sm text-content-muted">
            {profile?.label ?? 'Custom rules'} · {setup.rulesSnapshot.scheduledInnings} innings ·{' '}
            {BATTING_FORMAT_LABELS[setup.rulesSnapshot.battingOrderFormat]}
          </p>
          <button type="button" className="btn-primary w-full" onClick={start}>Start game</button>
          <LineupReview setup={setup} teamName={names.tracked} opponentName={names.opponent} />
        </section>
      )}

      {projection.status !== 'pregame' && (
        <>
          <section aria-label="Diamond">
            <BaseballDiamond
              view={diamond}
              battingLabel={sideName(projection.battingSide)}
              fieldingLabel={sideName(diamond.fieldingSide)}
              pendingLocation={flow.step === 'in_play' ? flow.draft.location : null}
              onLocation={flow.step === 'in_play' && capturePreferences.trackBattedBallLocation
                ? location => updateInPlay(draft => ({ ...draft, location: { x: location.x, y: location.y } }))
                : undefined}
              onFielder={flow.step === 'in_play'
                ? position => updateInPlay(draft => ({ ...draft, fielders: [...draft.fielders, position] }))
                : flow.step === 'resolve' && flow.draft.activeRunnerId
                  ? position => updateResolution(addBaseballResolutionFielder(position))
                  : undefined}
              onRunner={flow.step === 'resolve'
                ? base => {
                  const runnerId = projection.bases[base]?.runnerId
                  if (runnerId) updateResolution(cycleBaseballResolutionDraftRow(runnerId))
                }
                : undefined}
              onEditBatter={flow.step === 'idle' && canCapture && batterSlot
                ? () => setFlow({
                  step: 'opponent_label',
                  slotId: batterSlot.id,
                  label: batterSlot.label ?? '',
                  number: batterSlot.number ?? '',
                })
                : undefined}
            />
          </section>

          {inProgress && flow.step === 'idle' && (
            <>
              <BaseballPitchPad
                showZone={capturePreferences.trackPitchLocation}
                pendingLocation={pitchLocation}
                onLocation={setPitchLocation}
                onResult={canCapture ? onPitchResult : undefined}
                disabledReason={PENDING_END_REASON}
                runnersMoved={showRunnersMoved
                  ? { armed: runnersMovedArmed, onToggle: () => setRunnersMovedArmed(armed => !armed) }
                  : undefined}
              />
              <button
                type="button"
                className="btn-secondary w-full"
                disabled={!canCapture || projection.pitchesInPlateAppearance > 0}
                onClick={() => setFlow({ step: 'quick' })}
              >
                Quick PA
              </button>
              {canCapture && projection.pitchesInPlateAppearance > 0 && (
                <p className="text-xs text-content-muted">Quick PA is for a plate appearance with no pitches tracked.</p>
              )}
            </>
          )}

          {flow.step === 'dropped_third' && (
            <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Strike three">
              <h2 className="font-bold text-content">Strike three</h2>
              <p className="text-sm text-content-muted">Did the catcher hold the ball?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-primary px-2" onClick={() => proceed(flow.capture)}>Strikeout</button>
                <button
                  type="button"
                  className="btn-secondary px-2"
                  onClick={() => proceed({ ...flow.capture, droppedThirdStrike: true })}
                >
                  Dropped third strike
                </button>
              </div>
              <button type="button" className="btn-secondary w-full" onClick={() => setFlow({ step: 'idle' })}>Cancel</button>
            </section>
          )}

          {flow.step === 'in_play' && (
            <BaseballInPlaySheet
              draft={flow.draft}
              onChange={draft => updateInPlay(() => draft)}
              trackLocation={capturePreferences.trackBattedBallLocation}
              fielderCount={fielderCount}
              onCancel={() => setFlow({ step: 'idle' })}
              onContinue={battedBall => onBattedBall(flow.capture, battedBall)}
            />
          )}

          {flow.step === 'quick' && (
            <BaseballQuickPlateAppearance
              ballsForWalk={setup.rulesSnapshot.ballsForWalk}
              strikesForStrikeout={setup.rulesSnapshot.strikesForStrikeout}
              onCancel={() => setFlow({ step: 'idle' })}
              onContinue={onQuickResult}
            />
          )}

          {flow.step === 'resolve' && (
            <BaseballRunnerResolution
              title={baseballCaptureTerminal(sport, flow.capture) === null ? 'Runners on this pitch' : 'Where everyone ends up'}
              draft={flow.draft}
              onChange={updateResolution}
              names={rowNames(flow.draft.rows)}
              terminal={baseballCaptureTerminal(sport, flow.capture)}
              fielderCount={fielderCount}
              error={flow.error}
              // Cancel writes nothing; the "Runners moved" chip stays armed.
              onCancel={() => setFlow({ step: 'idle' })}
              onConfirm={confirmResolution}
            />
          )}

          {flow.step === 'opponent_label' && (
            <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Opponent batter">
              <h2 className="font-bold text-content">Opponent batter</h2>
              <p className="text-sm text-content-muted">A label for this batting slot. The lineup does not change.</p>
              <label className="block space-y-1 text-sm font-semibold text-content">
                <span>Name or label</span>
                <input
                  className="input-field"
                  value={flow.label}
                  maxLength={60}
                  onChange={event => setFlow({ ...flow, label: event.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm font-semibold text-content">
                <span>Number</span>
                <input
                  className="input-field"
                  inputMode="numeric"
                  value={flow.number}
                  maxLength={4}
                  onChange={event => setFlow({ ...flow, number: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary" onClick={() => setFlow({ step: 'idle' })}>Cancel</button>
                <button type="button" className="btn-primary" onClick={saveOpponentLabel}>Save</button>
              </div>
            </section>
          )}
        </>
      )}

      {menuOpen && (
        <GameMenu onClose={() => setMenuOpen(false)}>
          <Toggle
            label="Track pitch location"
            checked={capturePreferences.trackPitchLocation}
            onChange={checked => setPreference({ trackPitchLocation: checked })}
          />
          <Toggle
            label="Track batted-ball location"
            checked={capturePreferences.trackBattedBallLocation}
            onChange={checked => setPreference({ trackBattedBallLocation: checked })}
          />
        </GameMenu>
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-line px-3">
      <span className="text-sm font-semibold text-content">{label}</span>
      <input
        type="checkbox"
        role="switch"
        className="h-5 w-5 accent-[rgb(var(--accent))]"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
    </label>
  )
}

function LineupReview({ setup, teamName, opponentName }: { setup: BaseballMatchSetup; teamName: string; opponentName: string }) {
  const participant = new Map(setup.participants.map(entry => [entry.id, entry]))
  const fieldingNumber = new Map(Object.entries(setup.trackedLineup.defense).map(([key, id]) => [id, Number(key)]))
  const name = (id: string) => {
    const entry = participant.get(id)
    return entry ? `${entry.number ? `#${entry.number} ` : ''}${entry.displayName}` : 'Unknown player'
  }
  const bench = setup.participants.filter(entry =>
    !setup.trackedLineup.battingOrder.includes(entry.id) && !fieldingNumber.has(entry.id))

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section>
        <h2 className="text-sm font-bold uppercase text-content-muted">{teamName}</h2>
        <ol className="mt-2 space-y-1 text-sm list-decimal pl-5">
          {setup.trackedLineup.battingOrder.map(id => {
            const number = fieldingNumber.get(id)
            return (
              <li key={id}>
                {name(id)}
                <span className="text-content-muted"> · {number ? baseballFieldingPositionCode(number) : 'Bats only'}</span>
              </li>
            )
          })}
        </ol>
        {Object.entries(setup.trackedLineup.defense)
          .filter(([, id]) => !setup.trackedLineup.battingOrder.includes(id))
          .map(([key, id]) => (
            <p key={key} className="mt-1 text-sm">
              {baseballFieldingPositionCode(Number(key))}: {name(id)} <span className="text-content-muted">(does not bat)</span>
            </p>
          ))}
        {bench.length > 0 && (
          <p className="mt-2 text-sm text-content-muted">Bench: {bench.map(entry => name(entry.id)).join(', ')}</p>
        )}
      </section>
      <section>
        <h2 className="text-sm font-bold uppercase text-content-muted">{opponentName}</h2>
        <ol className="mt-2 space-y-1 text-sm list-decimal pl-5">
          {setup.opponentSlots.map((slot, index) => (
            <li key={slot.id}>
              {[slot.number ? `#${slot.number}` : null, slot.label ?? `Batter ${index + 1}`].filter(Boolean).join(' ')}
              {slot.position && <span className="text-content-muted"> · {slot.position}</span>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-sm">
          Pitcher: {[setup.opponentPitcher.number ? `#${setup.opponentPitcher.number}` : null, setup.opponentPitcher.label ?? 'Starting pitcher']
            .filter(Boolean).join(' ')}
        </p>
      </section>
    </div>
  )
}

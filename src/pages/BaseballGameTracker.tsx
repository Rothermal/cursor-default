import { ChevronLeft, Menu, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import BaseballDiamond from '../components/baseball/BaseballDiamond'
import {
  BaseballEndGameSheet,
  BaseballEndHalfSheet,
  BaseballReopenSheet,
  type BaseballEndGameDraft,
  type BaseballEndHalfDraft,
} from '../components/baseball/BaseballEndSheets'
import BaseballHandChoice from '../components/baseball/BaseballHandChoice'
import BaseballInPlaySheet from '../components/baseball/BaseballInPlaySheet'
import BaseballLineupPanel from '../components/baseball/BaseballLineupPanel'
import BaseballPlayDetailSheet from '../components/baseball/BaseballPlayDetailSheet'
import BaseballPitchingChangeSheet, { type BaseballPitchingChangeDraft } from '../components/baseball/BaseballPitchingChangeSheet'
import BaseballPitchPad from '../components/baseball/BaseballPitchPad'
import BaseballQuickPlateAppearance from '../components/baseball/BaseballQuickPlateAppearance'
import BaseballRecentPlays from '../components/baseball/BaseballRecentPlays'
import BaseballRunnerResolution from '../components/baseball/BaseballRunnerResolution'
import BaseballScoreboard from '../components/baseball/BaseballScoreboard'
import BaseballSubstitutionSheet from '../components/baseball/BaseballSubstitutionSheet'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import {
  BASEBALL_GAME_END_LABELS,
  baseballCanEndHalf,
  baseballCanReopen,
  baseballEndGameOptions,
  baseballOpponentPitcherChange,
  baseballPendingEndMessage,
  baseballPendingEndOutcome,
  baseballPitchingChangeOptions,
  baseballPlayDetail,
  baseballPlayerGameDetail,
  baseballBatterHand,
  baseballOpponentLineupView,
  baseballSubstitutionChoices,
  baseballTrackedLineupView,
  emptyBaseballSubstitutionDraft,
  selectedBaseballSubstitution,
  baseballRecentPlays,
  canRestoreBaseballPlay,
  canUndoBaseballPlay,
  endBaseballGame,
  endBaseballHalfInning,
  reopenBaseballGame,
  restoreBaseballPlay,
  undoBaseballPlay,
  baseballCaptureTerminal,
  baseballDiamondView,
  baseballDroppedThirdStrikeAvailable,
  baseballBaserunningPlayOptions,
  baseballCaptureAllowsRbi,
  baseballCaptureFallbackReason,
  baseballCaptureReasons,
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
  type BaseballBase,
  type BaseballBatHand,
  type BaseballBaserunningPlay,
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
  type BaseballSubstitutionDraft,
  type BaseballSubstitutionKind,
} from '../lib/baseball'
import { createBaseballUuid } from '../lib/baseball/id'

const BATTING_FORMAT_LABELS: Record<string, string> = {
  standard: 'Standard (nine bat)',
  designated_hitter: 'Designated hitter',
  extra_hitter: 'Extra hitters',
  continuous: 'Continuous order',
}

const BASE_LABELS: Record<BaseballBase, string> = { first: 'first', second: 'second', third: 'third' }

const PENDING_END_REASON = 'The game can end here. Record the ending, or undo the last play.'

type PlateCapture = Exclude<BaseballPendingCapture, { source: 'baserunning' }>

/** What the recorder is doing below the diamond. Nothing is written until a step commits. */
type CaptureFlow =
  | { step: 'idle' }
  | { step: 'dropped_third'; capture: Extract<BaseballPendingCapture, { source: 'pitch' }> }
  | { step: 'in_play'; capture: PlateCapture; draft: BaseballInPlayDraft }
  | { step: 'runner_menu'; base: BaseballBase; runnerId: string }
  | { step: 'quick' }
  | { step: 'resolve'; capture: BaseballPendingCapture; draft: BaseballResolutionDraft; error: string | null }
  | { step: 'opponent_label'; draft: OpponentSlotDraft; error: string | null }
  | { step: 'pitching_change'; draft: BaseballPitchingChangeDraft; error: string | null }
  | { step: 'end_half'; draft: BaseballEndHalfDraft; error: string | null }
  | { step: 'end_game'; draft: BaseballEndGameDraft; error: string | null }
  | { step: 'reopen'; reason: string; error: string | null }
  | { step: 'play_detail'; playId: string }

interface OpponentSlotDraft {
  slotId: string
  label: string
  number: string
  bats: BaseballBatHand | null
}

/** What the Lineup tab has open. Nothing is written until a sheet confirms. */
type LineupSheet =
  | { type: 'none' }
  | { type: 'substitute'; draft: BaseballSubstitutionDraft; error: string | null }
  | { type: 'pitching'; draft: BaseballPitchingChangeDraft; error: string | null }
  | { type: 'opponent_slot'; draft: OpponentSlotDraft; error: string | null }
  | { type: 'player'; id: string }

type TrackerTab = 'track' | 'lineup'

/**
 * The live Baseball tracker: the scoreboard strip, the diamond and the pitch pad showing
 * the current projection (BSB-3A), with pitches, the in-play sheet, runner resolution and
 * Quick PA (BSB-3B), runner plays between pitches (BSB-3C), and endings, pitching changes,
 * Recent plays with Undo and Restore (BSB-3D).
 */
export default function BaseballGameTracker() {
  const { state } = useGame()
  // Existing event games stay reachable at every release stage; only new games are gated.
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
  // Switching tabs writes nothing, and a sheet open on Track stays open (BSB-4A).
  const [tab, setTab] = useState<TrackerTab>('track')
  const [lineupSheet, setLineupSheet] = useState<LineupSheet>({ type: 'none' })
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
      baseballCaptureFallbackReason(sport, capture)
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

  const onBattedBall = (capture: PlateCapture, battedBall: BaseballBattedBall) =>
    openResolution({ ...capture, battedBall })

  const openBaserunning = (play: BaseballBaserunningPlay, runnerId: string) =>
    openResolution({ source: 'baserunning', play, runnerId })

  const resolutionTitle = (capture: BaseballPendingCapture) => {
    if (capture.source === 'baserunning') {
      return baseballBaserunningPlayOptions(setup.rulesSnapshot).find(option => option.play === capture.play)?.label ?? 'Runner play'
    }
    return baseballCaptureTerminal(sport, capture) === null ? 'Runners on this pitch' : 'Where everyone ends up'
  }

  const confirmResolution = () => {
    if (flow.step !== 'resolve') return
    const issues = Object.values(baseballResolutionIssues(flow.draft.rows))
    if (issues.length > 0) {
      setFlow({ ...flow, error: issues[0]! })
      return
    }
    const result = commitBaseballCapture(state, flow.capture, baseballResolutionMovements(flow.draft.rows, { rbi: baseballCaptureAllowsRbi(sport, flow.capture) }), context())
    if (!result.ok) {
      // Keep every choice in place so the recorder can fix what the engine rejected.
      setFlow({ ...flow, error: result.message })
      return
    }
    applied(result)
    // A runner play is not a pitch: the pitch location and the "Runners moved" chip stay as they were.
    if (flow.capture.source === 'baserunning') setFlow({ step: 'idle' })
    else finishCapture()
  }

  const opponentSlotDraft = (slotId: string): OpponentSlotDraft | null => {
    const slot = projection.opponentSlotDetails[slotId]
    return slot ? { slotId, label: slot.label ?? '', number: slot.number ?? '', bats: slot.bats } : null
  }

  /** One `opponent_slot` change: label, number and hand together; the position is kept. */
  const saveOpponentSlot = (draft: OpponentSlotDraft) => {
    return substituteBaseball(state, 'opponent', {
      kind: 'opponent_slot',
      slotId: draft.slotId,
      label: draft.label.trim() || null,
      number: draft.number.trim() || null,
      position: projection.opponentSlotDetails[draft.slotId]?.position ?? null,
      bats: draft.bats,
    }, context())
  }

  const saveOpponentLabel = () => {
    if (flow.step !== 'opponent_label') return
    commitFlow(saveOpponentSlot(flow.draft))
  }

  /** Saves a menu flow, or keeps the sheet open with the engine's message. */
  const commitFlow = (result: BaseballCommandResult) => {
    if (!result.ok) {
      setFlow(previous => ('error' in previous ? { ...previous, error: result.message } : previous))
      return
    }
    applied(result)
    setFlow({ step: 'idle' })
  }

  const pitchingOptions = baseballPitchingChangeOptions(sport)

  const confirmPitchingChange = () => {
    if (flow.step !== 'pitching_change') return
    const { draft } = flow
    if (draft.side === 'tracked') {
      const option = [...pitchingOptions.bench, ...pitchingOptions.fielders].find(entry => entry.incomingId === draft.selectedId)
      if (option) commitFlow(substituteBaseball(state, 'tracked', option.substitution, context()))
      return
    }
    commitFlow(substituteBaseball(state, 'opponent', baseballOpponentPitcherChange(createBaseballUuid(), draft.label, draft.number, draft.throws), context()))
  }

  const substitutionChoices = baseballSubstitutionChoices(sport)
  const trackedLineup = baseballTrackedLineupView(sport)

  /** Saves a Lineup tab sheet, or keeps it open with the engine's message word for word. */
  const commitLineupSheet = (result: BaseballCommandResult) => {
    if (!result.ok) {
      setLineupSheet(previous => ('error' in previous ? { ...previous, error: result.message } : previous))
      return
    }
    applied(result)
    setLineupSheet({ type: 'none' })
  }

  const confirmLineupSheet = () => {
    if (lineupSheet.type === 'substitute') {
      const option = selectedBaseballSubstitution(substitutionChoices, lineupSheet.draft)
      if (option) commitLineupSheet(substituteBaseball(state, 'tracked', option.substitution, context()))
      return
    }
    if (lineupSheet.type === 'pitching') {
      const { draft } = lineupSheet
      if (draft.side === 'tracked') {
        const option = [...pitchingOptions.bench, ...pitchingOptions.fielders].find(entry => entry.incomingId === draft.selectedId)
        if (option) commitLineupSheet(substituteBaseball(state, 'tracked', option.substitution, context()))
        return
      }
      commitLineupSheet(substituteBaseball(state, 'opponent', baseballOpponentPitcherChange(createBaseballUuid(), draft.label, draft.number, draft.throws), context()))
      return
    }
    if (lineupSheet.type === 'opponent_slot') commitLineupSheet(saveOpponentSlot(lineupSheet.draft))
  }

  /** From the runner menu: the Lineup tab with that runner's substitution already chosen. */
  const openRunnerSubstitution = (kind: BaseballSubstitutionKind, groupKey: string) => {
    setFlow({ step: 'idle' })
    setError(null)
    setLineupSheet({ type: 'substitute', draft: emptyBaseballSubstitutionDraft(kind, groupKey), error: null })
    setTab('lineup')
  }

  const confirmEndHalf = () => {
    if (flow.step !== 'end_half' || !flow.draft.reason) return
    commitFlow(endBaseballHalfInning(state, flow.draft.reason, flow.draft.note.trim() || null, context()))
  }

  const confirmEndGame = () => {
    if (flow.step !== 'end_game' || !flow.draft.outcome) return
    commitFlow(endBaseballGame(state, flow.draft.outcome, context(), {
      forfeitWinner: flow.draft.outcome === 'forfeit' ? flow.draft.winner : null,
      note: flow.draft.note.trim() || null,
    }))
  }

  const confirmReopen = () => {
    if (flow.step !== 'reopen' || !flow.reason.trim()) return
    commitFlow(reopenBaseballGame(state, flow.reason.trim(), context()))
  }

  const recordPendingEnd = () => {
    if (!projection.pendingEnd) return
    applied(endBaseballGame(state, baseballPendingEndOutcome(projection.pendingEnd), context()))
  }

  const undo = () => {
    if (applied(undoBaseballPlay(state, new Date().toISOString()))) finishCapture()
  }
  const restore = () => {
    applied(restoreBaseballPlay(state, new Date().toISOString()))
  }

  /** Menu actions replace whatever was open below the diamond; nothing was written yet. */
  const openFromMenu = (next: CaptureFlow) => {
    setMenuOpen(false)
    setTab('track')
    setError(null)
    setFlow(next)
  }

  const rowNames = (rows: BaseballResolutionRow[]) =>
    Object.fromEntries(rows.map(row => [row.runnerId, baseballPersonLabel(sport, row.runnerId).name]))

  const batterSlot = diamond.batter ? projection.opponentSlotDetails[diamond.batter.id] : undefined
  const canCapture = inProgress && projection.pendingEnd === null
  const showRunnersMoved =
    Boolean(projection.bases.first || projection.bases.second || projection.bases.third) ||
    baseballDroppedThirdStrikeAvailable(sport)

  const profile = findBaseballRulesProfile(setup.rulesSnapshot.profileId)
  const pitcherName = (side: 'tracked' | 'opponent') => {
    const id = side === 'tracked' ? projection.lineups.tracked.defense['1'] : projection.lineups.opponent.pitcherId
    return id ? baseballPersonLabel(sport, id).name : 'No pitcher'
  }
  const endGameOptions = baseballEndGameOptions(projection)
  const result = projection.result
  const resultWinner = result?.winner === 'tie' ? 'Tie game' : result?.winner ? `${sideName(result.winner)} win` : null

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
        Preview. Double switches and the Timeline come next. This game stays on this device.
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
        <div role="tablist" aria-label="Tracker views" className="grid grid-cols-2 gap-1 rounded-md border border-line p-1">
          {(['track', 'lineup'] as const).map(entry => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              className={`min-h-10 rounded text-sm font-semibold ${tab === entry ? 'bg-accent text-accent-content' : 'text-content'}`}
              onClick={() => setTab(entry)}
            >
              {entry === 'track' ? 'Track' : 'Lineup'}
            </button>
          ))}
        </div>
      )}

      {projection.status !== 'pregame' && tab === 'lineup' && (
        <section className="space-y-3" aria-label="Lineup">
          {lineupSheet.type === 'substitute' && (
            <BaseballSubstitutionSheet
              teamName={names.tracked}
              choices={substitutionChoices}
              draft={lineupSheet.draft}
              onChange={draft => setLineupSheet({ type: 'substitute', draft, error: null })}
              onPitchingChange={pitchingOptions.pitcherId && canCapture
                ? () => setLineupSheet({ type: 'pitching', draft: { side: 'tracked', selectedId: null }, error: null })
                : null}
              error={lineupSheet.error}
              onCancel={() => setLineupSheet({ type: 'none' })}
              onConfirm={confirmLineupSheet}
            />
          )}
          {lineupSheet.type === 'pitching' && (
            <BaseballPitchingChangeSheet
              draft={lineupSheet.draft}
              onChange={draft => setLineupSheet({ type: 'pitching', draft, error: null })}
              options={pitchingOptions}
              teamName={sideName(lineupSheet.draft.side)}
              currentPitcher={pitcherName(lineupSheet.draft.side)}
              error={lineupSheet.error}
              onCancel={() => setLineupSheet({ type: 'none' })}
              onConfirm={confirmLineupSheet}
            />
          )}
          {lineupSheet.type === 'opponent_slot' && (
            <OpponentSlotSheet
              draft={lineupSheet.draft}
              onChange={draft => setLineupSheet({ type: 'opponent_slot', draft, error: null })}
              error={lineupSheet.error}
              onCancel={() => setLineupSheet({ type: 'none' })}
              onSave={confirmLineupSheet}
            />
          )}
          {lineupSheet.type === 'player' && (() => {
            const detail = baseballPlayerGameDetail(sport, lineupSheet.id)
            return detail && (
              <section className="space-y-2 rounded-md border border-line bg-surface p-3" aria-label="Player details">
                <h2 className="font-bold text-content">{detail.name}</h2>
                <p className="text-sm text-content-muted">{detail.role}</p>
                <ul className="space-y-1 text-sm text-content">
                  {detail.lines.map(line => <li key={line}>{line}</li>)}
                </ul>
                <button type="button" className="btn-secondary w-full" onClick={() => setLineupSheet({ type: 'none' })} autoFocus>Close</button>
              </section>
            )
          })()}
          <BaseballLineupPanel
            tracked={trackedLineup}
            opponent={baseballOpponentLineupView(sport)}
            names={names}
            canChange={canCapture && lineupSheet.type === 'none'}
            substituteHint={!inProgress
              ? 'Substitutions are made while the game is in progress.'
              : projection.pendingEnd
                ? 'Record the ending, or undo the last play, before substituting.'
                : null}
            onSubstitute={() => setLineupSheet({ type: 'substitute', draft: emptyBaseballSubstitutionDraft(), error: null })}
            onOpponentPitchingChange={() => setLineupSheet({ type: 'pitching', draft: { side: 'opponent', label: '', number: '', throws: null }, error: null })}
            onSelectPlayer={id => setLineupSheet({ type: 'player', id })}
            onEditOpponentSlot={id => {
              const draft = opponentSlotDraft(id)
              if (draft) setLineupSheet({ type: 'opponent_slot', draft, error: null })
            }}
          />
        </section>
      )}

      {projection.status !== 'pregame' && tab === 'track' && (
        <>
          {inProgress && projection.battingSide === 'opponent' && trackedLineup.openPositions.length > 0 && flow.step === 'idle' && (
            <div role="status" className="flex items-center gap-2 rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
              <span className="flex-1">Fill {trackedLineup.openPositions.join(', ')} before the next pitch.</span>
              <button type="button" className="btn-secondary min-h-10 px-3" onClick={() => setTab('lineup')}>Lineup</button>
            </div>
          )}
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
                : (flow.step === 'idle' || flow.step === 'runner_menu') && canCapture
                  ? base => {
                    const runnerId = projection.bases[base]?.runnerId
                    if (runnerId) setFlow({ step: 'runner_menu', base, runnerId })
                  }
                  : undefined}
              onEditBatter={flow.step === 'idle' && canCapture && batterSlot
                ? () => {
                  const draft = opponentSlotDraft(batterSlot.id)
                  if (draft) setFlow({ step: 'opponent_label', draft, error: null })
                }
                : undefined}
            />
          </section>

          {inProgress && projection.pendingEnd && flow.step === 'idle' && (
            <section className="space-y-2 rounded-md border border-accent bg-surface p-3" aria-label="Game can end">
              <h2 className="font-bold text-content">{baseballPendingEndMessage(projection.pendingEnd)}</h2>
              <p className="text-sm text-content-muted">
                Play is paused until the ending is recorded. If the last play was wrong, undo it first.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary" disabled={!canUndoBaseballPlay(state)} onClick={undo}>Undo last play</button>
                <button type="button" className="btn-primary" onClick={recordPendingEnd}>End game</button>
              </div>
            </section>
          )}

          {result && (
            <section className="space-y-2 rounded-md border border-line bg-surface p-3" aria-label="Result">
              <h2 className="text-lg font-bold text-content">{BASEBALL_GAME_END_LABELS[result.outcome]}</h2>
              <p className="text-sm text-content">
                {names.tracked} {projection.score.tracked}, {names.opponent} {projection.score.opponent}
                {resultWinner && <span className="text-content-muted"> · {resultWinner}</span>}
              </p>
              {result.note && <p className="text-sm text-content-muted">{result.note}</p>}
              {flow.step === 'idle' && baseballCanReopen(projection) && (
                <button type="button" className="btn-secondary w-full" onClick={() => openFromMenu({ step: 'reopen', reason: '', error: null })}>
                  Reopen game
                </button>
              )}
            </section>
          )}

          {inProgress && flow.step === 'idle' && (
            <>
              <BaseballPitchPad
                showZone={capturePreferences.trackPitchLocation}
                pendingLocation={pitchLocation}
                onLocation={setPitchLocation}
                onResult={canCapture ? onPitchResult : undefined}
                disabledReason={PENDING_END_REASON}
                batterHand={baseballBatterHand(sport)}
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

          {flow.step === 'runner_menu' && (
            <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Runner play">
              <h2 className="font-bold text-content">
                {diamond.runners[flow.base]?.name ?? 'Runner'} on {BASE_LABELS[flow.base]}
              </h2>
              <p className="text-sm text-content-muted">
                A play with no pitch. For a steal or wild pitch on a pitch, use "Runners moved" on the pad instead.
              </p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Plays">
                {baseballBaserunningPlayOptions(setup.rulesSnapshot).map(option => (
                  <button
                    key={option.play}
                    type="button"
                    className="btn-secondary min-h-11 px-1 text-sm leading-tight"
                    onClick={() => openBaserunning(option.play, flow.runnerId)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {(['pinch_runner', 'courtesy_runner'] as const).some(kind =>
                substitutionChoices[kind].some(group => group.key === `${kind === 'pinch_runner' ? 'pr' : 'cr'}:${flow.runnerId}`)) && (
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Substitute runner">
                  {(['pinch_runner', 'courtesy_runner'] as const).map(kind => {
                    const groupKey = `${kind === 'pinch_runner' ? 'pr' : 'cr'}:${flow.runnerId}`
                    if (!substitutionChoices[kind].some(group => group.key === groupKey)) return null
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="btn-secondary min-h-11 px-1 text-sm leading-tight"
                        onClick={() => openRunnerSubstitution(kind, groupKey)}
                      >
                        {kind === 'pinch_runner' ? 'Pinch runner' : 'Courtesy runner'}
                      </button>
                    )
                  })}
                </div>
              )}
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
              title={resolutionTitle(flow.capture)}
              draft={flow.draft}
              onChange={updateResolution}
              names={rowNames(flow.draft.rows)}
              reasons={baseballCaptureReasons(sport, flow.capture)}
              allowRbi={baseballCaptureAllowsRbi(sport, flow.capture)}
              fielderCount={fielderCount}
              error={flow.error}
              // Cancel writes nothing; the "Runners moved" chip stays armed.
              onCancel={() => setFlow({ step: 'idle' })}
              onConfirm={confirmResolution}
            />
          )}

          {flow.step === 'opponent_label' && (
            <OpponentSlotSheet
              draft={flow.draft}
              onChange={draft => setFlow({ ...flow, draft, error: null })}
              error={flow.error}
              onCancel={() => setFlow({ step: 'idle' })}
              onSave={saveOpponentLabel}
            />
          )}

          {flow.step === 'pitching_change' && (
            <BaseballPitchingChangeSheet
              draft={flow.draft}
              onChange={draft => setFlow({ ...flow, draft, error: null })}
              options={pitchingOptions}
              teamName={sideName(flow.draft.side)}
              currentPitcher={pitcherName(flow.draft.side)}
              error={flow.error}
              onCancel={() => setFlow({ step: 'idle' })}
              onConfirm={confirmPitchingChange}
            />
          )}

          {flow.step === 'end_half' && (
            <BaseballEndHalfSheet
              draft={flow.draft}
              onChange={draft => setFlow({ ...flow, draft, error: null })}
              halfLabel={baseballScoreboardView(sport, names).halfLabel}
              error={flow.error}
              onCancel={() => setFlow({ step: 'idle' })}
              onConfirm={confirmEndHalf}
            />
          )}

          {flow.step === 'end_game' && (
            <BaseballEndGameSheet
              draft={flow.draft}
              onChange={draft => setFlow({ ...flow, draft, error: null })}
              options={endGameOptions}
              names={names}
              error={flow.error}
              onCancel={() => setFlow({ step: 'idle' })}
              onConfirm={confirmEndGame}
            />
          )}

          {flow.step === 'reopen' && (
            <BaseballReopenSheet
              reason={flow.reason}
              onChange={reason => setFlow({ ...flow, reason, error: null })}
              error={flow.error}
              onCancel={() => setFlow({ step: 'idle' })}
              onConfirm={confirmReopen}
            />
          )}

          {flow.step === 'play_detail' && (() => {
            const detail = baseballPlayDetail(state, flow.playId, names)
            return detail
              ? <BaseballPlayDetailSheet detail={detail} onClose={() => setFlow({ step: 'idle' })} />
              : (
                <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Play details">
                  <p className="text-sm text-content-muted">This play is no longer recorded.</p>
                  <button type="button" className="btn-secondary w-full" onClick={() => setFlow({ step: 'idle' })}>Close</button>
                </section>
              )
          })()}

          {flow.step === 'idle' && (
            <BaseballRecentPlays
              rows={baseballRecentPlays(state, names)}
              canRestore={canRestoreBaseballPlay(state)}
              onUndo={undo}
              onRestore={restore}
              onSelect={playId => setFlow({ step: 'play_detail', playId })}
            />
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
          {inProgress && (
            <>
              <MenuAction
                label={`${names.tracked} pitching change`}
                disabled={!pitchingOptions.pitcherId}
                onClick={() => openFromMenu({ step: 'pitching_change', draft: { side: 'tracked', selectedId: null }, error: null })}
              />
              <MenuAction
                label={`${names.opponent} pitching change`}
                onClick={() => openFromMenu({ step: 'pitching_change', draft: { side: 'opponent', label: '', number: '', throws: null }, error: null })}
              />
              {baseballCanEndHalf(projection) && (
                <MenuAction
                  label="End half-inning"
                  onClick={() => openFromMenu({ step: 'end_half', draft: { reason: null, note: '' }, error: null })}
                />
              )}
              <MenuAction
                label="End game"
                onClick={() => openFromMenu({
                  step: 'end_game',
                  draft: { outcome: projection.pendingEnd ? baseballPendingEndOutcome(projection.pendingEnd) : null, note: '', winner: null },
                  error: null,
                })}
              />
            </>
          )}
          {baseballCanReopen(projection) && (
            <MenuAction label="Reopen game" onClick={() => openFromMenu({ step: 'reopen', reason: '', error: null })} />
          )}
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

function MenuAction({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn-secondary w-full min-h-11 text-left" disabled={disabled} onClick={onClick}>
      {label}
    </button>
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

function OpponentSlotSheet({
  draft,
  onChange,
  error,
  onCancel,
  onSave,
}: {
  draft: OpponentSlotDraft
  onChange: (draft: OpponentSlotDraft) => void
  error: string | null
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Opponent batter">
      <h2 className="font-bold text-content">Opponent batter</h2>
      <p className="text-sm text-content-muted">A label and hand for this batting slot. The lineup does not change.</p>
      <label className="block space-y-1 text-sm font-semibold text-content">
        <span>Name or label</span>
        <input
          className="input-field"
          value={draft.label}
          maxLength={60}
          onChange={event => onChange({ ...draft, label: event.target.value })}
        />
      </label>
      <label className="block space-y-1 text-sm font-semibold text-content">
        <span>Number</span>
        <input
          className="input-field"
          inputMode="numeric"
          value={draft.number}
          maxLength={4}
          onChange={event => onChange({ ...draft, number: event.target.value })}
        />
      </label>
      <BaseballHandChoice
        legend="Bats"
        options={['L', 'R', 'S']}
        value={draft.bats}
        onChange={bats => onChange({ ...draft, bats })}
      />
      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onSave}>Save</button>
      </div>
    </section>
  )
}

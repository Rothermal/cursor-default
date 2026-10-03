import { useState } from 'react'
import {
  BASEBALL_MORE_PITCH_RESULTS,
  BASEBALL_PRIMARY_PITCH_RESULTS,
  addBaseballResolutionFielder,
  baseballBaserunningPlayOptions,
  baseballCaptureAllowsRbi,
  baseballCaptureEdit,
  baseballCaptureReasons,
  baseballCaptureTerminal,
  baseballDiamondView,
  baseballDroppedThirdStrikeAvailable,
  baseballEditResolutionRows,
  baseballInPlayDraftFrom,
  baseballPersonLabel,
  baseballResolutionIssues,
  baseballResolutionMovements,
  baseballScoreAdjustmentEdit,
  baseballSubstitutionChoices,
  baseballSubstitutionEdit,
  baseballSubstitutionEditDraft,
  cycleBaseballResolutionDraftRow,
  selectedBaseballSubstitution,
  type BaseballBatHand,
  type BaseballBaserunningPlay,
  type BaseballEditTarget,
  type BaseballEventEdit,
  type BaseballInPlayDraft,
  type BaseballPendingCapture,
  type BaseballPitchHand,
  type BaseballPitchLocation,
  type BaseballPitchResult,
  type BaseballQuickPlateAppearanceResult,
  type BaseballResolutionDraft,
  type BaseballResolutionTransition,
  type BaseballSubstitution,
  type BaseballSubstitutionDraft,
} from '../../lib/baseball'
import BaseballChip from './BaseballChip'
import BaseballDiamond from './BaseballDiamond'
import BaseballHandChoice from './BaseballHandChoice'
import BaseballInPlaySheet from './BaseballInPlaySheet'
import BaseballPitchPad from './BaseballPitchPad'
import BaseballQuickPlateAppearance from './BaseballQuickPlateAppearance'
import BaseballRunnerResolution from './BaseballRunnerResolution'
import BaseballSubstitutionSheet from './BaseballSubstitutionSheet'

interface BaseballEditPlayProps {
  target: BaseballEditTarget
  /** The Timeline row being edited. */
  label: string
  halfLabel: string
  names: { tracked: string; opponent: string }
  /** The recorder's location preferences; a location already recorded is always shown. */
  trackPitchLocation: boolean
  trackBattedBallLocation: boolean
  onCancel: () => void
  /** The finished edit; the tracker previews it (section 4.1) before anything is saved. */
  onPreview: (edit: BaseballEventEdit) => void
}

type PlateCapture = Exclude<BaseballPendingCapture, { source: 'baserunning' }>

type Step =
  | { step: 'pitch' }
  | { step: 'dropped_third'; capture: Extract<BaseballPendingCapture, { source: 'pitch' }> }
  | { step: 'quick' }
  | { step: 'baserunning'; play: BaseballBaserunningPlay }
  | { step: 'in_play'; capture: PlateCapture; draft: BaseballInPlayDraft }
  | { step: 'resolve'; capture: BaseballPendingCapture; draft: BaseballResolutionDraft; error: string | null }
  | { step: 'substitution'; draft: BaseballSubstitutionDraft; error: string | null }
  | { step: 'opponent'; change: Extract<BaseballSubstitution, { kind: 'opponent_pitcher' | 'opponent_slot' }> }
  | { step: 'score'; delta: string; reason: string; error: string | null }

const PITCH_LABELS = Object.fromEntries(
  [...BASEBALL_PRIMARY_PITCH_RESULTS, ...BASEBALL_MORE_PITCH_RESULTS].map(option => [option.result, option.label])
) as Record<string, string>

/**
 * Edit any play (BSB-4D): the sheet the play was recorded with, seeded from the stored event
 * and run against the game as it stood just before it, so proposals, legal reasons and RBI
 * rules match capture time. Nothing is written here; the finished edit goes to the preview.
 */
export default function BaseballEditPlay({
  target,
  label,
  halfLabel,
  names,
  trackPitchLocation,
  trackBattedBallLocation,
  onCancel,
  onPreview,
}: BaseballEditPlayProps) {
  const { prefix, seed } = target
  const fielderCount = prefix.setup.rulesSnapshot.defensivePlayers
  const choices = baseballSubstitutionChoices(prefix)
  const [step, setStep] = useState<Step>(() => initialStep(target, choices))
  const [pitchLocation, setPitchLocation] = useState<BaseballPitchLocation | null>(
    seed.kind === 'capture' && seed.capture.source === 'pitch' ? seed.capture.pitchLocation : null
  )
  const seedCapture = seed.kind === 'capture' ? seed.capture : null
  const seedBattedBall = seedCapture && seedCapture.source !== 'baserunning' ? seedCapture.battedBall : null
  const showZone = trackPitchLocation || (seedCapture?.source === 'pitch' && seedCapture.pitchLocation !== null)
  const showSpray = trackBattedBallLocation || Boolean(seedBattedBall?.location)
  const diamond = baseballDiamondView(prefix)
  const sideName = (side: 'tracked' | 'opponent') => names[side]

  /** Runner rows for the edited capture; with no runner to place, straight to the preview. */
  const resolve = (capture: BaseballPendingCapture) => {
    const rows = baseballEditResolutionRows(target, capture)
    if (rows.length === 0) {
      onPreview(baseballCaptureEdit(target, capture, []))
      return
    }
    setStep({
      step: 'resolve',
      capture,
      draft: { rows, activeRunnerId: rows.find(row => row.to === 'out' && row.fielders.length === 0)?.runnerId ?? null },
      error: null,
    })
  }

  const inPlayDraft = () => baseballInPlayDraftFrom(seedBattedBall)

  const onPitchResult = (result: BaseballPitchResult) => {
    const capture = {
      source: 'pitch' as const,
      result,
      pitchLocation: showZone ? pitchLocation : null,
      battedBall: null,
      droppedThirdStrike: false,
    }
    if (result === 'in_play') {
      setStep({ step: 'in_play', capture, draft: inPlayDraft() })
      return
    }
    if (baseballCaptureTerminal(prefix, capture) === 'strikeout' && baseballDroppedThirdStrikeAvailable(prefix)) {
      setStep({ step: 'dropped_third', capture })
      return
    }
    resolve(capture)
  }

  const onQuickResult = (choice: { result: BaseballQuickPlateAppearanceResult; finalBalls: number | null; finalStrikes: number | null }) => {
    const capture = { source: 'quick' as const, battedBall: null, ...choice }
    if (choice.result === 'in_play') {
      setStep({ step: 'in_play', capture, draft: inPlayDraft() })
      return
    }
    resolve(capture)
  }

  const updateInPlay = (edit: (draft: BaseballInPlayDraft) => BaseballInPlayDraft) =>
    setStep(previous => (previous.step === 'in_play' ? { ...previous, draft: edit(previous.draft) } : previous))
  const updateResolution = (transition: BaseballResolutionTransition) =>
    setStep(previous => (previous.step === 'resolve' ? { ...previous, draft: transition(previous.draft), error: null } : previous))

  const confirmResolution = () => {
    if (step.step !== 'resolve') return
    const issues = Object.values(baseballResolutionIssues(step.draft.rows))
    if (issues.length > 0) {
      setStep({ ...step, error: issues[0]! })
      return
    }
    const movements = baseballResolutionMovements(step.draft.rows, { rbi: baseballCaptureAllowsRbi(prefix, step.capture) })
    onPreview(baseballCaptureEdit(target, step.capture, movements))
  }

  const rowNames = (ids: string[]) => Object.fromEntries(ids.map(id => [id, baseballPersonLabel(prefix, id).name]))

  const header = (
    <div>
      <h2 className="font-bold text-content">Edit: {label}</h2>
      <p className="text-xs text-content-muted">{halfLabel} · the game as it stood before this play</p>
    </div>
  )

  const showDiamond = step.step === 'in_play' || step.step === 'resolve'

  return (
    <section className="space-y-3" aria-label="Edit play">
      {header}
      {showDiamond && (
        <BaseballDiamond
          view={diamond}
          battingLabel={sideName(prefix.projection.battingSide)}
          fieldingLabel={sideName(diamond.fieldingSide)}
          pendingLocation={step.step === 'in_play' ? step.draft.location : null}
          onLocation={step.step === 'in_play' && showSpray
            ? location => updateInPlay(draft => ({ ...draft, location: { x: location.x, y: location.y } }))
            : undefined}
          onFielder={step.step === 'in_play'
            ? position => updateInPlay(draft => ({ ...draft, fielders: [...draft.fielders, position] }))
            : step.step === 'resolve' && step.draft.activeRunnerId
              ? position => updateResolution(addBaseballResolutionFielder(position))
              : undefined}
          onRunner={step.step === 'resolve'
            ? base => {
              const runnerId = prefix.projection.bases[base]?.runnerId
              if (runnerId) updateResolution(cycleBaseballResolutionDraftRow(runnerId))
            }
            : undefined}
        />
      )}

      {step.step === 'pitch' && seedCapture?.source === 'pitch' && (
        <>
          <p className="text-sm text-content">
            Recorded: <span className="font-semibold">{PITCH_LABELS[seedCapture.result] ?? 'Pitch'}</span>. Choose the right result
            {showZone ? ', and move the location if it was wrong' : ''}.
          </p>
          <BaseballPitchPad
            showZone={showZone}
            pendingLocation={pitchLocation}
            onLocation={setPitchLocation}
            onResult={onPitchResult}
          />
          <button type="button" className="btn-secondary w-full" onClick={onCancel}>Cancel</button>
        </>
      )}

      {step.step === 'dropped_third' && (
        <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Strike three">
          <h2 className="font-bold text-content">Strike three</h2>
          <p className="text-sm text-content-muted">Did the catcher hold the ball?</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary px-2" onClick={() => resolve(step.capture)}>Strikeout</button>
            <button type="button" className="btn-secondary px-2" onClick={() => resolve({ ...step.capture, droppedThirdStrike: true })}>
              Dropped third strike
            </button>
          </div>
          <button type="button" className="btn-secondary w-full" onClick={() => setStep({ step: 'pitch' })}>Back</button>
        </section>
      )}

      {step.step === 'quick' && seedCapture?.source === 'quick' && (
        <BaseballQuickPlateAppearance
          ballsForWalk={prefix.setup.rulesSnapshot.ballsForWalk}
          strikesForStrikeout={prefix.setup.rulesSnapshot.strikesForStrikeout}
          initial={{ result: seedCapture.result, finalBalls: seedCapture.finalBalls, finalStrikes: seedCapture.finalStrikes }}
          onCancel={onCancel}
          onContinue={onQuickResult}
        />
      )}

      {step.step === 'baserunning' && seedCapture?.source === 'baserunning' && (
        <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Runner play">
          <h2 className="font-bold text-content">{baseballPersonLabel(prefix, seedCapture.runnerId).name}</h2>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Plays">
            {baseballBaserunningPlayOptions(prefix.setup.rulesSnapshot).map(option => (
              <BaseballChip
                key={option.play}
                label={option.label}
                selected={step.play === option.play}
                onClick={() => setStep({ step: 'baserunning', play: option.play })}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => resolve({ source: 'baserunning', play: step.play, runnerId: seedCapture.runnerId })}
            >
              Runners
            </button>
          </div>
        </section>
      )}

      {step.step === 'in_play' && (
        <BaseballInPlaySheet
          draft={step.draft}
          onChange={draft => updateInPlay(() => draft)}
          trackLocation={showSpray}
          fielderCount={fielderCount}
          onCancel={onCancel}
          onContinue={battedBall => resolve({ ...step.capture, battedBall })}
        />
      )}

      {step.step === 'resolve' && (
        <BaseballRunnerResolution
          title={baseballCaptureTerminal(prefix, step.capture) === null ? 'Runners on this play' : 'Where everyone ends up'}
          draft={step.draft}
          onChange={updateResolution}
          names={rowNames(step.draft.rows.map(row => row.runnerId))}
          reasons={baseballCaptureReasons(prefix, step.capture)}
          allowRbi={baseballCaptureAllowsRbi(prefix, step.capture)}
          fielderCount={fielderCount}
          error={step.error}
          onCancel={onCancel}
          onConfirm={confirmResolution}
        />
      )}

      {step.step === 'substitution' && (
        <>
          {!step.draft.kind && (
            <p className="text-sm text-content-muted">
              The recorded change is not one of the choices before this play. Choose the change that was made.
            </p>
          )}
          <BaseballSubstitutionSheet
            teamName={names.tracked}
            choices={choices}
            draft={step.draft}
            onChange={draft => setStep({ step: 'substitution', draft, error: null })}
            onPitchingChange={null}
            error={step.error}
            onCancel={onCancel}
            onConfirm={() => {
              const option = selectedBaseballSubstitution(choices, step.draft)
              if (option) onPreview(baseballSubstitutionEdit(target, option.changes))
            }}
          />
        </>
      )}

      {step.step === 'opponent' && (
        <OpponentChangeForm
          change={step.change}
          onChange={change => setStep({ step: 'opponent', change })}
          onCancel={onCancel}
          onContinue={() => onPreview(baseballSubstitutionEdit(target, [trimOpponentChange(step.change)]))}
        />
      )}

      {step.step === 'score' && (
        <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Score adjustment">
          <label className="block space-y-1 text-sm font-semibold text-content">
            <span>Runs (use a minus sign to take runs away)</span>
            <input
              className="input-field"
              inputMode="numeric"
              value={step.delta}
              onChange={event => setStep({ ...step, delta: event.target.value, error: null })}
            />
          </label>
          <label className="block space-y-1 text-sm font-semibold text-content">
            <span>Reason</span>
            <input
              className="input-field"
              value={step.reason}
              maxLength={200}
              onChange={event => setStep({ ...step, reason: event.target.value, error: null })}
            />
          </label>
          {step.error && (
            <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{step.error}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const delta = Number(step.delta.trim())
                if (!Number.isInteger(delta) || delta === 0 || !step.reason.trim()) {
                  setStep({ ...step, error: 'Enter a whole number of runs other than zero, and a reason.' })
                  return
                }
                onPreview(baseballScoreAdjustmentEdit(target, delta, step.reason.trim()))
              }}
            >
              Preview
            </button>
          </div>
        </section>
      )}
    </section>
  )
}

function initialStep(target: BaseballEditTarget, choices: ReturnType<typeof baseballSubstitutionChoices>): Step {
  const { seed } = target
  if (seed.kind === 'score') return { step: 'score', delta: String(seed.delta), reason: seed.reason, error: null }
  if (seed.kind === 'substitution') {
    const only = seed.changes.length === 1 ? seed.changes[0] : null
    if (only && (only.kind === 'opponent_pitcher' || only.kind === 'opponent_slot')) return { step: 'opponent', change: only }
    return { step: 'substitution', draft: baseballSubstitutionEditDraft(choices, seed.changes), error: null }
  }
  switch (seed.capture.source) {
    case 'pitch':
      return { step: 'pitch' }
    case 'quick':
      return { step: 'quick' }
    case 'baserunning':
      return { step: 'baserunning', play: seed.capture.play }
  }
}

/** An opponent change's label, number and hand; the slot or pitcher stays the same. */
function OpponentChangeForm({
  change,
  onChange,
  onCancel,
  onContinue,
}: {
  change: Extract<BaseballSubstitution, { kind: 'opponent_pitcher' | 'opponent_slot' }>
  onChange: (change: Extract<BaseballSubstitution, { kind: 'opponent_pitcher' | 'opponent_slot' }>) => void
  onCancel: () => void
  onContinue: () => void
}) {
  const pitcher = change.kind === 'opponent_pitcher'
  const label = pitcher ? change.pitcher.label : change.label
  const number = pitcher ? change.pitcher.number : change.number
  const set = (patch: { label?: string | null; number?: string | null; hand?: 'L' | 'R' | 'S' | null }) => {
    if (change.kind === 'opponent_pitcher') {
      onChange({
        ...change,
        pitcher: {
          ...change.pitcher,
          ...('label' in patch ? { label: patch.label ?? null } : {}),
          ...('number' in patch ? { number: patch.number ?? null } : {}),
          ...('hand' in patch ? { throws: (patch.hand ?? null) as BaseballPitchHand | null } : {}),
        },
      })
      return
    }
    onChange({
      ...change,
      ...('label' in patch ? { label: patch.label ?? null } : {}),
      ...('number' in patch ? { number: patch.number ?? null } : {}),
      ...('hand' in patch ? { bats: (patch.hand ?? null) as BaseballBatHand | null } : {}),
    })
  }
  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label={pitcher ? 'Opponent pitcher' : 'Opponent batter'}>
      <h2 className="font-bold text-content">{pitcher ? 'Opponent pitcher' : 'Opponent batter'}</h2>
      <label className="block space-y-1 text-sm font-semibold text-content">
        <span>Name or label</span>
        <input className="input-field" value={label ?? ''} maxLength={60} onChange={event => set({ label: event.target.value || null })} />
      </label>
      <label className="block space-y-1 text-sm font-semibold text-content">
        <span>Number</span>
        <input
          className="input-field"
          inputMode="numeric"
          value={number ?? ''}
          maxLength={4}
          onChange={event => set({ number: event.target.value || null })}
        />
      </label>
      <BaseballHandChoice
        legend={pitcher ? 'Throws' : 'Bats'}
        options={pitcher ? ['L', 'R'] : ['L', 'R', 'S']}
        value={pitcher ? change.pitcher.throws : change.bats}
        onChange={hand => set({ hand })}
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onContinue}>Preview</button>
      </div>
    </section>
  )
}

function trimOpponentChange(
  change: Extract<BaseballSubstitution, { kind: 'opponent_pitcher' | 'opponent_slot' }>
): Extract<BaseballSubstitution, { kind: 'opponent_pitcher' | 'opponent_slot' }> {
  const trim = (value: string | null) => value?.trim() || null
  return change.kind === 'opponent_pitcher'
    ? { ...change, pitcher: { ...change.pitcher, label: trim(change.pitcher.label), number: trim(change.pitcher.number) } }
    : { ...change, label: trim(change.label), number: trim(change.number) }
}

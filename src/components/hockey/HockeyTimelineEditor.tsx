import { X } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import type { GameState } from '../../types'
import {
  addHockeyEvents,
  correctHockeyEvents,
  formatHockeyClock,
  formatHockeyFinalScore,
  HOCKEY_FACEOFF_DOT_IDS,
  hockeyActivePeriod,
  hockeyAdditionScene,
  hockeyDisplayFromElapsed,
  hockeyElapsedFromDisplay,
  hockeyFaceoffDotLabel,
  hockeyPlaceablePeriods,
  hockeyUnitPlacement,
  parseHockeyClockText,
  type HockeyFaceoffDotId,
  type HockeyPlaceTarget,
  hockeyGoalieChangeCorrection,
  hasHockeyCorrectionConsequences,
  hockeyAvailableParticipants,
  hockeyCorrectionConsequences,
  hockeyCorrectionInput,
  hockeyCorrectionScene,
  hockeyGoalieChoices,
  hockeyOpponentGoalieLabel,
  hockeyParticipantLabel,
  hockeyRemovalDependents,
  hockeyRestoreDependents,
  hockeyScorerChoices,
  hockeySkaterChoices,
  hockeyTimeline,
  removeHockeyEvents,
  restoreHockeyEvents,
  type HockeyActorChoice,
  type HockeyCorrectionResult,
  type HockeyGoalieRepair,
  type HockeyCorrectionConsequences,
  type HockeyCorrectionInput,
  type HockeyCorrectionScene,
  type HockeyGoalieChangeReason,
  type HockeyShootoutOutcome,
  type HockeySide,
  type HockeySideLabels,
  type HockeyTimelineRow,
} from '../../lib/hockey'
import HockeyGoalieDialog from './HockeyGoalieDialog'
import HockeyPenaltyDialog from './HockeyPenaltyDialog'
import HockeyPlayDialog, { type HockeyPlayDialogKind } from './HockeyPlayDialog'
import HockeyShotDialog from './HockeyShotDialog'
import { ActorField, Choices, Group } from './hockeyFields'

/** Row actions, plus Add (HKY-4C), which has no row. */
export type HockeyTimelineAction = 'edit' | 'move' | 'remove' | 'restore' | 'add'

interface HockeyTimelineEditorProps {
  state: GameState
  /** Null only for Add. */
  row: HockeyTimelineRow | null
  action: HockeyTimelineAction
  labels: HockeySideLabels
  recentOpponentLabels: string[]
  recorderUserId: string | null
  /** Saves the corrected game. */
  onApply: (next: GameState) => void
  onClose: () => void
}

/**
 * A change built twice: with the later shots restamped to the goalie in net, and without.
 * Each is a whole checked candidate; nothing in between is ever saved.
 */
interface Staged {
  repaired: HockeyCorrectionResult
  plain: HockeyCorrectionResult
  consequences: HockeyCorrectionConsequences
  repairs: HockeyGoalieRepair[]
  /** The change only replays with the restamp (a shot names a goalie it takes out of the game). */
  repairRequired: boolean
  /** Set when the change itself is refused. */
  error?: string
}

interface Pending {
  title: string
  staged: Staged
  /** Other rows that change with this one (dependents), as labels. */
  alsoChanges: string[]
  /** Restore only: removed early releases that can come back too. */
  releases: string[]
  withReleases: boolean
  updateGoalies: boolean
}

function stage(before: GameState, run: (updateGoalies: boolean) => HockeyCorrectionResult): Staged {
  const repaired = run(true)
  const plain = run(false)
  const usable = repaired.ok ? repaired : plain
  return {
    repaired,
    plain,
    consequences: hockeyCorrectionConsequences(before, usable.state),
    repairs: repaired.ok ? repaired.goalieRepairs : [],
    repairRequired: repaired.ok && !plain.ok,
    ...(usable.ok ? {} : { error: repaired.ok ? undefined : repaired.message }),
  }
}

function stagedNext(pending: Pending): GameState | null {
  const { repaired, plain, repairRequired } = pending.staged
  const chosen = pending.updateGoalies || repairRequired ? repaired : plain
  return chosen.ok ? chosen.state : null
}

/**
 * Timeline corrections (HKY-4B): the family's capture dialog in edit mode, or a remove or
 * restore confirmation, then a consequence preview before anything is saved. Each step
 * recomputes from the current game, so nothing stale is saved.
 */
export default function HockeyTimelineEditor({
  state,
  row,
  action,
  labels,
  recentOpponentLabels,
  recorderUserId,
  onApply,
  onClose,
}: HockeyTimelineEditorProps) {
  const ids = useMemo(() => row?.events.map(event => event.id) ?? [], [row])
  const initial = useMemo(() => (action === 'edit' && row ? hockeyCorrectionInput(row.events) : null), [action, row])
  const scene = useMemo(() => (action === 'edit' ? hockeyCorrectionScene(state, ids) : null), [action, state, ids])
  const timeline = useMemo(() => hockeyTimeline(state, labels), [state, labels])
  const [pending, setPending] = useState<Pending | null>(() =>
    (action === 'remove' || action === 'restore') && row ? confirmation(state, row, action, labels) : null)
  // Add (HKY-4C): the family and time picked in the When step.
  const [adding, setAdding] = useState<{ family: HockeyAddFamily; place: HockeyPlaceTarget } | null>(null)
  const addScene = useMemo(() => (adding ? hockeyAdditionScene(state, adding.place) : null), [adding, state])
  const [error, setError] = useState<string | null>(null)

  const labelOf = (eventId: string) => timeline.rows.find(entry => entry.events.some(event => event.id === eventId))?.label ?? 'An event'

  /** Applies a change with nothing else to show, or opens the preview. */
  const review = (title: string, staged: Staged): string | null => {
    if (staged.error) return staged.error
    if (!hasHockeyCorrectionConsequences(staged.consequences) && staged.repairs.length === 0) {
      onApply((staged.plain.ok ? staged.plain : staged.repaired).state)
      return null
    }
    setPending({ title, staged, alsoChanges: [], releases: [], withReleases: false, updateGoalies: true })
    return null
  }

  const edit = (correction: HockeyCorrectionInput): string | null => {
    const now = new Date().toISOString()
    return review('Save this change?', stage(state, updateGoalies =>
      correctHockeyEvents(state, ids, correction, { recorderUserId, now, updateGoalies })))
  }

  const add = (correction: HockeyCorrectionInput): string | null => {
    if (!adding) return null
    const now = new Date().toISOString()
    return review('Add this event?', stage(state, updateGoalies =>
      addHockeyEvents(state, correction, adding.place, { recorderUserId, now, updateGoalies })))
  }

  const move = (place: HockeyPlaceTarget): string | null => {
    const correction = row ? hockeyCorrectionInput(row.events) : null
    if (!correction) return 'This row cannot be moved.'
    const now = new Date().toISOString()
    return review('Move this event?', stage(state, updateGoalies =>
      correctHockeyEvents(state, ids, correction, { recorderUserId, now, updateGoalies, place })))
  }

  const save = () => {
    if (!pending) return
    const next = stagedNext(pending)
    if (!next) return setError('This change cannot be saved without updating those shots.')
    onApply(next)
  }

  if (pending) {
    return (
      <HockeyCorrectionPreview
        pending={pending}
        labels={labels}
        names={timeline.names}
        labelOf={labelOf}
        error={error}
        onChange={change => setPending(current => {
          if (!current) return current
          if (action !== 'restore' || change.withReleases === undefined) return { ...current, ...change }
          // Early releases change the box, so the preview is rebuilt with or without them.
          const withReleases = change.withReleases
          const now = new Date().toISOString()
          return {
            ...current,
            ...change,
            staged: stage(state, updateGoalies => restoreHockeyEvents(state, ids, { withReleases, updateGoalies }, now)),
          }
        })}
        onSave={save}
        onClose={onClose}
      />
    )
  }

  if (action === 'move' && row) {
    const goalie = row.events.some(event => event.eventType === 'hockey.goalie_change')
    return (
      <HockeyWhenSheet
        state={state}
        title={`Change time: ${row.label}`}
        families={null}
        allowPeriodStart={goalie}
        start={hockeyUnitPlacement(row.events) ?? { periodId: row.periodId, elapsedMs: row.events[0].elapsedMs, placement: 'game_time' }}
        submitLabel="Review changes"
        onSubmit={(_family, place) => move(place)}
        onClose={onClose}
      />
    )
  }

  if (action === 'add') {
    if (!adding) {
      return (
        <HockeyWhenSheet
          state={state}
          title="Add a missed event"
          families={ADD_FAMILIES}
          allowPeriodStart
          start={null}
          submitLabel="Next"
          onSubmit={(family, place) => {
            setAdding({ family, place })
            return null
          }}
          onClose={onClose}
        />
      )
    }
    if (!addScene) {
      return (
        <EditSheet title="Add a missed event" onClose={onClose}>
          <p className="text-sm text-content-muted">Events cannot be added here. The game before this time needs repair first.</p>
        </EditSheet>
      )
    }
    return (
      <HockeyCorrectionForm
        initial={additionInitial(adding.family)}
        adding
        scene={addScene}
        labels={labels}
        recentOpponentLabels={recentOpponentLabels}
        onSubmit={add}
        onClose={onClose}
      />
    )
  }

  if (!initial || !scene) {
    return (
      <EditSheet title="Edit" onClose={onClose}>
        <p className="text-sm text-content-muted">This row cannot be edited. The game before it needs repair first.</p>
      </EditSheet>
    )
  }
  return (
    <HockeyCorrectionForm
      initial={initial}
      adding={false}
      scene={scene}
      labels={labels}
      recentOpponentLabels={recentOpponentLabels}
      onSubmit={edit}
      onClose={onClose}
    />
  )
}

type HockeyAddFamily = 'shot' | 'penalties' | 'play' | 'faceoff' | 'goalie_change'

const ADD_FAMILIES: Array<{ value: HockeyAddFamily; label: string }> = [
  { value: 'shot', label: 'Shot' },
  { value: 'penalties', label: 'Penalty' },
  { value: 'play', label: 'Play' },
  { value: 'faceoff', label: 'Faceoff' },
  { value: 'goalie_change', label: 'Goalie' },
]

/** A blank form for each family; the dialogs fill in the rest. */
function additionInitial(family: HockeyAddFamily): HockeyCorrectionInput | null {
  switch (family) {
    case 'faceoff':
      return { kind: 'faceoff', input: { dotId: 'center', winner: 'tracked', takerParticipantId: null, opponentTakerLabel: null } }
    case 'goalie_change':
      return { kind: 'goalie_change', input: { side: 'tracked', inParticipantId: null, reason: 'tactical', newOpponentGoalie: null } }
    case 'shot':
      return { kind: 'shot', input: { side: 'tracked', outcome: 'saved' } }
    case 'penalties':
      return { kind: 'penalties', input: { penalties: [] } }
    case 'play':
      return { kind: 'play', input: { kind: 'hit', side: 'tracked' } }
  }
}

/**
 * The family's form: the capture dialog for shots, penalties and plays, or a short form.
 * Adding (HKY-4C) opens the same forms blank; editing opens them prefilled.
 */
function HockeyCorrectionForm({
  initial,
  adding,
  scene,
  labels,
  recentOpponentLabels,
  onSubmit,
  onClose,
}: {
  initial: HockeyCorrectionInput | null
  adding: boolean
  scene: HockeyCorrectionScene
  labels: HockeySideLabels
  recentOpponentLabels: string[]
  onSubmit: (correction: HockeyCorrectionInput) => string | null
  onClose: () => void
}) {
  if (!initial) return null
  const shared = {
    recentOpponentLabels,
    trackedLabel: labels.tracked,
    opponentLabel: labels.opponent,
    onClose,
  }
  switch (initial.kind) {
    case 'shot':
      return (
        <HockeyShotDialog
          {...shared}
          draft={{ side: initial.input.side, location: initial.input.location ?? null }}
          sport={scene.sport}
          events={scene.events}
          derivedStrength={scene.derivedStrength}
          onIceLimits={scene.onIceLimits}
          initial={adding ? undefined : initial.input}
          onSubmit={input => onSubmit({ kind: 'shot', input })}
        />
      )
    case 'penalties':
      return (
        <HockeyPenaltyDialog
          {...shared}
          sport={scene.sport}
          initial={adding ? undefined : initial.input}
          onSubmit={input => onSubmit({ kind: 'penalties', input })}
        />
      )
    case 'play':
    case 'team_event':
    case 'timeout': {
      const kind: HockeyPlayDialogKind = initial.kind === 'play' ? initial.input.kind : initial.kind === 'timeout' ? 'timeout' : initial.input.kind
      return (
        <HockeyPlayDialog
          {...shared}
          draft={{ kind, location: null }}
          sport={scene.sport}
          initial={adding ? undefined : {
            kind,
            side: initial.input.side,
            player: initial.kind === 'play' ? initial.input.player ?? null : null,
            hitPlayer: initial.kind === 'play' ? initial.input.hitPlayer ?? null : null,
            location: initial.kind === 'timeout' ? null : initial.input.location ?? null,
          }}
          onSubmit={input => onSubmit({ kind: 'play', input })}
          onTeamSubmit={input => onSubmit(input.kind === 'timeout'
            ? { kind: 'timeout', input: { side: input.side } }
            : { kind: 'team_event', input: { kind: input.kind, side: input.side, location: input.location } })}
        />
      )
    }
    case 'goalie_change':
      if (adding) {
        return (
          <HockeyGoalieDialog
            sport={scene.sport}
            trackedLabel={labels.tracked}
            opponentLabel={labels.opponent}
            onSubmit={change => onSubmit({
              kind: 'goalie_change',
              input: {
                side: change.side,
                inParticipantId: change.inParticipantId,
                reason: change.inParticipantId === null ? 'pulled' : 'tactical',
                newOpponentGoalie: change.newOpponentGoalie ?? null,
              },
            })}
            onClose={onClose}
          />
        )
      }
      return <SimpleEdit initial={initial} adding={false} scene={scene} labels={labels} recentOpponentLabels={recentOpponentLabels} onSubmit={onSubmit} onClose={onClose} />
    default:
      return <SimpleEdit initial={initial} adding={adding} scene={scene} labels={labels} recentOpponentLabels={recentOpponentLabels} onSubmit={onSubmit} onClose={onClose} />
  }
}

/** The remove or restore confirmation, with what else changes. */
function confirmation(
  state: GameState,
  row: HockeyTimelineRow,
  action: 'remove' | 'restore',
  labels: HockeySideLabels
): Pending {
  const ids = row.events.map(event => event.id)
  const now = new Date().toISOString()
  const timeline = hockeyTimeline(state, labels)
  const labelOf = (eventId: string) => timeline.rows.find(entry => entry.events.some(event => event.id === eventId))?.label ?? 'An event'
  if (action === 'remove') {
    const staged = stage(state, updateGoalies => removeHockeyEvents(state, ids, now, { updateGoalies }))
    return {
      title: `Remove ${row.label}?`,
      staged,
      alsoChanges: staged.error ? [] : unique(hockeyRemovalDependents(state, ids).map(event => labelOf(event.id))),
      releases: [],
      withReleases: false,
      updateGoalies: true,
    }
  }
  const dependents = hockeyRestoreDependents(state, ids)
  const withReleases = dependents.releases.length > 0
  return {
    title: `Restore ${row.label}?`,
    staged: stage(state, updateGoalies => restoreHockeyEvents(state, ids, { withReleases, updateGoalies }, now)),
    alsoChanges: unique(dependents.attempts.map(event => labelOf(event.id))),
    releases: unique(dependents.releases.map(event => labelOf(event.id))),
    withReleases,
    updateGoalies: true,
  }
}

function HockeyCorrectionPreview({
  pending,
  labels,
  names,
  labelOf,
  error,
  onChange,
  onSave,
  onClose,
}: {
  pending: Pending
  labels: HockeySideLabels
  names: Readonly<Record<string, string>>
  labelOf: (eventId: string) => string
  error: string | null
  onChange: (change: Partial<Pending>) => void
  onSave: () => void
  onClose: () => void
}) {
  const { consequences, repairs, repairRequired } = pending.staged
  const blocked = pending.staged.error ?? null
  const name = (id: string | null) => (id === null ? 'an empty net' : names[id] ?? 'Unknown player')
  const strengthName = { ev: 'even strength', pp: 'power play', sh: 'short-handed' } as const
  const items: ReactNode[] = []
  if (consequences.score) {
    const { before, after } = consequences.score
    items.push(`Score: ${labels.tracked} ${before.tracked}-${before.opponent} ${labels.opponent} becomes ${after.tracked}-${after.opponent}.`)
  }
  if (consequences.result) {
    const describe = (result: typeof consequences.result.before) =>
      result ? `${result.outcome} ${formatHockeyFinalScore(result)}` : 'no result'
    items.push(`Result: ${describe(consequences.result.before)} becomes ${describe(consequences.result.after)}.`)
  }
  if (consequences.suddenDeath) {
    items.push(consequences.suddenDeath === 'decided'
      ? 'A goal now decides sudden-death overtime.'
      : 'Sudden-death overtime is no longer decided.')
  }
  for (const entry of consequences.removedPlayers.added) items.push(`${name(entry)} is now removed from the game.`)
  for (const entry of consequences.removedPlayers.cleared) items.push(`${name(entry)} is no longer removed from the game.`)
  for (const entry of consequences.strength) {
    items.push(`${labelOf(entry.eventId)} is stored as ${strengthName[entry.stored]}, but the penalty box now says ${strengthName[entry.derived]}. Edit the goal to change it.`)
  }
  return (
    <EditSheet title={pending.title} onClose={onClose}>
      {blocked ? (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{blocked}</p>
      ) : (
        <>
          {pending.alsoChanges.length > 0 && (
            <div className="text-sm">
              <p className="font-semibold text-content">Also changes</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-content-muted">
                {pending.alsoChanges.map(label => <li key={label}>{label}</li>)}
              </ul>
            </div>
          )}
          {pending.releases.length > 0 && (
            <label className="flex items-start gap-2 text-sm text-content">
              <input type="checkbox" className="mt-1" checked={pending.withReleases} onChange={event => onChange({ withReleases: event.target.checked })} />
              <span>Also restore {pending.releases.join(', ')}</span>
            </label>
          )}
          {items.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-content">
              {items.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          )}
          {repairs.length > 0 && (
            <div className="space-y-1 rounded-md border border-line p-3 text-sm">
              <p className="font-semibold text-content">Shots now recorded against a goalie who was not in net</p>
              <ul className="list-disc space-y-0.5 pl-5 text-content-muted">
                {repairs.map(entry => (
                  <li key={entry.eventId}>{labelOf(entry.eventId)}: {name(entry.recordedParticipantId)}, {entry.resolvedParticipantId === null ? 'net empty' : `in net ${name(entry.resolvedParticipantId)}`}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2 pt-1 text-content">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={pending.updateGoalies || repairRequired}
                  disabled={repairRequired}
                  onChange={event => onChange({ updateGoalies: event.target.checked })}
                />
                <span>Update the goalie on these shots</span>
              </label>
              {repairRequired && (
                <p className="text-xs text-content-muted">Needed: these shots name a goalie this change takes out of the game.</p>
              )}
            </div>
          )}
          {items.length === 0 && repairs.length === 0 && pending.alsoChanges.length === 0 && pending.releases.length === 0 && (
            <p className="text-sm text-content-muted">Nothing else changes.</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={Boolean(blocked)} onClick={onSave}>
          {pending.title.startsWith('Remove') ? 'Remove' : pending.title.startsWith('Restore') ? 'Restore' : 'Save'}
        </button>
      </div>
    </EditSheet>
  )
}

/** Goalie changes, faceoffs, score adjustments and the shootout: short forms of their own. */
function SimpleEdit({
  initial,
  adding,
  scene,
  labels,
  recentOpponentLabels,
  onSubmit,
  onClose,
}: {
  initial: HockeyCorrectionInput
  adding: boolean
  scene: HockeyCorrectionScene
  labels: HockeySideLabels
  recentOpponentLabels: string[]
  onSubmit: (correction: HockeyCorrectionInput) => string | null
  onClose: () => void
}) {
  const { setup, projection } = scene.sport
  const [error, setError] = useState<string | null>(null)
  const sideOptions = (['tracked', 'opponent'] as const).map(value => ({ value, label: labels[value] }))
  const submit = (correction: HockeyCorrectionInput) => {
    const message = onSubmit(correction)
    if (message) setError(message)
  }
  const footer = (onClick: () => void) => (
    <>
      {error && <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>}
      <button type="button" className="btn-primary w-full" onClick={onClick}>{adding ? 'Review' : 'Review changes'}</button>
    </>
  )

  if (initial.kind === 'goalie_change') {
    return <GoalieEdit initial={initial.input} scene={scene} labels={labels} onSubmit={submit} onClose={onClose} footer={footer} />
  }
  if (initial.kind === 'faceoff') {
    return <FaceoffEdit initial={initial.input} adding={adding} scene={scene} labels={labels} recentOpponentLabels={recentOpponentLabels} onSubmit={submit} onClose={onClose} footer={footer} />
  }
  if (initial.kind === 'score_adjustment') {
    return <ScoreAdjustmentEdit initial={initial.input} labels={labels} onSubmit={submit} onClose={onClose} footer={footer} />
  }
  if (initial.kind === 'shootout_start') {
    return <ShootoutStartEdit initial={initial.input.firstSide} sideOptions={sideOptions} onSubmit={submit} onClose={onClose} footer={footer} />
  }
  if (initial.kind === 'shootout_attempt') {
    const side = projection.shootout?.nextSide ?? 'tracked'
    return (
      <ShootoutAttemptEdit
        initial={initial.input}
        side={side}
        sideLabel={labels[side]}
        trackedOptions={hockeyAvailableParticipants(hockeySkaterChoices(setup), projection)}
        recentOpponentLabels={recentOpponentLabels}
        onSubmit={submit}
        onClose={onClose}
        footer={footer}
      />
    )
  }
  return null
}

type Footer = (onClick: () => void) => ReactNode

const GOALIE_REASONS: Array<{ value: HockeyGoalieChangeReason; label: string }> = [
  { value: 'tactical', label: 'Change' },
  { value: 'injury', label: 'Injury' },
  { value: 'pulled', label: 'Pulled' },
  { value: 'return', label: 'Back in net' },
  { value: 'penalty', label: 'Penalty' },
]

function GoalieEdit({
  initial,
  scene,
  labels,
  onSubmit,
  onClose,
  footer,
}: {
  initial: Extract<HockeyCorrectionInput, { kind: 'goalie_change' }>['input']
  scene: HockeyCorrectionScene
  labels: HockeySideLabels
  onSubmit: (correction: HockeyCorrectionInput) => void
  onClose: () => void
  footer: Footer
}) {
  const { setup, projection } = scene.sport
  const [inNet, setInNet] = useState(initial.inParticipantId ?? '')
  const [reason, setReason] = useState<HockeyGoalieChangeReason>(initial.reason)
  const [newNumber, setNewNumber] = useState(initial.newOpponentGoalie?.number ?? '')
  const [newLabel, setNewLabel] = useState(initial.newOpponentGoalie?.label ?? '')
  const added = initial.newOpponentGoalie
  const choices = initial.side === 'tracked'
    ? hockeyAvailableParticipants(hockeyGoalieChoices(setup), projection).map(participant => ({ id: participant.id, label: hockeyParticipantLabel(participant) }))
    : [
        ...projection.opponentGoalies.map(goalie => ({ id: goalie.id, label: hockeyOpponentGoalieLabel(goalie) })),
        ...(added ? [{ id: added.id, label: 'The goalie added here' }] : []),
      ]
  const submit = () => onSubmit(hockeyGoalieChangeCorrection(initial, {
    inParticipantId: inNet || null,
    reason: reason === 'pulled' ? 'tactical' : reason,
    label: newLabel,
    number: newNumber,
  }))
  return (
    <EditSheet title={`Edit ${labels[initial.side]} goalie change`} onClose={onClose}>
      <label className="block text-sm font-semibold text-content">
        In net
        <select className="input-field mt-1 w-full" value={inNet} onChange={event => setInNet(event.target.value)}>
          {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          <option value="">Empty net (goalie pulled)</option>
        </select>
      </label>
      {inNet && (
        <Group label="Reason">
          <Choices options={GOALIE_REASONS.filter(entry => entry.value !== 'pulled')} value={reason === 'pulled' ? 'tactical' : reason} onChange={setReason} columns={2} />
        </Group>
      )}
      {added && inNet === added.id && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase text-content-muted">Goalie added here</legend>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
            <input className="input-field" aria-label="Number" placeholder="#" maxLength={3} value={newNumber} onChange={event => setNewNumber(event.target.value)} />
            <input className="input-field" aria-label="Name" placeholder="Name (optional)" maxLength={80} value={newLabel} onChange={event => setNewLabel(event.target.value)} />
          </div>
        </fieldset>
      )}
      {footer(submit)}
    </EditSheet>
  )
}

function FaceoffEdit({
  initial,
  adding,
  scene,
  labels,
  recentOpponentLabels,
  onSubmit,
  onClose,
  footer,
}: {
  initial: Extract<HockeyCorrectionInput, { kind: 'faceoff' }>['input']
  adding: boolean
  scene: HockeyCorrectionScene
  labels: HockeySideLabels
  recentOpponentLabels: string[]
  onSubmit: (correction: HockeyCorrectionInput) => void
  onClose: () => void
  footer: Footer
}) {
  const { setup, projection } = scene.sport
  const [dotId, setDotId] = useState<HockeyFaceoffDotId>(initial.dotId)
  const direction = hockeyActivePeriod(projection)?.trackedAttackingDirection ?? null
  const [winner, setWinner] = useState<HockeySide>(initial.winner)
  const [taker, setTaker] = useState(initial.takerParticipantId ?? '')
  const [opponentTaker, setOpponentTaker] = useState(initial.opponentTakerLabel ?? '')
  const submit = () => onSubmit({
    kind: 'faceoff',
    input: { dotId, winner, takerParticipantId: taker || null, opponentTakerLabel: opponentTaker.trim() || null },
  })
  return (
    <EditSheet title={adding ? 'Add faceoff' : 'Edit faceoff'} onClose={onClose}>
      {adding && (
        <label className="block text-sm font-semibold text-content">
          Dot
          <select className="input-field mt-1 w-full" value={dotId} onChange={event => setDotId(event.target.value as HockeyFaceoffDotId)}>
            {HOCKEY_FACEOFF_DOT_IDS.map(id => <option key={id} value={id}>{hockeyFaceoffDotLabel(id, direction, labels)}</option>)}
          </select>
        </label>
      )}
      <Group label="Won by">
        <Choices options={(['tracked', 'opponent'] as const).map(value => ({ value, label: labels[value] }))} value={winner} onChange={setWinner} />
      </Group>
      <ActorField
        label={`${labels.tracked} taker`}
        owner="tracked"
        value={taker}
        onChange={setTaker}
        trackedOptions={hockeyAvailableParticipants(hockeySkaterChoices(setup), projection)}
        recentLabels={recentOpponentLabels}
        emptyLabel="Unknown"
      />
      <ActorField
        label={`${labels.opponent} taker`}
        owner="opponent"
        value={opponentTaker}
        onChange={setOpponentTaker}
        trackedOptions={[]}
        recentLabels={recentOpponentLabels}
        emptyLabel="Unknown"
      />
      {footer(submit)}
    </EditSheet>
  )
}

function ScoreAdjustmentEdit({
  initial,
  labels,
  onSubmit,
  onClose,
  footer,
}: {
  initial: Extract<HockeyCorrectionInput, { kind: 'score_adjustment' }>['input']
  labels: HockeySideLabels
  onSubmit: (correction: HockeyCorrectionInput) => void
  onClose: () => void
  footer: Footer
}) {
  const [side, setSide] = useState<HockeySide>(initial.side)
  const [delta, setDelta] = useState<'1' | '-1'>(initial.delta === 1 ? '1' : '-1')
  const [reason, setReason] = useState(initial.reason)
  const reasonId = useId()
  const submit = () => onSubmit({ kind: 'score_adjustment', input: { side, delta: delta === '1' ? 1 : -1, reason } })
  return (
    <EditSheet title="Edit score adjustment" onClose={onClose}>
      <Group label="Team">
        <Choices options={(['tracked', 'opponent'] as const).map(value => ({ value, label: labels[value] }))} value={side} onChange={setSide} />
      </Group>
      <Group label="Change">
        <Choices options={[{ value: '1' as const, label: '+1' }, { value: '-1' as const, label: '-1' }]} value={delta} onChange={setDelta} />
      </Group>
      <div>
        <label htmlFor={reasonId} className="block text-sm font-semibold text-content">Reason</label>
        <input id={reasonId} className="input-field mt-1 w-full" maxLength={200} value={reason} onChange={event => setReason(event.target.value)} />
      </div>
      {footer(submit)}
    </EditSheet>
  )
}

function ShootoutStartEdit({
  initial,
  sideOptions,
  onSubmit,
  onClose,
  footer,
}: {
  initial: HockeySide
  sideOptions: Array<{ value: HockeySide; label: string }>
  onSubmit: (correction: HockeyCorrectionInput) => void
  onClose: () => void
  footer: Footer
}) {
  const [firstSide, setFirstSide] = useState<HockeySide>(initial)
  return (
    <EditSheet title="Edit shootout start" onClose={onClose}>
      <Group label="Shoots first">
        <Choices options={sideOptions} value={firstSide} onChange={setFirstSide} />
      </Group>
      {footer(() => onSubmit({ kind: 'shootout_start', input: { firstSide } }))}
    </EditSheet>
  )
}

const SHOOTOUT_OUTCOMES: Array<{ value: HockeyShootoutOutcome; label: string }> = [
  { value: 'goal', label: 'Goal' },
  { value: 'saved', label: 'Saved' },
  { value: 'missed', label: 'Missed' },
]

function ShootoutAttemptEdit({
  initial,
  side,
  sideLabel,
  trackedOptions,
  recentOpponentLabels,
  onSubmit,
  onClose,
  footer,
}: {
  initial: Extract<HockeyCorrectionInput, { kind: 'shootout_attempt' }>['input']
  side: HockeySide
  sideLabel: string
  trackedOptions: ReturnType<typeof hockeyScorerChoices>
  recentOpponentLabels: string[]
  onSubmit: (correction: HockeyCorrectionInput) => void
  onClose: () => void
  footer: Footer
}) {
  const [outcome, setOutcome] = useState<HockeyShootoutOutcome>(initial.outcome)
  const [shooter, setShooter] = useState(choiceText(initial.shooter))
  const submit = () => {
    const trimmed = shooter.trim()
    const choice: HockeyActorChoice | null = !trimmed ? null : side === 'tracked' ? { participantId: trimmed } : { label: trimmed }
    onSubmit({ kind: 'shootout_attempt', input: { outcome, shooter: choice } })
  }
  return (
    <EditSheet title={`Edit ${sideLabel} shootout attempt`} onClose={onClose}>
      <ActorField label="Shooter" owner={side} value={shooter} onChange={setShooter} trackedOptions={trackedOptions} recentLabels={recentOpponentLabels} emptyLabel="Not named" />
      <Group label="Result">
        <Choices options={SHOOTOUT_OUTCOMES} value={outcome} onChange={setOutcome} columns={3} />
      </Group>
      {footer(submit)}
    </EditSheet>
  )
}

function EditSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.5] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-bold text-content">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>
        <div className="space-y-4 p-4">{children}</div>
      </div>
    </div>
  )
}

function choiceText(choice: HockeyActorChoice | null | undefined): string {
  if (!choice) return ''
  return 'participantId' in choice ? choice.participantId : choice.label
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * The When step (HKY-4C): the period and the clock time as the game shows it, or the start of
 * the period for a goalie change. Add also picks the kind of event first.
 */
function HockeyWhenSheet({
  state,
  title,
  families,
  allowPeriodStart,
  start,
  submitLabel,
  onSubmit,
  onClose,
}: {
  state: GameState
  title: string
  families: Array<{ value: HockeyAddFamily; label: string }> | null
  allowPeriodStart: boolean
  start: HockeyPlaceTarget | null
  submitLabel: string
  onSubmit: (family: HockeyAddFamily, place: HockeyPlaceTarget) => string | null
  onClose: () => void
}) {
  const periods = useMemo(() => hockeyPlaceablePeriods(state, new Date().toISOString()), [state])
  const startPeriod = periods.find(period => period.periodId === start?.periodId) ?? periods[periods.length - 1]
  const [family, setFamily] = useState<HockeyAddFamily>(families?.[0].value ?? 'shot')
  const [periodId, setPeriodId] = useState(startPeriod?.periodId ?? '')
  const [atStart, setAtStart] = useState(start?.placement === 'period_start')
  const [clockText, setClockText] = useState(() =>
    startPeriod && start?.elapsedMs !== null && start?.elapsedMs !== undefined
      ? formatHockeyClock(hockeyDisplayFromElapsed(startPeriod, start.elapsedMs))
      : '')
  const [error, setError] = useState<string | null>(null)
  const period = periods.find(entry => entry.periodId === periodId) ?? null
  const clocked = period?.playedMs !== null && period?.playedMs !== undefined
  const periodStart = allowPeriodStart && (families === null || family === 'goalie_change')

  const submit = () => {
    if (!period) return setError('Pick a period that has started.')
    let place: HockeyPlaceTarget
    if (periodStart && atStart) {
      place = { periodId: period.periodId, elapsedMs: clocked ? 0 : null, placement: 'period_start' }
    } else if (!clocked) {
      place = { periodId: period.periodId, elapsedMs: null, placement: 'game_time' }
    } else {
      const displayMs = parseHockeyClockText(clockText)
      const elapsedMs = displayMs === null ? null : hockeyElapsedFromDisplay(period, displayMs)
      if (elapsedMs === null) return setError(`Enter a clock time from 0:00 to ${formatHockeyClock(period.durationMs)}, like 12:34.`)
      if (period.playedMs !== null && elapsedMs > period.playedMs) return setError('That time has not been played yet in this period.')
      place = { periodId: period.periodId, elapsedMs, placement: 'game_time' }
    }
    const message = onSubmit(family, place)
    setError(message)
  }

  return (
    <EditSheet title={title} onClose={onClose}>
      {families && (
        <Group label="Event">
          <Choices options={families} value={family} onChange={setFamily} columns={3} />
        </Group>
      )}
      <label className="block text-sm font-semibold text-content">
        Period
        <select className="input-field mt-1 w-full" value={periodId} onChange={event => setPeriodId(event.target.value)}>
          {periods.map(entry => <option key={entry.periodId} value={entry.periodId}>{entry.label}</option>)}
        </select>
      </label>
      {periodStart && (
        <label className="flex items-start gap-2 text-sm text-content">
          <input type="checkbox" className="mt-1" checked={atStart} onChange={event => setAtStart(event.target.checked)} />
          <span>
            At the start of the period
            <span className="block text-xs text-content-muted">Before every other event of the period, for the goalie who started it.</span>
          </span>
        </label>
      )}
      {!(periodStart && atStart) && (clocked ? (
        <label className="block text-sm font-semibold text-content">
          Clock {period?.countDown ? '(time left)' : '(time played)'}
          <input
            className="input-field mt-1 w-full tabular-nums"
            inputMode="numeric"
            placeholder={period?.countDown ? formatHockeyClock(period.durationMs) : '0:00'}
            value={clockText}
            onChange={event => setClockText(event.target.value)}
          />
          {period && period.playedMs !== null && period.playedMs < period.durationMs && (
            <span className="mt-1 block text-xs font-normal text-content-muted">
              Played so far: up to {formatHockeyClock(hockeyDisplayFromElapsed(period, period.playedMs))} on the clock.
            </span>
          )}
        </label>
      ) : (
        <p className="text-xs text-content-muted">This game has no clock, so the event goes at the end of the period.</p>
      ))}
      {error && <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>}
      <button type="button" className="btn-primary w-full" onClick={submit}>{submitLabel}</button>
    </EditSheet>
  )
}

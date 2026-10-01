import { X } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import type { GameState } from '../../types'
import {
  correctHockeyEvents,
  formatHockeyFinalScore,
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
import HockeyPenaltyDialog from './HockeyPenaltyDialog'
import HockeyPlayDialog, { type HockeyPlayDialogKind } from './HockeyPlayDialog'
import HockeyShotDialog from './HockeyShotDialog'
import { ActorField, Choices, Group } from './hockeyFields'

export type HockeyTimelineAction = 'edit' | 'remove' | 'restore'

interface HockeyTimelineEditorProps {
  state: GameState
  row: HockeyTimelineRow
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
  const ids = useMemo(() => row.events.map(event => event.id), [row.events])
  const initial = useMemo(() => (action === 'edit' ? hockeyCorrectionInput(row.events) : null), [action, row.events])
  const scene = useMemo(() => (action === 'edit' ? hockeyCorrectionScene(state, ids) : null), [action, state, ids])
  const timeline = useMemo(() => hockeyTimeline(state, labels), [state, labels])
  const [pending, setPending] = useState<Pending | null>(() => (action === 'edit' ? null : confirmation(state, row, action, labels)))
  const [error, setError] = useState<string | null>(null)

  const labelOf = (eventId: string) => timeline.rows.find(entry => entry.events.some(event => event.id === eventId))?.label ?? 'An event'

  const edit = (correction: HockeyCorrectionInput): string | null => {
    const now = new Date().toISOString()
    const staged = stage(state, updateGoalies => correctHockeyEvents(state, ids, correction, { recorderUserId, now, updateGoalies }))
    if (staged.error) return staged.error
    if (!hasHockeyCorrectionConsequences(staged.consequences) && staged.repairs.length === 0) {
      onApply((staged.plain.ok ? staged.plain : staged.repaired).state)
      return null
    }
    setPending({ title: 'Save this change?', staged, alsoChanges: [], releases: [], withReleases: false, updateGoalies: true })
    return null
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
  if (!initial || !scene) {
    return (
      <EditSheet title="Edit" onClose={onClose}>
        <p className="text-sm text-content-muted">This row cannot be edited. The game before it needs repair first.</p>
      </EditSheet>
    )
  }
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
          initial={initial.input}
          onSubmit={input => edit({ kind: 'shot', input })}
        />
      )
    case 'penalties':
      return (
        <HockeyPenaltyDialog
          {...shared}
          sport={scene.sport}
          initial={initial.input}
          onSubmit={input => edit({ kind: 'penalties', input })}
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
          initial={{
            kind,
            side: initial.input.side,
            player: initial.kind === 'play' ? initial.input.player ?? null : null,
            hitPlayer: initial.kind === 'play' ? initial.input.hitPlayer ?? null : null,
            location: initial.kind === 'timeout' ? null : initial.input.location ?? null,
          }}
          onSubmit={input => edit({ kind: 'play', input })}
          onTeamSubmit={input => edit(input.kind === 'timeout'
            ? { kind: 'timeout', input: { side: input.side } }
            : { kind: 'team_event', input: { kind: input.kind, side: input.side, location: input.location } })}
        />
      )
    }
    default:
      return <SimpleEdit initial={initial} scene={scene} labels={labels} recentOpponentLabels={recentOpponentLabels} onSubmit={edit} onClose={onClose} />
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
  scene,
  labels,
  recentOpponentLabels,
  onSubmit,
  onClose,
}: {
  initial: HockeyCorrectionInput
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
      <button type="button" className="btn-primary w-full" onClick={onClick}>Review changes</button>
    </>
  )

  if (initial.kind === 'goalie_change') {
    return <GoalieEdit initial={initial.input} scene={scene} labels={labels} onSubmit={submit} onClose={onClose} footer={footer} />
  }
  if (initial.kind === 'faceoff') {
    return <FaceoffEdit initial={initial.input} scene={scene} labels={labels} recentOpponentLabels={recentOpponentLabels} onSubmit={submit} onClose={onClose} footer={footer} />
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
  scene,
  labels,
  recentOpponentLabels,
  onSubmit,
  onClose,
  footer,
}: {
  initial: Extract<HockeyCorrectionInput, { kind: 'faceoff' }>['input']
  scene: HockeyCorrectionScene
  labels: HockeySideLabels
  recentOpponentLabels: string[]
  onSubmit: (correction: HockeyCorrectionInput) => void
  onClose: () => void
  footer: Footer
}) {
  const { setup, projection } = scene.sport
  const [winner, setWinner] = useState<HockeySide>(initial.winner)
  const [taker, setTaker] = useState(initial.takerParticipantId ?? '')
  const [opponentTaker, setOpponentTaker] = useState(initial.opponentTakerLabel ?? '')
  const submit = () => onSubmit({
    kind: 'faceoff',
    input: { dotId: initial.dotId, winner, takerParticipantId: taker || null, opponentTakerLabel: opponentTaker.trim() || null },
  })
  return (
    <EditSheet title="Edit faceoff" onClose={onClose}>
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

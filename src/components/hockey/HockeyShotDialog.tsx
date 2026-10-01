import { X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import HockeyLocationField from './HockeyLocationField'
import { ActorField, Choices, Group } from './hockeyFields'
import {
  HOCKEY_EMPTY_NET,
  HOCKEY_OUTCOME_LABELS,
  hockeyAvailableParticipants,
  hockeyGoalieChoices,
  hockeyOnIcePrefill,
  hockeyOpponentGoalieLabel,
  hockeyParticipantLabel,
  hockeyScorerChoices,
  hockeySkaterChoices,
  otherHockeySide,
  type HockeyActorChoice,
  type HockeyMatchParticipant,
  type HockeyMissType,
  type HockeyOnIce,
  type HockeyShotOutcome,
  type HockeySide,
  type HockeySportGameState,
  type HockeyOnIceLimits,
  type HockeyStrength,
  type RecordHockeyShotInput,
} from '../../lib/hockey'
import type { GameEvent } from '../../lib/gameEvents/types'

export interface HockeyShotDraft {
  side: HockeySide
  location: { x: number; y: number } | null
}

interface HockeyShotDialogProps {
  draft: HockeyShotDraft
  sport: HockeySportGameState
  events: readonly GameEvent[]
  recentOpponentLabels: string[]
  trackedLabel: string
  opponentLabel: string
  /** Goal strength read from the penalty box for a scoring side; null when there is no clock. */
  derivedStrength: (side: HockeySide) => HockeyStrength | null
  /** Skaters a complete tracked set may name right now, from the penalty box (HKY-3C). */
  onIceLimits: HockeyOnIceLimits | null
  /**
   * Edit mode (HKY-4B): the stored values. `sport` and `events` are then the game just before
   * the shot, so the goalie in net and available players are those of that moment.
   */
  initial?: RecordHockeyShotInput
  /** Returns an error message, or null once the shot is recorded. */
  onSubmit: (input: RecordHockeyShotInput) => string | null
  onClose: () => void
}

const OUTCOMES: HockeyShotOutcome[] = ['goal', 'saved', 'missed', 'blocked']
const STRENGTHS: Array<{ value: HockeyStrength; label: string; name: string }> = [
  { value: 'ev', label: 'Even', name: 'even strength' },
  { value: 'pp', label: 'Power play', name: 'a power play' },
  { value: 'sh', label: 'Short', name: 'short-handed' },
]
const MISS_TYPES: Array<{ value: HockeyMissType; label: string }> = [
  { value: 'wide', label: 'Wide' },
  { value: 'high', label: 'High' },
  { value: 'post', label: 'Post' },
  { value: 'crossbar', label: 'Crossbar' },
]

/**
 * Shot capture (HKY-2B). Tracked players are picked from every dressed player; opponent
 * players are typed labels with recent-label chips. The empty net is prefilled from the
 * goalie in net, and the on-ice section is optional and stored only when touched.
 */
export default function HockeyShotDialog({
  draft,
  sport,
  events,
  recentOpponentLabels,
  trackedLabel,
  opponentLabel,
  derivedStrength,
  onIceLimits,
  initial,
  onSubmit,
  onClose,
}: HockeyShotDialogProps) {
  const titleId = useId()
  const { setup, projection } = sport
  const editing = initial !== undefined
  const [side, setSide] = useState<HockeySide>(initial?.side ?? draft.side)
  const [outcome, setOutcome] = useState<HockeyShotOutcome>(initial?.outcome ?? 'saved')
  const [missType, setMissType] = useState<HockeyMissType | null>(initial?.missType ?? null)
  const [shooter, setShooter] = useState(choiceValue(initial?.shooter))
  const [assist1, setAssist1] = useState(choiceValue(initial?.assists?.[0]))
  const [assist2, setAssist2] = useState(choiceValue(initial?.assists?.[1]))
  const [blocker, setBlocker] = useState(choiceValue(initial?.blocker))
  const [penaltyShot, setPenaltyShot] = useState(initial?.penaltyShot ?? false)
  const [emptyNetOverride, setEmptyNetOverride] = useState<boolean | null>(initial?.emptyNet ?? null)
  const [strengthOverride, setStrengthOverride] = useState<HockeyStrength | null>(initial?.strength ?? null)
  const [location, setLocation] = useState(initial ? initial.location ?? null : draft.location)
  // Edit mode keeps the stored goalie; undefined means the goalie in net at the time.
  const [goalieFaced, setGoalieFaced] = useState<string | null | undefined>(initial?.goalieId)
  const [error, setError] = useState<string | null>(null)
  const prefill = useMemo(() => hockeyOnIcePrefill(setup, projection, events), [setup, projection, events])
  const storedOnIce = initial?.onIce ?? null
  const [onIceTouched, setOnIceTouched] = useState(storedOnIce !== null && storedOnIce.status !== 'not_recorded')
  const [onIceSkaters, setOnIceSkaters] = useState<string[]>(storedOnIce && onIceTouched ? storedOnIce.skaterParticipantIds : prefill.skaterParticipantIds)
  const [onIceGoalie, setOnIceGoalie] = useState<string>(storedOnIce && onIceTouched ? storedOnIce.goalie ?? '' : prefill.goalie)
  const [onIceConfirmed, setOnIceConfirmed] = useState(storedOnIce?.status === 'complete')

  const defending = otherHockeySide(side)
  const netGoalie = projection.goalieInNet[defending]
  const emptyNet = emptyNetOverride ?? netGoalie === null
  const goal = outcome === 'goal'
  const derived = derivedStrength(side)
  const strength = strengthOverride ?? derived ?? 'ev'
  const sideName = (value: HockeySide) => (value === 'tracked' ? trackedLabel : opponentLabel)
  const netGoalieName = netGoalie === null
    ? 'Net empty'
    : defending === 'tracked'
      ? setup.participants.find(entry => entry.id === netGoalie)?.displayName ?? 'Goalie'
      : hockeyOpponentGoalieLabel(projection.opponentGoalies.find(entry => entry.id === netGoalie) ?? { id: netGoalie, label: null, number: null })

  const changeSide = (next: HockeySide) => {
    if (next === side) return
    setSide(next)
    setShooter('')
    setAssist1('')
    setAssist2('')
    setBlocker('')
    setEmptyNetOverride(null)
    setStrengthOverride(null)
    setGoalieFaced(undefined)
  }

  const choice = (owner: HockeySide, value: string): HockeyActorChoice | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    return owner === 'tracked' ? { participantId: trimmed } : { label: trimmed }
  }

  const submit = () => {
    const assists = goal && shooter ? [choice(side, assist1), choice(side, assist2)].filter(Boolean) as HockeyActorChoice[] : []
    const onIce: HockeyOnIce | null = goal && onIceTouched
      ? {
          status: onIceConfirmed ? 'complete' : 'partial',
          skaterParticipantIds: onIceSkaters,
          goalie: onIceGoalie === '' ? null : onIceGoalie,
        }
      : null
    const message = onSubmit({
      side,
      outcome,
      missType: outcome === 'missed' ? missType : null,
      penaltyShot,
      emptyNet,
      shooter: choice(side, shooter),
      assists,
      blocker: outcome === 'blocked' ? choice(defending, blocker) : null,
      location,
      onIce: onIce ?? (goal && editing ? storedOnIce : null),
      ...(goal ? { strength } : {}),
      ...(editing && goalieFaced !== undefined ? { goalieId: emptyNet ? null : goalieFaced } : {}),
    })
    if (message) setError(message)
  }

  return (
    <div className="fixed inset-0 z-50 bg-overlay/[0.5] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-lg sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate font-bold text-content">{editing ? 'Edit ' : ''}{sideName(side)} shot</h2>
            <p className="text-xs text-content-muted">{location ? 'Located on the rink' : 'No location'}</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-content-muted" aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <Group label="Shooting side">
            <Choices
              options={(['tracked', 'opponent'] as const).map(value => ({ value, label: sideName(value) }))}
              value={side}
              onChange={changeSide}
            />
          </Group>

          <Group label="Result">
            <Choices
              options={OUTCOMES.map(value => ({ value, label: HOCKEY_OUTCOME_LABELS[value] }))}
              value={outcome}
              onChange={value => { setOutcome(value); setError(null) }}
              columns={4}
            />
          </Group>

          {outcome === 'missed' && (
            <Group label="Miss">
              <Choices
                options={MISS_TYPES}
                value={missType ?? ('' as HockeyMissType)}
                onChange={value => setMissType(value === missType ? null : value)}
                columns={4}
              />
            </Group>
          )}

          <ActorField
            label={goal ? 'Scorer' : 'Shooter'}
            owner={side}
            value={shooter}
            onChange={setShooter}
            trackedOptions={hockeyAvailableParticipants(hockeyScorerChoices(setup), projection)}
            recentLabels={recentOpponentLabels}
            emptyLabel="Team (unattributed)"
          />

          {goal && shooter && (
            <div className="grid grid-cols-2 gap-3">
              <ActorField label="Primary assist" owner={side} value={assist1} onChange={value => { setAssist1(value); if (!value) setAssist2('') }} trackedOptions={hockeyAvailableParticipants(hockeyScorerChoices(setup), projection)} recentLabels={recentOpponentLabels} emptyLabel="None" />
              <ActorField label="Secondary assist" owner={side} value={assist2} onChange={setAssist2} trackedOptions={hockeyAvailableParticipants(hockeyScorerChoices(setup), projection)} recentLabels={recentOpponentLabels} emptyLabel="None" disabled={!assist1} />
            </div>
          )}

          {outcome === 'blocked' && (
            <ActorField
              label="Blocked by"
              owner={defending}
              value={blocker}
              onChange={setBlocker}
              trackedOptions={hockeyAvailableParticipants(hockeySkaterChoices(setup), projection)}
              recentLabels={recentOpponentLabels}
              emptyLabel="Unknown"
            />
          )}

          {goal && (
            <Group label="Strength">
              <Choices options={STRENGTHS} value={strength} onChange={setStrengthOverride} columns={3} />
              <p className="mt-1 text-xs text-content-muted">
                {derived === null
                  ? 'No game clock, so pick the strength.'
                  : strengthOverride === null || strengthOverride === derived
                    ? 'From the penalty box.'
                    : `The penalty box says ${STRENGTHS.find(entry => entry.value === derived)!.name}.`}
              </p>
            </Group>
          )}

          {editing && !emptyNet && (
            <Group label="Goalie faced">
              <select
                className="input-field w-full"
                value={goalieFaced === undefined ? netGoalie ?? '' : goalieFaced ?? ''}
                onChange={event => setGoalieFaced(event.target.value || null)}
              >
                {defending === 'tracked'
                  ? hockeyGoalieChoices(setup).map(participant => (
                    <option key={participant.id} value={participant.id}>{hockeyParticipantLabel(participant)}</option>
                  ))
                  : projection.opponentGoalies.map(entry => (
                    <option key={entry.id} value={entry.id}>{hockeyOpponentGoalieLabel(entry)}</option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-content-muted">{netGoalieName} was in net at the time.</p>
            </Group>
          )}

          {editing && (
            <HockeyLocationField
              value={location}
              onChange={setLocation}
              trackedDirection={projection.trackedAttackingDirection ?? setup.firstPeriodAttackingDirection}
              side={side}
              kind={outcome}
              trapezoid={setup.rulesSnapshot.trapezoid}
              trackedLabel={trackedLabel}
              opponentLabel={opponentLabel}
            />
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={emptyNet} onChange={event => setEmptyNetOverride(event.target.checked)} />
              Empty net
              <span className="text-content-muted">({netGoalieName} in net)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={penaltyShot} onChange={event => setPenaltyShot(event.target.checked)} />
              Penalty shot
            </label>
          </div>

          {goal && (
            <OnIceSection
              trackedLabel={trackedLabel}
              skaters={hockeyAvailableParticipants(hockeySkaterChoices(setup), projection)}
              goalies={hockeyAvailableParticipants(hockeyGoalieChoices(setup), projection)}
              touched={onIceTouched}
              selected={onIceSkaters}
              goalie={onIceGoalie}
              confirmed={onIceConfirmed}
              limits={onIceLimits}
              onChange={next => {
                setOnIceTouched(true)
                if (next.selected) setOnIceSkaters(next.selected)
                if (next.goalie !== undefined) setOnIceGoalie(next.goalie)
                if (next.confirmed !== undefined) setOnIceConfirmed(next.confirmed)
              }}
            />
          )}

          {error && (
            <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
          )}
          <button type="button" className="btn-primary w-full" onClick={submit}>
            {editing ? 'Review changes' : `Record ${HOCKEY_OUTCOME_LABELS[outcome].toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function choiceValue(choice: HockeyActorChoice | null | undefined): string {
  if (!choice) return ''
  return 'participantId' in choice ? choice.participantId : choice.label
}

function OnIceSection({
  trackedLabel,
  skaters,
  goalies,
  touched,
  selected,
  goalie,
  confirmed,
  limits,
  onChange,
}: {
  trackedLabel: string
  skaters: HockeyMatchParticipant[]
  goalies: HockeyMatchParticipant[]
  touched: boolean
  selected: string[]
  goalie: string
  confirmed: boolean
  limits: HockeyOnIceLimits | null
  onChange: (next: { selected?: string[]; goalie?: string; confirmed?: boolean }) => void
}) {
  const goalieId = useId()
  return (
    <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold text-content">
        {trackedLabel} on the ice <span className="font-normal text-content-muted">(optional)</span>
      </summary>
      <p className="mt-2 text-xs text-content-muted">
        {touched ? 'Edited.' : 'Guessed from the last goal or the opening lineup. Nothing is saved unless you change it.'}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {skaters.map(participant => (
          <label key={participant.id} className="flex min-w-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(participant.id)}
              onChange={event => onChange({
                selected: event.target.checked
                  ? [...selected, participant.id]
                  : selected.filter(id => id !== participant.id),
              })}
            />
            <span className="truncate">{hockeyParticipantLabel(participant)}</span>
          </label>
        ))}
      </div>
      <label htmlFor={goalieId} className="mt-3 block text-sm font-semibold text-content">Goalie</label>
      <select id={goalieId} className="input-field mt-1 w-full" value={goalie} onChange={event => onChange({ goalie: event.target.value })}>
        {goalies.map(participant => <option key={participant.id} value={participant.id}>{hockeyParticipantLabel(participant)}</option>)}
        <option value={HOCKEY_EMPTY_NET}>Net empty</option>
        <option value="">Unknown</option>
      </select>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={event => onChange({ confirmed: event.target.checked })} />
        This is everyone on the ice
      </label>
      {limits && (
        <p className="mt-1 text-xs text-content-muted">
          {limits.minimum === limits.maximum ? limits.maximum : `${limits.minimum}-${limits.maximum}`} skaters now, one more with the net empty.
        </p>
      )}
    </details>
  )
}

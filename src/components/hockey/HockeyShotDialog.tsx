import { X } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import ActorSelect from '../ActorSelect'
import {
  HOCKEY_EMPTY_NET,
  HOCKEY_OUTCOME_LABELS,
  hockeyGoalieChoices,
  hockeyOnIcePrefill,
  hockeyOpponentGoalieLabel,
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
  /** Returns an error message, or null once the shot is recorded. */
  onSubmit: (input: RecordHockeyShotInput) => string | null
  onClose: () => void
}

const OUTCOMES: HockeyShotOutcome[] = ['goal', 'saved', 'missed', 'blocked']
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
  onSubmit,
  onClose,
}: HockeyShotDialogProps) {
  const titleId = useId()
  const { setup, projection } = sport
  const [side, setSide] = useState<HockeySide>(draft.side)
  const [outcome, setOutcome] = useState<HockeyShotOutcome>('saved')
  const [missType, setMissType] = useState<HockeyMissType | null>(null)
  const [shooter, setShooter] = useState('')
  const [assist1, setAssist1] = useState('')
  const [assist2, setAssist2] = useState('')
  const [blocker, setBlocker] = useState('')
  const [penaltyShot, setPenaltyShot] = useState(false)
  const [emptyNetOverride, setEmptyNetOverride] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prefill = useMemo(() => hockeyOnIcePrefill(setup, projection, events), [setup, projection, events])
  const [onIceTouched, setOnIceTouched] = useState(false)
  const [onIceSkaters, setOnIceSkaters] = useState<string[]>(prefill.skaterParticipantIds)
  const [onIceGoalie, setOnIceGoalie] = useState<string>(prefill.goalie)
  const [onIceConfirmed, setOnIceConfirmed] = useState(false)

  const defending = otherHockeySide(side)
  const netGoalie = projection.goalieInNet[defending]
  const emptyNet = emptyNetOverride ?? netGoalie === null
  const goal = outcome === 'goal'
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
      location: draft.location,
      onIce,
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
            <h2 id={titleId} className="truncate font-bold text-content">{sideName(side)} shot</h2>
            <p className="text-xs text-content-muted">{draft.location ? 'Located on the rink' : 'No location'}</p>
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
            trackedOptions={hockeyScorerChoices(setup)}
            recentLabels={recentOpponentLabels}
            emptyLabel="Team (unattributed)"
          />

          {goal && shooter && (
            <div className="grid grid-cols-2 gap-3">
              <ActorField label="Primary assist" owner={side} value={assist1} onChange={value => { setAssist1(value); if (!value) setAssist2('') }} trackedOptions={hockeyScorerChoices(setup)} recentLabels={recentOpponentLabels} emptyLabel="None" />
              <ActorField label="Secondary assist" owner={side} value={assist2} onChange={setAssist2} trackedOptions={hockeyScorerChoices(setup)} recentLabels={recentOpponentLabels} emptyLabel="None" disabled={!assist1} />
            </div>
          )}

          {outcome === 'blocked' && (
            <ActorField
              label="Blocked by"
              owner={defending}
              value={blocker}
              onChange={setBlocker}
              trackedOptions={hockeySkaterChoices(setup)}
              recentLabels={recentOpponentLabels}
              emptyLabel="Unknown"
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
              skaters={hockeySkaterChoices(setup)}
              goalies={hockeyGoalieChoices(setup)}
              touched={onIceTouched}
              selected={onIceSkaters}
              goalie={onIceGoalie}
              confirmed={onIceConfirmed}
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
            Record {HOCKEY_OUTCOME_LABELS[outcome].toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-bold uppercase text-content-muted">{label}</legend>
      {children}
    </fieldset>
  )
}

function Choices<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  columns?: 2 | 4
}) {
  return (
    <div className={`grid gap-1 rounded-md bg-control p-1 ${columns === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`min-h-10 truncate rounded px-2 text-sm font-semibold ${option.value === value ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function participantLabel(participant: HockeyMatchParticipant): string {
  return participant.number ? `#${participant.number} ${participant.displayName}` : participant.displayName
}

/** A dressed-player select for the tracked side, or a label input with recent chips for the opponent. */
function ActorField({
  label,
  owner,
  value,
  onChange,
  trackedOptions,
  recentLabels,
  emptyLabel,
  disabled = false,
}: {
  label: string
  owner: HockeySide
  value: string
  onChange: (value: string) => void
  trackedOptions: HockeyMatchParticipant[]
  recentLabels: string[]
  emptyLabel: string
  disabled?: boolean
}) {
  const inputId = useId()
  if (owner === 'tracked') {
    return (
      <ActorSelect
        label={label}
        value={value}
        options={trackedOptions.map(participant => ({ value: participant.id, label: participantLabel(participant) }))}
        onChange={onChange}
        disabled={disabled}
        emptyOption={{ value: '', label: emptyLabel }}
      />
    )
  }
  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="block text-sm font-semibold text-content">{label}</label>
      <input
        id={inputId}
        className="input-field mt-1 w-full"
        maxLength={80}
        placeholder={`${emptyLabel}, or #12 / name`}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      />
      {recentLabels.length > 0 && !disabled && (
        <div className="mt-1 flex flex-wrap gap-1" aria-label={`Recent opponent players for ${label.toLowerCase()}`}>
          {recentLabels.map(recent => (
            <button
              key={recent}
              type="button"
              aria-pressed={value === recent}
              onClick={() => onChange(value === recent ? '' : recent)}
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${value === recent ? 'border-accent bg-accent text-accent-content' : 'border-line-strong text-content-muted'}`}
            >
              {recent}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function OnIceSection({
  trackedLabel,
  skaters,
  goalies,
  touched,
  selected,
  goalie,
  confirmed,
  onChange,
}: {
  trackedLabel: string
  skaters: HockeyMatchParticipant[]
  goalies: HockeyMatchParticipant[]
  touched: boolean
  selected: string[]
  goalie: string
  confirmed: boolean
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
            <span className="truncate">{participantLabel(participant)}</span>
          </label>
        ))}
      </div>
      <label htmlFor={goalieId} className="mt-3 block text-sm font-semibold text-content">Goalie</label>
      <select id={goalieId} className="input-field mt-1 w-full" value={goalie} onChange={event => onChange({ goalie: event.target.value })}>
        {goalies.map(participant => <option key={participant.id} value={participant.id}>{participantLabel(participant)}</option>)}
        <option value={HOCKEY_EMPTY_NET}>Net empty</option>
        <option value="">Unknown</option>
      </select>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={event => onChange({ confirmed: event.target.checked })} />
        This is everyone on the ice
      </label>
    </details>
  )
}

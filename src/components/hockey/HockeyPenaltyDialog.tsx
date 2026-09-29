import { Plus, Trash2, X } from 'lucide-react'
import { useId, useState } from 'react'
import {
  HOCKEY_INFRACTION_LABELS,
  HOCKEY_INFRACTIONS,
  HOCKEY_PENALTY_CLASS_LABELS,
  HOCKEY_PENALTY_CLASSES,
  hockeyAvailableParticipants,
  hockeyGoalieChoices,
  hockeyPenaltyDefaultDurationMs,
  hockeyPenaltyHasBoxTime,
  hockeyScorerChoices,
  hockeySkaterChoices,
  otherHockeySide,
  type HockeyActorChoice,
  type HockeyInfraction,
  type HockeyOffenderKind,
  type HockeyPenaltyClass,
  type HockeyPenaltyInput,
  type HockeySide,
  type HockeySportGameState,
  type RecordHockeyPenaltiesInput,
} from '../../lib/hockey'
import { ActorField, Choices, Group } from './hockeyFields'

interface HockeyPenaltyDialogProps {
  sport: HockeySportGameState
  recentOpponentLabels: string[]
  trackedLabel: string
  opponentLabel: string
  /** Returns an error message, or null once the penalties are recorded. */
  onSubmit: (input: RecordHockeyPenaltiesInput) => string | null
  onClose: () => void
}

interface PenaltyRow {
  key: number
  side: HockeySide
  penaltyClass: HockeyPenaltyClass
  infraction: HockeyInfraction
  infractionLabel: string
  /** Minutes as typed; blank uses the rules length. */
  minutes: string
  offenderKind: HockeyOffenderKind
  offender: string
  servedBy: string
  drawnBy: string
  delayed: boolean
}

const OFFENDER_KINDS: Array<{ value: HockeyOffenderKind; label: string }> = [
  { value: 'player', label: 'Player' },
  { value: 'goalie', label: 'Goalie' },
  { value: 'bench', label: 'Bench' },
  { value: 'staff', label: 'Staff' },
]

/**
 * Penalty capture (HKY-3A). Every row saved together is one capture unit, so Undo removes
 * them together; Coincidental appears once both sides have a row and is never inferred.
 */
export default function HockeyPenaltyDialog({
  sport,
  recentOpponentLabels,
  trackedLabel,
  opponentLabel,
  onSubmit,
  onClose,
}: HockeyPenaltyDialogProps) {
  const titleId = useId()
  const [rows, setRows] = useState<PenaltyRow[]>([newRow(0, 'tracked')])
  const [coincidental, setCoincidental] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sides = new Set(rows.map(row => row.side))
  const canBeCoincidental = sides.size === 2

  const update = (key: number, change: Partial<PenaltyRow>) => {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...change } : row)))
    setError(null)
  }

  const addRow = () => {
    const last = rows[rows.length - 1]
    setRows(current => [...current, newRow(Math.max(...current.map(row => row.key)) + 1, otherHockeySide(last.side))])
  }

  const submit = () => {
    const penalties: HockeyPenaltyInput[] = []
    for (const row of rows) {
      const minutes = row.minutes.trim()
      let durationMs: number | undefined
      if (minutes && row.penaltyClass !== 'penalty_shot') {
        const value = Number(minutes)
        if (!Number.isFinite(value) || value <= 0 || value > 60) {
          setError('Enter the penalty length in minutes, like 2 or 1.5.')
          return
        }
        durationMs = Math.round(value * 60) * 1000
      }
      const bench = row.offenderKind === 'bench' || row.offenderKind === 'staff'
      penalties.push({
        side: row.side,
        class: row.penaltyClass,
        infraction: row.infraction,
        infractionLabel: row.infraction === 'other' ? row.infractionLabel : null,
        durationMs,
        offenderKind: row.offenderKind,
        offender: bench ? null : choice(row.side, row.offender),
        servedBy: hockeyPenaltyHasBoxTime(row.penaltyClass) ? choice(row.side, row.servedBy) : null,
        drawnBy: choice(otherHockeySide(row.side), row.drawnBy),
        delayed: row.delayed,
      })
    }
    const message = onSubmit({ penalties, coincidental: canBeCoincidental && coincidental })
    if (message) setError(message)
  }

  const available = (participants: ReturnType<typeof hockeySkaterChoices>) =>
    hockeyAvailableParticipants(participants, sport.projection)

  return (
    <div className="fixed inset-0 z-50 bg-overlay/[0.5] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-bold text-content">
            {rows.length > 1 ? `${rows.length} penalties` : 'Penalty'}
          </h2>
          <button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-content-muted" aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>
        <div className="space-y-4 p-4">
          {rows.map((row, index) => {
            const drawnSide = otherHockeySide(row.side)
            const offenders = row.offenderKind === 'goalie' ? hockeyGoalieChoices(sport.setup) : hockeySkaterChoices(sport.setup)
            const boxTime = hockeyPenaltyHasBoxTime(row.penaltyClass)
            const defaultMinutes = hockeyPenaltyDefaultDurationMs(sport.setup.rulesSnapshot.penalties, row.penaltyClass) / 60_000
            const bench = row.offenderKind === 'bench' || row.offenderKind === 'staff'
            return (
              <fieldset key={row.key} className={rows.length > 1 ? 'space-y-3 rounded-md border border-line p-3' : 'space-y-3'}>
                {rows.length > 1 && (
                  <legend className="flex w-full items-center justify-between px-1 text-xs font-bold uppercase text-content-muted">
                    <span>Penalty {index + 1}</span>
                  </legend>
                )}
                {rows.length > 1 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-content-muted"
                      onClick={() => setRows(current => current.filter(entry => entry.key !== row.key))}
                    >
                      <Trash2 size={16} aria-hidden="true" /> Remove penalty {index + 1}
                    </button>
                  </div>
                )}
                <Group label="Penalized side">
                  <Choices
                    options={(['tracked', 'opponent'] as const).map(value => ({ value, label: value === 'tracked' ? trackedLabel : opponentLabel }))}
                    value={row.side}
                    onChange={value => update(row.key, { side: value, offender: '', servedBy: '', drawnBy: '' })}
                  />
                </Group>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block min-w-0 text-sm font-semibold text-content">
                    Class
                    <select
                      className="input-field mt-1 w-full"
                      value={row.penaltyClass}
                      onChange={event => update(row.key, { penaltyClass: event.target.value as HockeyPenaltyClass, minutes: '' })}
                    >
                      {HOCKEY_PENALTY_CLASSES.map(value => <option key={value} value={value}>{HOCKEY_PENALTY_CLASS_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <label className="block min-w-0 text-sm font-semibold text-content">
                    Infraction
                    <select
                      className="input-field mt-1 w-full"
                      value={row.infraction}
                      onChange={event => update(row.key, { infraction: event.target.value as HockeyInfraction })}
                    >
                      {HOCKEY_INFRACTIONS.map(value => <option key={value} value={value}>{HOCKEY_INFRACTION_LABELS[value]}</option>)}
                    </select>
                  </label>
                </div>
                {row.infraction === 'other' && (
                  <label className="block text-sm font-semibold text-content">
                    Infraction name
                    <input
                      className="input-field mt-1 w-full"
                      maxLength={80}
                      value={row.infractionLabel}
                      onChange={event => update(row.key, { infractionLabel: event.target.value })}
                    />
                  </label>
                )}
                {row.penaltyClass !== 'penalty_shot' && (
                  <label className="block text-sm font-semibold text-content">
                    Length (minutes)
                    <input
                      className="input-field mt-1 w-full"
                      inputMode="decimal"
                      placeholder={String(defaultMinutes)}
                      value={row.minutes}
                      onChange={event => update(row.key, { minutes: event.target.value })}
                    />
                  </label>
                )}
                <Group label="Offender">
                  <Choices
                    options={OFFENDER_KINDS}
                    value={row.offenderKind}
                    onChange={value => update(row.key, { offenderKind: value, offender: '' })}
                    columns={4}
                  />
                </Group>
                {!bench && (
                  <ActorField
                    label={row.offenderKind === 'goalie' ? 'Goalie' : 'Player'}
                    owner={row.side}
                    value={row.offender}
                    onChange={value => update(row.key, { offender: value })}
                    trackedOptions={available(offenders)}
                    recentLabels={recentOpponentLabels}
                    emptyLabel="Unknown"
                  />
                )}
                {boxTime && (
                  <ActorField
                    label={row.offenderKind === 'player' && row.penaltyClass !== 'match' ? 'Served by (if not the offender)' : 'Served by'}
                    owner={row.side}
                    value={row.servedBy}
                    onChange={value => update(row.key, { servedBy: value })}
                    trackedOptions={available(hockeySkaterChoices(sport.setup))}
                    recentLabels={recentOpponentLabels}
                    emptyLabel={row.side === 'tracked' && row.offenderKind === 'player' ? 'The offender' : 'Not named'}
                  />
                )}
                <ActorField
                  label="Drawn by"
                  owner={drawnSide}
                  value={row.drawnBy}
                  onChange={value => update(row.key, { drawnBy: value })}
                  trackedOptions={available(hockeyScorerChoices(sport.setup))}
                  recentLabels={recentOpponentLabels}
                  emptyLabel="Unknown"
                />
                <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-content">
                  <input type="checkbox" checked={row.delayed} onChange={event => update(row.key, { delayed: event.target.checked })} />
                  Delayed penalty
                </label>
              </fieldset>
            )
          })}

          <button type="button" className="btn-secondary inline-flex w-full items-center justify-center gap-1" onClick={addRow}>
            <Plus size={16} aria-hidden="true" /> Add another penalty
          </button>

          {canBeCoincidental && (
            <label className="flex min-h-10 items-start gap-2 text-sm text-content">
              <input type="checkbox" className="mt-1" checked={coincidental} onChange={event => setCoincidental(event.target.checked)} />
              <span>
                <span className="font-semibold">Coincidental</span>
                <span className="block text-content-muted">Matching penalties on both sides cancel each other's effect on strength.</span>
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
          )}
          <button type="button" className="btn-primary w-full" onClick={submit}>
            {rows.length > 1 ? `Record ${rows.length} penalties` : 'Record penalty'}
          </button>
        </div>
      </div>
    </div>
  )
}

function newRow(key: number, side: HockeySide): PenaltyRow {
  return {
    key,
    side,
    penaltyClass: 'minor',
    infraction: 'tripping',
    infractionLabel: '',
    minutes: '',
    offenderKind: 'player',
    offender: '',
    servedBy: '',
    drawnBy: '',
    delayed: false,
  }
}

function choice(owner: HockeySide, value: string): HockeyActorChoice | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return owner === 'tracked' ? { participantId: trimmed } : { label: trimmed }
}

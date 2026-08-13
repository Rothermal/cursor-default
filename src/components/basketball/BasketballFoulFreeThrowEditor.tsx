import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import {
  applyBasketballFoulFreeThrowChange,
  basketballFoulFreeThrowEditorOptions,
  basketballFoulParticipantOptions,
  basketballResolvedPlayerOptions,
  buildBasketballFoulFreeThrowEditDraft,
  buildBasketballHistoricalFoulFreeThrowDraft,
  previewBasketballFoulFreeThrowEdit,
  previewBasketballHistoricalFoulFreeThrow,
  type BasketballFoulFreeThrowDraft,
  type BasketballFoulFreeThrowDraftType,
  type BasketballFoulFreeThrowPreview,
  type BasketballRelationshipOption,
} from '../../lib/basketball/foulFreeThrowEditCommands'
import { basketballShotActorSelectionKey } from '../../lib/basketball/shotEditCommands'
import type { BasketballTeamSide } from '../../lib/basketball/types'
import {
  BasketballEditorErrorMessage,
  BasketballEditorFrame,
  BasketballEditorSection,
  BasketballEditorSegmentedControl,
  BasketballEditorSelectField,
} from './BasketballShotEditor'

type Props = {
  onClose: () => void
  onApplied: (eventId: string) => void
} & (
  | { mode: 'edit'; eventId: string }
  | { mode: 'add'; eventType: BasketballFoulFreeThrowDraftType }
)

const foulClasses = [
  ['personal', 'Personal'],
  ['technical', 'Technical'],
  ['flagrant', 'Flagrant'],
  ['intentional', 'Intentional'],
  ['double', 'Double'],
] as const

const foulContexts = [
  ['common', 'Common'],
  ['shooting', 'Shooting'],
  ['offensive', 'Offensive'],
  ['loose_ball', 'Loose ball'],
  ['away_from_play', 'Away from play'],
  ['administrative', 'Administrative'],
] as const

export default function BasketballFoulFreeThrowEditor(props: Props) {
  const { onApplied, onClose } = props
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const editEventId = props.mode === 'edit' ? props.eventId : null
  const addEventType = props.mode === 'add' ? props.eventType : null
  const initial = useMemo(() => {
    if (editEventId !== null) return buildBasketballFoulFreeThrowEditDraft(state, editEventId)
    if (addEventType !== null) return buildBasketballHistoricalFoulFreeThrowDraft(state, addEventType)
    throw new Error('Basketball foul/free-throw editor requires an edit or add target.')
  }, [addEventType, editEventId, state])
  const [draft, setDraft] = useState<BasketballFoulFreeThrowDraft | null>(() => initial.ok ? initial.value : null)
  const [preview, setPreview] = useState<BasketballFoulFreeThrowPreview | null>(null)
  const [error, setError] = useState<string | null>(() => initial.ok ? null : initial.message)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => closeRef.current?.focus(), [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (preview) setPreview(null)
      else onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, preview])

  if (!draft) {
    return (
      <BasketballEditorFrame title={props.mode === 'edit' ? 'Edit event' : 'Add event'} onClose={onClose} closeRef={closeRef}>
        <div className="p-4"><BasketballEditorErrorMessage message={error ?? 'This event is unavailable.'} /></div>
      </BasketballEditorFrame>
    )
  }

  const sportState = state.sportGameState?.sportId === 'basketball' ? state.sportGameState : null
  const periodOptions = props.mode === 'add'
    ? (sportState?.projection.periods ?? [])
        .filter(period => sportState?.projection.startedPeriodIds.includes(period.id))
        .map(period => ({ value: period.id, label: period.label }))
    : []
  const trackedLabel = state.gameInfo?.teamName || 'Tracked'
  const opponentLabel = state.gameInfo?.opponentName || 'Opponent'
  const participantOptions = basketballFoulParticipantOptions(state, draft.teamSide)
  const drawnBySide: BasketballTeamSide = draft.teamSide === 'tracked' ? 'opponent' : 'tracked'
  const drawnByOptions = basketballFoulParticipantOptions(state, drawnBySide)
  const shooterOptions = basketballResolvedPlayerOptions(state, draft.teamSide)
  const { foulSources, tripOptions, positionOptions } = basketballFoulFreeThrowEditorOptions(state, draft)

  const update = (changes: Partial<BasketballFoulFreeThrowDraft>) => {
    setDraft(current => current ? { ...current, ...changes } : current)
    setPreview(null)
    setError(null)
  }

  const chooseSide = (teamSide: BasketballTeamSide) => {
    if (draft.eventType === 'basketball.foul') {
      update({ teamSide, offender: { kind: 'team' }, drawnBy: { kind: 'none' }, teamControlSide: null })
      return
    }
    if (draft.eventType === 'basketball.free_throw_trip') {
      update({ teamSide, sourceFoulEventId: null })
      return
    }
    const shooter = basketballResolvedPlayerOptions(state, teamSide)[0]?.selection
    update({ teamSide, shooter: shooter ?? { kind: 'team' }, freeThrowTripId: null, tripAttemptNumber: null })
  }

  const requestPreview = () => {
    const result = props.mode === 'edit'
      ? previewBasketballFoulFreeThrowEdit(state, draft, user?.id ?? null)
      : previewBasketballHistoricalFoulFreeThrow(state, draft, user?.id ?? null)
    if (!result.ok) return setError(result.message)
    setPreview(result.value)
  }

  const apply = () => {
    if (!preview) return
    const result = applyBasketballFoulFreeThrowChange(state, preview)
    if (!result.ok) {
      setError(result.message)
      setPreview(null)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    onApplied(result.highlightEventId)
  }

  if (preview) {
    return (
      <BasketballEditorFrame title={props.mode === 'edit' ? 'Review event changes' : 'Review new event'} onClose={() => setPreview(null)} closeRef={closeRef}>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <ul className="space-y-2">
            {preview.consequenceLines.map(line => (
              <li key={line} className="flex gap-2 text-sm text-slate-700">
                <Check className="mt-0.5 shrink-0 text-emerald-600" size={16} aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={() => setPreview(null)} className="btn-secondary min-h-11">Back</button>
          <button type="button" onClick={apply} className="btn-primary min-h-11">
            {props.mode === 'edit' ? 'Save changes' : 'Add event'}
          </button>
        </footer>
      </BasketballEditorFrame>
    )
  }

  const label = draft.eventType === 'basketball.foul'
    ? 'foul'
    : draft.eventType === 'basketball.free_throw_trip' ? 'free-throw award' : 'free-throw attempt'
  return (
    <BasketballEditorFrame title={`${props.mode === 'edit' ? 'Edit' : 'Add'} ${label}`} onClose={onClose} closeRef={closeRef}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BasketballEditorSection title={props.mode === 'add' ? 'Recorded later' : 'Event'}>
          {props.mode === 'add' && (
            <BasketballEditorSelectField label="Period" value={draft.period.id} options={periodOptions} onChange={periodId => {
              const period = sportState?.projection.periods.find(candidate => candidate.id === periodId)
              if (period) update({
                period: { id: period.id, order: period.order },
                sourceFoulEventId: null,
                freeThrowTripId: null,
                tripAttemptNumber: null,
              })
            }} />
          )}
          <BasketballEditorSegmentedControl label="Team" value={draft.teamSide} options={[
            { value: 'tracked', label: trackedLabel },
            { value: 'opponent', label: opponentLabel },
          ]} onChange={value => chooseSide(value as BasketballTeamSide)} />
        </BasketballEditorSection>

        {draft.eventType === 'basketball.foul' && (
          <FoulFields
            draft={draft}
            update={update}
            participantOptions={participantOptions}
            drawnByOptions={drawnByOptions}
            trackedLabel={trackedLabel}
            opponentLabel={opponentLabel}
            addMode={props.mode === 'add'}
          />
        )}

        {draft.eventType === 'basketball.free_throw_trip' && (
          <TripFields draft={draft} update={update} foulSources={foulSources} />
        )}

        {draft.eventType === 'basketball.free_throw_attempt' && (
          <AttemptFields
            draft={draft}
            update={update}
            shooterOptions={shooterOptions}
            tripOptions={tripOptions}
            positionOptions={positionOptions}
          />
        )}

        {error && <div className="px-4 pb-4"><BasketballEditorErrorMessage message={error} /></div>}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={onClose} className="btn-secondary min-h-11">Cancel</button>
        <button type="button" onClick={requestPreview} className="btn-primary flex min-h-11 items-center justify-center gap-2">
          {props.mode === 'edit' ? <Pencil size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
          Review
        </button>
      </footer>
    </BasketballEditorFrame>
  )
}

function FoulFields({
  draft,
  update,
  participantOptions,
  drawnByOptions,
  trackedLabel,
  opponentLabel,
  addMode,
}: {
  draft: BasketballFoulFreeThrowDraft
  update: (changes: Partial<BasketballFoulFreeThrowDraft>) => void
  participantOptions: ReturnType<typeof basketballFoulParticipantOptions>
  drawnByOptions: ReturnType<typeof basketballFoulParticipantOptions>
  trackedLabel: string
  opponentLabel: string
  addMode: boolean
}) {
  const offenderValue = draft.offender.kind === 'participant'
    ? `participant:${draft.offender.participantId}`
    : draft.offender.kind
  const drawnByValue = draft.drawnBy.kind === 'participant'
    ? `participant:${draft.drawnBy.participantId}`
    : draft.drawnBy.kind
  const technical = draft.countingOverride?.technical ?? draft.foulClass === 'technical'
  return (
    <>
      <BasketballEditorSection title="Foul attribution">
        <BasketballEditorSelectField label="Charged to" value={offenderValue} options={[
          { value: 'team', label: 'Team' },
          ...participantOptions.map(option => ({ value: option.key, label: option.label })),
          { value: 'staff', label: 'Coach or staff' },
        ]} onChange={value => {
          if (value === 'team') update({ offender: { kind: 'team' } })
          else if (value === 'staff') update({ offender: { kind: 'staff', label: '' } })
          else update({ offender: { kind: 'participant', participantId: value.slice('participant:'.length) } })
        }} />
        {draft.offender.kind === 'staff' && (
          <TextField label="Staff label" value={draft.offender.label} onChange={label => update({ offender: { kind: 'staff', label } })} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <BasketballEditorSelectField label="Class" value={draft.foulClass} options={foulClasses.map(([value, label]) => ({ value, label }))} onChange={value => update({
            foulClass: value as BasketballFoulFreeThrowDraft['foulClass'],
            technical: draft.addLinkedTrip ? value === 'technical' : draft.technical,
          })} />
          <BasketballEditorSelectField label="Context" value={draft.foulContext} options={foulContexts.map(([value, label]) => ({ value, label }))} onChange={value => update({
            foulContext: value as BasketballFoulFreeThrowDraft['foulContext'],
            teamControlSide: value === 'offensive' ? draft.teamSide : draft.teamControlSide,
          })} />
        </div>
        <BasketballEditorSelectField label="Drawn by" value={drawnByValue} options={[
          { value: 'none', label: 'Not recorded' },
          ...drawnByOptions.map(option => ({ value: option.key, label: option.label })),
          { value: 'unknown', label: 'Unknown opponent' },
        ]} onChange={value => {
          if (value === 'none') update({ drawnBy: { kind: 'none' } })
          else if (value === 'unknown') update({ drawnBy: { kind: 'unknown', label: 'Unknown player' } })
          else update({ drawnBy: { kind: 'participant', participantId: value.slice('participant:'.length) } })
        }} />
        {draft.drawnBy.kind === 'unknown' && (
          <TextField label="Drawn-by label" value={draft.drawnBy.label} onChange={label => update({ drawnBy: { kind: 'unknown', label } })} />
        )}
        {draft.foulContext !== 'offensive' && (
          <BasketballEditorSelectField label="Team control" value={draft.teamControlSide ?? 'none'} options={[
            { value: 'none', label: 'Not recorded' },
            { value: 'tracked', label: trackedLabel },
            { value: 'opponent', label: opponentLabel },
          ]} onChange={value => update({ teamControlSide: value === 'none' ? null : value as BasketballTeamSide })} />
        )}
        <TextField label="Incident id (optional)" value={draft.incidentId} onChange={incidentId => update({ incidentId })} />
      </BasketballEditorSection>

      <BasketballEditorSection title="Counting">
        <CheckField label="Exceptional counting override" checked={draft.countingOverride !== null} onChange={checked => update({
          countingOverride: checked ? {
            personalFoul: draft.offender.kind === 'participant',
            teamFoul: true,
            technical: draft.foulClass === 'technical',
            reason: '',
          } : null,
          technical: draft.addLinkedTrip ? draft.foulClass === 'technical' : draft.technical,
        })} />
        {draft.countingOverride && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-slate-700">
              {([
                ['personalFoul', 'Personal'],
                ['teamFoul', 'Team'],
                ['technical', 'Technical'],
              ] as const).map(([key, label]) => (
                <CheckField key={key} label={label} checked={draft.countingOverride![key]} onChange={checked => update({
                  countingOverride: { ...draft.countingOverride!, [key]: checked },
                  technical: key === 'technical' && draft.addLinkedTrip ? checked : draft.technical,
                })} />
              ))}
            </div>
            <TextField label="Override reason" value={draft.countingOverride.reason} onChange={reason => update({
              countingOverride: { ...draft.countingOverride!, reason },
            })} />
          </div>
        )}
        {!draft.countingOverride && <p className="text-xs text-slate-500">Default: {draft.offender.kind === 'participant' ? 'personal, ' : ''}team{technical ? ', technical' : ''}.</p>}
      </BasketballEditorSection>

      {addMode && (
        <BasketballEditorSection title="Linked award">
          <CheckField label="Also add awarded free throws" checked={draft.addLinkedTrip} onChange={addLinkedTrip => update({
            addLinkedTrip,
            technical: addLinkedTrip ? technical : draft.technical,
          })} />
          {draft.addLinkedTrip && <TripSettings draft={draft} update={update} />}
        </BasketballEditorSection>
      )}
    </>
  )
}

function TripFields({
  draft,
  update,
  foulSources,
}: {
  draft: BasketballFoulFreeThrowDraft
  update: (changes: Partial<BasketballFoulFreeThrowDraft>) => void
  foulSources: BasketballRelationshipOption[]
}) {
  return (
    <BasketballEditorSection title="Award">
      <BasketballEditorSelectField label="Source foul" value={draft.sourceFoulEventId ?? 'none'} options={foulSources.map(option => ({
        value: option.eventId ?? 'none',
        label: option.label,
      }))} onChange={value => update({ sourceFoulEventId: value === 'none' ? null : value })} />
      <TripSettings draft={draft} update={update} />
    </BasketballEditorSection>
  )
}

function TripSettings({
  draft,
  update,
}: {
  draft: BasketballFoulFreeThrowDraft
  update: (changes: Partial<BasketballFoulFreeThrowDraft>) => void
}) {
  return (
    <div className="space-y-3">
      <BasketballEditorSegmentedControl label="Maximum attempts" value={String(draft.maximumAttempts)} options={[
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
      ]} onChange={value => update({
        maximumAttempts: Number(value) as 1 | 2 | 3,
        oneAndOne: value === '2' ? draft.oneAndOne : false,
      })} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CheckField label="One-and-one" checked={draft.oneAndOne} disabled={draft.maximumAttempts !== 2} onChange={oneAndOne => update({ oneAndOne })} />
        <CheckField label="Technical" checked={draft.technical} onChange={technical => update({ technical })} />
        <CheckField label="Retain possession" checked={draft.possessionRetained} onChange={possessionRetained => update({ possessionRetained })} />
      </div>
    </div>
  )
}

function AttemptFields({
  draft,
  update,
  shooterOptions,
  tripOptions,
  positionOptions,
}: {
  draft: BasketballFoulFreeThrowDraft
  update: (changes: Partial<BasketballFoulFreeThrowDraft>) => void
  shooterOptions: ReturnType<typeof basketballResolvedPlayerOptions>
  tripOptions: BasketballRelationshipOption[]
  positionOptions: number[]
}) {
  return (
    <BasketballEditorSection title="Free throw">
      <BasketballEditorSelectField label="Shooter" value={basketballShotActorSelectionKey(draft.shooter, draft.teamSide)} options={shooterOptions.map(option => ({
        value: option.key,
        label: option.label,
      }))} onChange={key => {
        const option = shooterOptions.find(candidate => candidate.key === key)
        if (option) update({ shooter: option.selection })
      }} />
      <BasketballEditorSegmentedControl label="Result" value={draft.made ? 'made' : 'missed'} options={[
        { value: 'made', label: 'Made' },
        { value: 'missed', label: 'Missed' },
      ]} onChange={value => update({ made: value === 'made' })} />
      <BasketballEditorSelectField label="Award" value={draft.freeThrowTripId ?? 'none'} options={tripOptions.map(option => ({
        value: option.eventId ?? 'none',
        label: option.label,
      }))} onChange={value => {
        if (value === 'none') return update({ freeThrowTripId: null, tripAttemptNumber: null })
        update({ freeThrowTripId: value, tripAttemptNumber: null })
      }} />
      {draft.freeThrowTripId && (
        <BasketballEditorSelectField label="Stable attempt position" value={draft.tripAttemptNumber ? String(draft.tripAttemptNumber) : ''} options={[
          { value: '', label: 'Select position' },
          ...positionOptions.map(position => ({ value: String(position), label: `Attempt ${position}` })),
        ]} onChange={value => update({ tripAttemptNumber: value ? Number(value) : null })} />
      )}
    </BasketballEditorSection>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <input value={value} onChange={event => onChange(event.target.value)} maxLength={160} className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800" />
    </label>
  )
}

function CheckField({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

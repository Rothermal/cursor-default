import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import {
  applyBasketballAdministrationChange,
  basketballEjectionFoulOptions,
  basketballEjectionParticipantOptions,
  buildBasketballAdministrationEditDraft,
  buildBasketballHistoricalAdministrationDraft,
  previewBasketballAdministrationEdit,
  previewBasketballHistoricalAdministration,
  type BasketballAdministrationDraft,
  type BasketballAdministrationPreview,
  type BasketballEditableAdministrationEventType,
} from '../../lib/basketball/administrationEditCommands'
import { basketballShotActorSelectionKey } from '../../lib/basketball/shotEditCommands'
import BasketballHistoricalTimeField from './BasketballHistoricalTimeField'
import type { BasketballTeamSide, BasketballTimeoutKind } from '../../lib/basketball/types'
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
  | { mode: 'add'; eventType: BasketballEditableAdministrationEventType }
)

export default function BasketballAdministrationEditor(props: Props) {
  const { onApplied, onClose } = props
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const editEventId = props.mode === 'edit' ? props.eventId : null
  const addEventType = props.mode === 'add' ? props.eventType : null
  const initial = useMemo(() => {
    if (editEventId !== null) return buildBasketballAdministrationEditDraft(state, editEventId)
    if (addEventType !== null) return buildBasketballHistoricalAdministrationDraft(state, addEventType)
    throw new Error('Basketball administration editor requires an edit or add target.')
  }, [addEventType, editEventId, state])
  const [draft, setDraft] = useState<BasketballAdministrationDraft | null>(() => initial.ok ? initial.value : null)
  const [preview, setPreview] = useState<BasketballAdministrationPreview | null>(null)
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

  const optionEventId = draft?.eventId ?? null
  const optionEventType = draft?.eventType ?? null
  const optionPeriodId = draft?.period.id ?? null
  const optionTeamSide = draft?.teamSide ?? null
  const optionSubject = draft?.subject ?? null
  const foulOptions = useMemo(() => basketballEjectionFoulOptions(
    state,
    optionEventType === 'basketball.ejection' && optionEventId && optionPeriodId && optionTeamSide && optionSubject
      ? {
          eventId: optionEventId,
          periodId: optionPeriodId,
          teamSide: optionTeamSide,
          subject: optionSubject,
        }
      : null
  ), [optionEventId, optionEventType, optionPeriodId, optionSubject, optionTeamSide, state])

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
  const participantOptions = draft.teamSide === 'neutral'
    ? []
    : basketballEjectionParticipantOptions(state, draft.teamSide)

  const update = (changes: Partial<BasketballAdministrationDraft>) => {
    setDraft(current => current ? { ...current, ...changes } : current)
    setPreview(null)
    setError(null)
  }

  const requestPreview = () => {
    const result = props.mode === 'edit'
      ? previewBasketballAdministrationEdit(state, draft, user?.id ?? null)
      : previewBasketballHistoricalAdministration(state, draft, user?.id ?? null)
    if (!result.ok) return setError(result.message)
    setPreview(result.value)
  }

  const apply = () => {
    if (!preview) return
    const result = applyBasketballAdministrationChange(state, preview)
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

  const label = draft.eventType === 'basketball.ejection' ? 'ejection' : 'timeout'
  return (
    <BasketballEditorFrame title={`${props.mode === 'edit' ? 'Edit' : 'Add'} ${label}`} onClose={onClose} closeRef={closeRef}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.mode === 'add' && (
          <BasketballEditorSection title="Recorded later">
            <BasketballEditorSelectField label="Period" value={draft.period.id} options={periodOptions} onChange={periodId => {
              const period = sportState?.projection.periods.find(candidate => candidate.id === periodId)
              if (period) update({
                period: { id: period.id, order: period.order },
                relatedFoulEventId: null,
              })
            }} />
            <BasketballHistoricalTimeField key={draft.period.id} state={state} period={draft.period} elapsedMs={draft.elapsedMs} onChange={elapsedMs => update({ elapsedMs })} />
          </BasketballEditorSection>
        )}

        {draft.eventType === 'basketball.ejection'
          ? <EjectionFields
              draft={draft}
              update={update}
              participantOptions={participantOptions}
              foulOptions={foulOptions}
              trackedLabel={trackedLabel}
              opponentLabel={opponentLabel}
            />
          : <TimeoutFields
              draft={draft}
              update={update}
              trackedLabel={trackedLabel}
              opponentLabel={opponentLabel}
            />}

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

function EjectionFields({
  draft,
  update,
  participantOptions,
  foulOptions,
  trackedLabel,
  opponentLabel,
}: {
  draft: BasketballAdministrationDraft
  update: (changes: Partial<BasketballAdministrationDraft>) => void
  participantOptions: ReturnType<typeof basketballEjectionParticipantOptions>
  foulOptions: ReturnType<typeof basketballEjectionFoulOptions>
  trackedLabel: string
  opponentLabel: string
}) {
  const subjectValue = draft.subject.kind === 'participant'
    ? basketballShotActorSelectionKey(draft.subject, draft.teamSide as BasketballTeamSide)
    : 'staff'
  const chooseSide = (teamSide: BasketballTeamSide) => {
    update({
      teamSide,
      subject: { kind: 'staff', label: '' },
      ejectionSource: 'official_ruling',
      relatedFoulEventId: null,
    })
  }
  return (
    <>
      <BasketballEditorSection title="Subject">
        <BasketballEditorSegmentedControl label="Team" value={draft.teamSide} options={[
          { value: 'tracked', label: trackedLabel },
          { value: 'opponent', label: opponentLabel },
        ]} onChange={value => chooseSide(value as BasketballTeamSide)} />
        <BasketballEditorSelectField label="Ejected person" value={subjectValue} options={[
          ...participantOptions.map(option => ({ value: option.key, label: option.label })),
          { value: 'staff', label: 'Coach or staff' },
        ]} onChange={value => {
          if (value === 'staff') {
            update({ subject: { kind: 'staff', label: '' }, ejectionSource: 'official_ruling', relatedFoulEventId: null })
            return
          }
          const option = participantOptions.find(candidate => candidate.key === value)
          if (option?.selection.kind === 'participant') update({ subject: option.selection, relatedFoulEventId: null })
        }} />
        {draft.subject.kind === 'staff' && (
          <TextAreaField label="Staff label" value={draft.subject.label} rows={2} onChange={label => update({
            subject: { kind: 'staff', label },
            relatedFoulEventId: null,
          })} />
        )}
      </BasketballEditorSection>
      <BasketballEditorSection title="Ruling">
        <BasketballEditorSegmentedControl label="Source" value={draft.ejectionSource} options={[
          { value: 'official_ruling', label: 'Official ruling' },
          ...(draft.subject.kind === 'participant'
            ? [{ value: 'automatic_threshold', label: 'Automatic threshold' }]
            : []),
        ]} onChange={value => update({ ejectionSource: value as BasketballAdministrationDraft['ejectionSource'] })} />
        <TextAreaField label="Reason" value={draft.reason} rows={3} onChange={reason => update({ reason })} />
        <BasketballEditorSelectField label="Source foul" value={draft.relatedFoulEventId ?? 'none'} options={foulOptions.map(option => ({
          value: option.eventId ?? 'none',
          label: option.label,
        }))} onChange={value => update({ relatedFoulEventId: value === 'none' ? null : value })} />
      </BasketballEditorSection>
    </>
  )
}

function TimeoutFields({
  draft,
  update,
  trackedLabel,
  opponentLabel,
}: {
  draft: BasketballAdministrationDraft
  update: (changes: Partial<BasketballAdministrationDraft>) => void
  trackedLabel: string
  opponentLabel: string
}) {
  const neutral = draft.teamSide === 'neutral'
  const lastChargedSide = useRef<BasketballTeamSide>(
    draft.teamSide === 'neutral' ? 'tracked' : draft.teamSide
  )
  const setMode = (mode: 'charged' | 'neutral') => update(mode === 'charged'
    ? { teamSide: lastChargedSide.current, timeoutKind: 'full', timeoutLabel: 'Full timeout' }
    : { teamSide: 'neutral', timeoutKind: 'official', timeoutLabel: 'Official timeout' })
  const setTeamSide = (teamSide: BasketballTeamSide) => {
    lastChargedSide.current = teamSide
    update({ teamSide })
  }
  const setKind = (timeoutKind: BasketballTimeoutKind) => update({
    timeoutKind,
    timeoutLabel: defaultTimeoutLabel(timeoutKind),
  })
  return (
    <BasketballEditorSection title="Timeout">
      <BasketballEditorSegmentedControl label="Owner" value={neutral ? 'neutral' : 'charged'} options={[
        { value: 'charged', label: 'Charged team' },
        { value: 'neutral', label: 'Game administration' },
      ]} onChange={value => setMode(value as 'charged' | 'neutral')} />
      {!neutral && (
        <BasketballEditorSegmentedControl label="Team" value={draft.teamSide} options={[
          { value: 'tracked', label: trackedLabel },
          { value: 'opponent', label: opponentLabel },
        ]} onChange={value => setTeamSide(value as BasketballTeamSide)} />
      )}
      <BasketballEditorSegmentedControl label="Kind" value={draft.timeoutKind} options={neutral
        ? [
            { value: 'media', label: 'Media' },
            { value: 'official', label: 'Official' },
          ]
        : [
            { value: 'full', label: 'Full' },
            { value: 'thirty_second', label: '30 second' },
          ]} onChange={value => setKind(value as BasketballTimeoutKind)} />
      {neutral && <TextAreaField label="Label" value={draft.timeoutLabel} rows={2} onChange={timeoutLabel => update({ timeoutLabel })} />}
    </BasketballEditorSection>
  )
}

function TextAreaField({
  label,
  value,
  rows,
  onChange,
}: {
  label: string
  value: string
  rows: number
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        maxLength={240}
        rows={rows}
        className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
      />
    </label>
  )
}

function defaultTimeoutLabel(kind: BasketballTimeoutKind): string {
  switch (kind) {
    case 'full': return 'Full timeout'
    case 'thirty_second': return '30-second timeout'
    case 'media': return 'Media timeout'
    case 'official': return 'Official timeout'
  }
}

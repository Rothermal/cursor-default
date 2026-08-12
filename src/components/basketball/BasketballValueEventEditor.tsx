import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import {
  applyBasketballValueEvent,
  basketballMinutesActorOptions,
  buildBasketballHistoricalValueEventDraft,
  buildBasketballValueEventEditDraft,
  previewBasketballHistoricalValueEvent,
  previewBasketballValueEventEdit,
  type BasketballEditableValueEventType,
  type BasketballValueEventDraft,
  type BasketballValueEventPreview,
} from '../../lib/basketball/valueEventEditCommands'
import { basketballShotActorSelectionKey } from '../../lib/basketball/shotEditCommands'
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
  | { mode: 'add'; eventType: BasketballEditableValueEventType }
)

export default function BasketballValueEventEditor(props: Props) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const initial = useMemo(
    () => props.mode === 'edit'
      ? buildBasketballValueEventEditDraft(state, props.eventId)
      : buildBasketballHistoricalValueEventDraft(state, props.eventType),
    [props, state]
  )
  const [draft, setDraft] = useState<BasketballValueEventDraft | null>(() => initial.ok ? initial.value : null)
  const [preview, setPreview] = useState<BasketballValueEventPreview | null>(null)
  const [error, setError] = useState<string | null>(() => initial.ok ? null : initial.message)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => closeRef.current?.focus(), [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (preview) setPreview(null)
      else props.onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [preview, props])

  if (!draft) {
    return (
      <BasketballEditorFrame title={props.mode === 'edit' ? 'Edit event' : 'Add event'} onClose={props.onClose} closeRef={closeRef}>
        <div className="p-4"><BasketballEditorErrorMessage message={error ?? 'This event is unavailable.'} /></div>
      </BasketballEditorFrame>
    )
  }

  const sportState = state.sportGameState?.sportId === 'basketball' ? state.sportGameState : null
  const actorOptions = draft.eventType === 'basketball.minutes_adjustment'
    ? basketballMinutesActorOptions(state, draft.teamSide)
    : []
  const periodOptions = (sportState?.projection.periods ?? [])
    .filter(period => sportState?.projection.startedPeriodIds.includes(period.id))
    .map(period => ({ value: period.id, label: period.label }))

  const update = (changes: Partial<BasketballValueEventDraft>) => {
    setDraft(current => current ? { ...current, ...changes } : current)
    setPreview(null)
    setError(null)
  }

  const selectSide = (teamSide: BasketballValueEventDraft['teamSide']) => {
    if (draft.eventType === 'basketball.score_adjustment') {
      update({ teamSide, actor: { kind: 'team' } })
      return
    }
    const option = basketballMinutesActorOptions(state, teamSide)[0]
    if (option) update({ teamSide, actor: option.selection })
  }

  const requestPreview = () => {
    const result = props.mode === 'edit'
      ? previewBasketballValueEventEdit(state, draft, user?.id ?? null)
      : previewBasketballHistoricalValueEvent(state, draft, user?.id ?? null)
    if (!result.ok) return setError(result.message)
    setPreview(result.value)
  }

  const apply = () => {
    if (!preview) return
    const result = applyBasketballValueEvent(state, preview)
    if (!result.ok) {
      setError(result.message)
      setPreview(null)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    props.onApplied(result.highlightEventId)
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

  const label = draft.eventType === 'basketball.score_adjustment' ? 'score adjustment' : 'minutes adjustment'
  return (
    <BasketballEditorFrame title={`${props.mode === 'edit' ? 'Edit' : 'Add'} ${label}`} onClose={props.onClose} closeRef={closeRef}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BasketballEditorSection title={props.mode === 'add' ? 'Recorded later' : 'Adjustment'}>
          {props.mode === 'add' && (
            <BasketballEditorSelectField label="Period" value={draft.period.id} options={periodOptions} onChange={periodId => {
              const period = sportState?.projection.periods.find(candidate => candidate.id === periodId)
              if (period) update({ period: { id: period.id, order: period.order } })
            }} />
          )}
          <BasketballEditorSegmentedControl label="Team" value={draft.teamSide} options={[
            { value: 'tracked', label: state.gameInfo?.teamName || 'Tracked' },
            { value: 'opponent', label: state.gameInfo?.opponentName || 'Opponent' },
          ]} onChange={value => selectSide(value as BasketballValueEventDraft['teamSide'])} />
          {draft.eventType === 'basketball.minutes_adjustment' && (
            <BasketballEditorSelectField
              label="Player"
              value={basketballShotActorSelectionKey(draft.actor, draft.teamSide)}
              options={actorOptions.map(option => ({ value: option.key, label: option.label }))}
              onChange={key => {
                const option = actorOptions.find(candidate => candidate.key === key)
                if (option) update({ actor: option.selection })
              }}
            />
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">
              {draft.eventType === 'basketball.score_adjustment' ? 'Score change' : 'Minutes change'}
            </span>
            <input
              type="number"
              step="1"
              value={draft.delta}
              onChange={event => update({ delta: Number(event.target.value) })}
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800"
            />
          </label>
        </BasketballEditorSection>

        {draft.eventType === 'basketball.score_adjustment' && (
          <BasketballEditorSection title="Reason">
            <BasketballEditorSelectField label="Reason" value={draft.reason} options={[
              { value: 'scoreboard_control', label: 'Scoreboard control' },
              { value: 'unattributed_score', label: 'Unattributed score' },
              { value: 'official_correction', label: 'Official correction' },
            ]} onChange={reason => update({ reason: reason as BasketballValueEventDraft['reason'] })} />
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                Note{draft.reason === 'official_correction' ? ' (required)' : ''}
              </span>
              <textarea
                value={draft.note}
                onChange={event => update({ note: event.target.value })}
                maxLength={240}
                rows={3}
                className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
              />
            </label>
          </BasketballEditorSection>
        )}

        {error && <div className="px-4 pb-4"><BasketballEditorErrorMessage message={error} /></div>}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={props.onClose} className="btn-secondary min-h-11">Cancel</button>
        <button type="button" onClick={requestPreview} className="btn-primary flex min-h-11 items-center justify-center gap-2">
          {props.mode === 'edit' ? <Pencil size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
          Review
        </button>
      </footer>
    </BasketballEditorFrame>
  )
}

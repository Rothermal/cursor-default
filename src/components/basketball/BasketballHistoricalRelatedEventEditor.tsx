import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import {
  applyBasketballHistoricalRelatedEvent,
  basketballRelatedEventActorOptions,
  basketballRelatedEventTargetOptions,
  buildBasketballHistoricalRelatedEventDraft,
  previewBasketballHistoricalRelatedEvent,
  reconcileBasketballRelatedEventDraft,
  type BasketballHistoricalRelatedEventDraft,
  type BasketballHistoricalRelatedEventPreview,
  type BasketballHistoricalRelatedEventType,
} from '../../lib/basketball/relatedEventEditCommands'
import { basketballShotActorSelectionKey } from '../../lib/basketball/shotEditCommands'
import {
  BasketballEditorErrorMessage,
  BasketballEditorFrame,
  BasketballEditorSection,
  BasketballEditorSegmentedControl,
  BasketballEditorSelectField,
} from './BasketballShotEditor'

interface Props {
  eventType: BasketballHistoricalRelatedEventType
  onClose: () => void
  onApplied: (eventId: string) => void
}

export default function BasketballHistoricalRelatedEventEditor({ eventType, onClose, onApplied }: Props) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const initial = useMemo(() => buildBasketballHistoricalRelatedEventDraft(state, eventType), [eventType, state])
  const [draft, setDraft] = useState<BasketballHistoricalRelatedEventDraft | null>(() => initial.ok ? initial.value : null)
  const [preview, setPreview] = useState<BasketballHistoricalRelatedEventPreview | null>(null)
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

  const sportState = state.sportGameState?.sportId === 'basketball' ? state.sportGameState : null
  const periodOptions = (sportState?.projection.periods ?? [])
    .filter(period => sportState?.projection.startedPeriodIds.includes(period.id))
    .map(period => ({ value: period.id, label: period.label }))
  const actorOptions = useMemo(() => draft
    ? basketballRelatedEventActorOptions(state, draft.teamSide, draft.eventType, draft.turnoverKind, draft.actor)
    : [], [draft, state])
  const pairedTurnoverOptions = useMemo(() => draft
    ? basketballRelatedEventActorOptions(state, oppositeSide(draft.teamSide), 'basketball.turnover', draft.pairedTurnoverKind, draft.pairedTurnoverActor)
    : [], [draft, state])
  const targetOptions = useMemo(() => draft ? basketballRelatedEventTargetOptions(state, draft) : [], [draft, state])

  if (!draft) return <BasketballEditorFrame title="Add event" onClose={onClose} closeRef={closeRef}><div className="p-4"><BasketballEditorErrorMessage message={error ?? 'This event cannot be added.'} /></div></BasketballEditorFrame>

  const update = (changes: Partial<BasketballHistoricalRelatedEventDraft>) => {
    setDraft(reconcileBasketballRelatedEventDraft(state, { ...draft, ...changes }))
    setPreview(null)
    setError(null)
  }
  const selectSide = (teamSide: BasketballHistoricalRelatedEventDraft['teamSide']) => {
    const options = basketballRelatedEventActorOptions(state, teamSide, draft.eventType, draft.turnoverKind)
    const pairedOptions = basketballRelatedEventActorOptions(state, oppositeSide(teamSide), 'basketball.turnover', draft.pairedTurnoverKind)
    if (options[0]) update({
      teamSide,
      actor: options[0].selection,
      pairedTurnoverActor: pairedOptions[0]?.selection ?? draft.pairedTurnoverActor,
    })
  }
  const selectTurnoverKind = (turnoverKind: 'player' | 'team') => {
    const options = basketballRelatedEventActorOptions(state, draft.teamSide, draft.eventType, turnoverKind)
    if (options[0]) update({ turnoverKind, actor: options[0].selection })
  }
  const selectPairedTurnoverKind = (pairedTurnoverKind: 'player' | 'team') => {
    const options = basketballRelatedEventActorOptions(state, oppositeSide(draft.teamSide), 'basketball.turnover', pairedTurnoverKind)
    if (options[0]) update({ pairedTurnoverKind, pairedTurnoverActor: options[0].selection })
  }
  const requestPreview = () => {
    const result = previewBasketballHistoricalRelatedEvent(state, draft, user?.id ?? null)
    if (!result.ok) return setError(result.message)
    setPreview(result.value)
  }
  const apply = () => {
    if (!preview) return
    const result = applyBasketballHistoricalRelatedEvent(state, preview)
    if (!result.ok) {
      setError(result.message)
      setPreview(null)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    onApplied(result.highlightEventId)
  }

  if (preview) return <BasketballEditorFrame title="Review new event" onClose={() => setPreview(null)} closeRef={closeRef}><div className="min-h-0 flex-1 overflow-y-auto px-4 py-4"><ul className="space-y-2">{preview.consequenceLines.map(line => <li key={line} className="flex gap-2 text-sm text-slate-700"><Check className="mt-0.5 shrink-0 text-emerald-600" size={16} aria-hidden /><span>{line}</span></li>)}</ul></div><footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3"><button type="button" onClick={() => setPreview(null)} className="btn-secondary min-h-11">Back</button><button type="button" onClick={apply} className="btn-primary min-h-11">Add event</button></footer></BasketballEditorFrame>

  const paired = draft.eventType === 'basketball.steal_turnover'
  return (
    <BasketballEditorFrame title={`Add ${eventTypeLabel(draft.eventType)}`} onClose={onClose} closeRef={closeRef}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BasketballEditorSection title="Recorded later">
          <BasketballEditorSelectField label="Period" value={draft.period.id} options={periodOptions} onChange={periodId => {
            const period = sportState?.projection.periods.find(candidate => candidate.id === periodId)
            if (period) update({ period: { id: period.id, order: period.order } })
          }} />
          <BasketballEditorSegmentedControl label={paired ? 'Steal team' : 'Team'} value={draft.teamSide} options={[
            { value: 'tracked', label: state.gameInfo?.teamName || 'Tracked' },
            { value: 'opponent', label: state.gameInfo?.opponentName || 'Opponent' },
          ]} onChange={value => selectSide(value as BasketballHistoricalRelatedEventDraft['teamSide'])} />
          {!paired && draft.eventType === 'basketball.turnover' && <BasketballEditorSegmentedControl label="Turnover" value={draft.turnoverKind} options={[{ value: 'player', label: 'Player' }, { value: 'team', label: 'Team' }]} onChange={value => selectTurnoverKind(value as 'player' | 'team')} />}
          <BasketballEditorSelectField label={paired ? 'Stealer' : draft.eventType === 'basketball.turnover' ? 'Committed by' : 'Recorded for'} value={basketballShotActorSelectionKey(draft.actor, draft.teamSide)} options={actorOptions.map(option => ({ value: option.key, label: option.label }))} onChange={key => {
            const option = actorOptions.find(candidate => candidate.key === key)
            if (option) update({ actor: option.selection })
          }} />
          {draft.actor.kind === 'unknown' && <label className="block"><span className="mb-1 block text-sm font-semibold text-slate-700">Unknown player label</span><input value={draft.actor.label} onChange={event => update({ actor: { kind: 'unknown', label: event.target.value } })} maxLength={80} className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800" /></label>}
          {draft.eventType === 'basketball.rebound' && <BasketballEditorSegmentedControl label="Rebound" value={draft.reboundKind} options={[{ value: 'offensive', label: 'Offensive' }, { value: 'defensive', label: 'Defensive' }]} onChange={value => update({ reboundKind: value as 'offensive' | 'defensive' })} />}
        </BasketballEditorSection>
        {paired ? (
          <BasketballEditorSection title="Linked turnover">
            <p className="text-sm font-semibold text-slate-700">{oppositeSide(draft.teamSide) === 'tracked' ? state.gameInfo?.teamName || 'Tracked team' : state.gameInfo?.opponentName || 'Opponent'}</p>
            <BasketballEditorSegmentedControl label="Turnover" value={draft.pairedTurnoverKind} options={[{ value: 'player', label: 'Player' }, { value: 'team', label: 'Team' }]} onChange={value => selectPairedTurnoverKind(value as 'player' | 'team')} />
            <BasketballEditorSelectField label="Committed by" value={basketballShotActorSelectionKey(draft.pairedTurnoverActor, oppositeSide(draft.teamSide))} options={pairedTurnoverOptions.map(option => ({ value: option.key, label: option.label }))} onChange={key => {
              const option = pairedTurnoverOptions.find(candidate => candidate.key === key)
              if (option) update({ pairedTurnoverActor: option.selection })
            }} />
            {draft.pairedTurnoverActor.kind === 'unknown' && <label className="block"><span className="mb-1 block text-sm font-semibold text-slate-700">Unknown player label</span><input value={draft.pairedTurnoverActor.label} onChange={event => update({ pairedTurnoverActor: { kind: 'unknown', label: event.target.value } })} maxLength={80} className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800" /></label>}
          </BasketballEditorSection>
        ) : (
          <BasketballEditorSection title="Relationship">
            <BasketballEditorSelectField label="Linked event" value={draft.relatedEventId ?? 'none'} options={targetOptions.map(option => ({ value: option.eventId ?? 'none', label: option.label }))} onChange={value => update({ relatedEventId: value === 'none' ? null : value })} />
          </BasketballEditorSection>
        )}
        {error && <div className="px-4 pb-4"><BasketballEditorErrorMessage message={error} /></div>}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3"><button type="button" onClick={onClose} className="btn-secondary min-h-11">Cancel</button><button type="button" onClick={requestPreview} className="btn-primary flex min-h-11 items-center justify-center gap-2"><Plus size={16} aria-hidden />Review</button></footer>
    </BasketballEditorFrame>
  )
}

function eventTypeLabel(eventType: BasketballHistoricalRelatedEventType): string {
  return eventType.replace('basketball.', '').replace('_', ' ')
}

function oppositeSide(side: 'tracked' | 'opponent'): 'tracked' | 'opponent' {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

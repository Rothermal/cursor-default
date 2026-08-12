import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, LocateFixed, MapPinOff, Pencil, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import type { ShotRecord } from '../../types'
import {
  applyBasketballShotEdit,
  basketballShotActorOptions,
  basketballShotActorSelectionKey,
  basketballShotRelationshipOptionsByKind,
  basketballShotRelationshipSelectionKey,
  buildBasketballShotEditDraft,
  previewBasketballShotEdit,
  reconcileBasketballShotEditDraftRelationships,
  type BasketballShotEditDraft,
  type BasketballShotEditPreview,
  type BasketballShotRelationshipKind,
} from '../../lib/basketball/shotEditCommands'
import { zoneForForcedShotType } from '../../lib/basketball/courtGeometry'
import BasketballCourt from '../shot-chart/BasketballCourt'

interface BasketballShotEditorProps {
  eventId: string
  onClose: () => void
  onApplied: (eventId: string) => void
}

export default function BasketballShotEditor({
  eventId,
  onClose,
  onApplied,
}: BasketballShotEditorProps) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const initial = useMemo(() => buildBasketballShotEditDraft(state, eventId), [eventId, state])
  const [draft, setDraft] = useState<BasketballShotEditDraft | null>(() => initial.ok ? initial.value : null)
  const [preview, setPreview] = useState<BasketballShotEditPreview | null>(null)
  const [error, setError] = useState<string | null>(() => initial.ok ? null : initial.message)
  const [placingLocation, setPlacingLocation] = useState(false)
  const [confirmRemoveLocation, setConfirmRemoveLocation] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (placingLocation) {
        setPlacingLocation(false)
        return
      }
      if (preview) {
        setPreview(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, placingLocation, preview])

  const shooterOptions = useMemo(
    () => draft ? basketballShotActorOptions(state, draft.teamSide) : [],
    [draft, state]
  )
  const relationshipOptions = useMemo(
    () => draft ? basketballShotRelationshipOptionsByKind(state, draft) : {
      assist: [],
      rebound: [],
      block: [],
    },
    [draft, state]
  )

  if (!draft) {
    return (
      <BasketballEditorFrame title="Edit shot" onClose={onClose} closeRef={closeRef}>
        <p role="alert" className="m-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800">
          {error ?? 'This shot is unavailable for editing.'}
        </p>
      </BasketballEditorFrame>
    )
  }

  const marker: ShotRecord[] = draft.location ? [{
    id: draft.eventId,
    x: draft.location.x,
    y: draft.location.y,
    made: draft.made,
    shotType: draft.value === 3 ? '3pt' : '2pt',
    zone: zoneForForcedShotType(draft.location.x, draft.location.y, draft.value === 3 ? '3pt' : '2pt'),
    playerId: '',
    timestamp: 0,
  }] : []

  const update = (changes: Partial<BasketballShotEditDraft>) => {
    setDraft(current => current
      ? reconcileBasketballShotEditDraftRelationships(state, { ...current, ...changes })
      : current)
    setPreview(null)
    setError(null)
  }

  const selectSide = (teamSide: BasketballShotEditDraft['teamSide']) => {
    const options = basketballShotActorOptions(state, teamSide)
    const currentKey = basketballShotActorSelectionKey(draft.shooter, draft.teamSide)
    const nextShooter = options.find(option => option.key === currentKey)?.selection ?? options[0]?.selection
    if (!nextShooter) return
    update({ teamSide, shooter: nextShooter })
  }

  const requestPreview = () => {
    const result = previewBasketballShotEdit(state, draft, user?.id ?? null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setPreview(result.value)
    setError(null)
  }

  const apply = () => {
    if (!preview) return
    const result = applyBasketballShotEdit(state, preview)
    if (!result.ok) {
      setError(result.message)
      setPreview(null)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    onApplied(result.highlightEventId)
  }

  if (placingLocation) {
    return (
      <BasketballEditorFrame title="Place shot" onClose={() => setPlacingLocation(false)} closeRef={closeRef}>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-3">
          <div className="border-y border-slate-200 bg-white">
            <BasketballCourt
              shots={marker}
              onCourtTap={(x, y) => update({ location: { x, y } })}
              className="w-full"
              emptyHint="Tap to place"
            />
          </div>
          <p className="mt-3 text-center text-sm font-medium text-slate-600">
            {draft.location
              ? `${draft.location.x.toFixed(1)}, ${draft.location.y.toFixed(1)} ft`
              : 'Tap the court to place the shot.'}
          </p>
        </div>
        <footer className="border-t border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setPlacingLocation(false)}
            disabled={!draft.location}
            className="btn-primary flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-40"
          >
            <Check size={17} aria-hidden />
            Done
          </button>
        </footer>
      </BasketballEditorFrame>
    )
  }

  if (preview) {
    return (
      <BasketballEditorFrame title="Review shot changes" onClose={() => setPreview(null)} closeRef={closeRef}>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="text-sm font-semibold text-slate-800">This save will update:</p>
          <ul className="mt-3 space-y-2">
            {preview.consequenceLines.map(line => (
              <li key={line} className="flex gap-2 text-sm text-slate-700">
                <Check className="mt-0.5 shrink-0 text-emerald-600" size={16} aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {error && <BasketballEditorErrorMessage message={error} />}
        </div>
        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <button type="button" onClick={() => setPreview(null)} className="btn-secondary min-h-11">Back</button>
          <button type="button" onClick={apply} className="btn-primary min-h-11">Save changes</button>
        </footer>
      </BasketballEditorFrame>
    )
  }

  return (
    <BasketballEditorFrame title="Edit shot" onClose={onClose} closeRef={closeRef}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BasketballEditorSection title="Shot">
          <BasketballEditorSegmentedControl
            label="Team"
            value={draft.teamSide}
            options={[
              { value: 'tracked', label: state.gameInfo?.teamName || 'Tracked' },
              { value: 'opponent', label: state.gameInfo?.opponentName || 'Opponent' },
            ]}
            onChange={value => selectSide(value as BasketballShotEditDraft['teamSide'])}
          />
          <BasketballEditorSelectField
            label="Shooter"
            value={basketballShotActorSelectionKey(draft.shooter, draft.teamSide)}
            options={shooterOptions.map(option => ({ value: option.key, label: option.label }))}
            onChange={key => {
              const option = shooterOptions.find(candidate => candidate.key === key)
              if (option) update({ shooter: option.selection })
            }}
          />
          <BasketballEditorSegmentedControl
            label="Result"
            value={draft.made ? 'made' : 'missed'}
            options={[{ value: 'made', label: 'Made' }, { value: 'missed', label: 'Missed' }]}
            onChange={value => update({ made: value === 'made' })}
          />
          <BasketballEditorSegmentedControl
            label="Value"
            value={String(draft.value)}
            options={draft.attempt === 'free_throw'
              ? [{ value: '1', label: '1PT' }]
              : [{ value: '2', label: '2PT' }, { value: '3', label: '3PT' }]}
            onChange={value => update({ value: Number(value) as 1 | 2 | 3 })}
          />
        </BasketballEditorSection>

        {draft.attempt === 'field_goal' && (
          <BasketballEditorSection title="Court location">
            <p className="text-sm font-medium text-slate-700">
              {draft.location
                ? `${draft.location.x.toFixed(1)}, ${draft.location.y.toFixed(1)} ft`
                : 'No court location'}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPlacingLocation(true)}
                className="btn-secondary flex min-h-11 items-center justify-center gap-2"
              >
                <LocateFixed size={17} aria-hidden />
                {draft.location ? 'Move' : 'Locate'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemoveLocation(true)}
                disabled={!draft.location}
                className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-rose-700 disabled:opacity-35"
              >
                <MapPinOff size={17} aria-hidden />
                Remove
              </button>
            </div>
            {confirmRemoveLocation && draft.location && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm font-semibold text-rose-900">Return this field goal to unlocated?</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setConfirmRemoveLocation(false)} className="btn-secondary min-h-10 flex-1">Keep</button>
                  <button type="button" onClick={() => {
                    update({ location: null })
                    setConfirmRemoveLocation(false)
                  }} className="min-h-10 flex-1 rounded-md bg-rose-700 text-sm font-bold text-white">Remove</button>
                </div>
              </div>
            )}
          </BasketballEditorSection>
        )}

        <BasketballEditorSection title="Related stats">
          {(Object.keys(relationshipOptions) as BasketballShotRelationshipKind[]).map(kind => {
            const options = relationshipOptions[kind]
            return (
              <BasketballEditorSelectField
                key={kind}
                label={kind.charAt(0).toUpperCase() + kind.slice(1)}
                value={basketballShotRelationshipSelectionKey(draft.relationships[kind])}
                options={options.map(option => ({ value: option.key, label: option.label }))}
                onChange={key => {
                  const option = options.find(candidate => candidate.key === key)
                  if (option) update({
                    relationships: { ...draft.relationships, [kind]: option.selection },
                  })
                }}
              />
            )
          })}
          <p className="text-xs text-slate-500">Unlinked stats keep their totals.</p>
        </BasketballEditorSection>

        {error && <div className="px-4 pb-4"><BasketballEditorErrorMessage message={error} /></div>}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-white px-4 py-3">
        <button type="button" onClick={onClose} className="btn-secondary min-h-11">Cancel</button>
        <button type="button" onClick={requestPreview} className="btn-primary flex min-h-11 items-center justify-center gap-2">
          <Pencil size={16} aria-hidden />
          Review
        </button>
      </footer>
    </BasketballEditorFrame>
  )
}

export function BasketballEditorFrame({
  title,
  onClose,
  closeRef,
  children,
}: {
  title: string
  onClose: () => void
  closeRef: React.Ref<HTMLButtonElement>
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-shot-editor-title"
        className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-lg sm:border sm:border-slate-200"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="basketball-shot-editor-title" className="text-base font-bold text-slate-900">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-600"
            aria-label={`Close ${title.toLowerCase()}`}
            title="Close"
          >
            <X size={19} aria-hidden />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

export function BasketballEditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-slate-200 px-4 py-4">
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

export function BasketballEditorSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

export function BasketballEditorSegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-slate-700">{label}</legend>
      <div className={`grid gap-1 rounded-md bg-slate-100 p-1 ${options.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-10 rounded text-sm font-bold ${value === option.value
              ? 'bg-white text-blue-800 shadow-sm'
              : 'text-slate-600'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function BasketballEditorErrorMessage({ message }: { message: string }) {
  return (
    <p role="alert" className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800">
      <AlertTriangle className="mt-0.5 shrink-0" size={16} aria-hidden />
      <span>{message}</span>
    </p>
  )
}

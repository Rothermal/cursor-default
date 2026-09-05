import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, LocateFixed, MapPinOff, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import { gameSideDisplayName } from '../../lib/display'
import type { ShotRecord } from '../../types'
import {
  basketballCourtOrientationForState,
  zoneForForcedShotType,
} from '../../lib/basketball/courtGeometry'
import {
  applyBasketballHistoricalShot,
  basketballShotActorOptions,
  basketballShotActorSelectionKey,
  buildBasketballHistoricalShotDraft,
  previewBasketballHistoricalShot,
  reconcileBasketballHistoricalShotDraftRelationships,
  type BasketballHistoricalShotDraft,
  type BasketballHistoricalShotPreview,
  type BasketballShotRelationshipKind,
  type BasketballShotRelationshipSelection,
} from '../../lib/basketball/shotEditCommands'
import BasketballCourt from '../shot-chart/BasketballCourt'
import BasketballHistoricalTimeField from './BasketballHistoricalTimeField'
import {
  BasketballEditorErrorMessage,
  BasketballEditorFrame,
  BasketballEditorSection,
  BasketballEditorSegmentedControl,
  BasketballEditorSelectField,
} from './BasketballShotEditor'

interface BasketballHistoricalShotEditorProps {
  onClose: () => void
  onApplied: (eventId: string) => void
}

export default function BasketballHistoricalShotEditor({
  onClose,
  onApplied,
}: BasketballHistoricalShotEditorProps) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const initial = useMemo(() => buildBasketballHistoricalShotDraft(state), [state])
  const [draft, setDraft] = useState<BasketballHistoricalShotDraft | null>(() => initial.ok ? initial.value : null)
  const [preview, setPreview] = useState<BasketballHistoricalShotPreview | null>(null)
  const [error, setError] = useState<string | null>(() => initial.ok ? null : initial.message)
  const [placingLocation, setPlacingLocation] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (placingLocation) return setPlacingLocation(false)
      if (preview) return setPreview(null)
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, placingLocation, preview])

  if (!draft) {
    return (
      <BasketballEditorFrame title="Add shot" onClose={onClose} closeRef={closeRef}>
        <div className="p-4"><BasketballEditorErrorMessage message={error ?? 'A shot cannot be added right now.'} /></div>
      </BasketballEditorFrame>
    )
  }

  const sportState = state.sportGameState?.sportId === 'basketball' ? state.sportGameState : null
  const periodOptions = (sportState?.projection.periods ?? [])
    .filter(period => sportState?.projection.startedPeriodIds.includes(period.id))
    .map(period => ({ value: period.id, label: period.label }))
  const shooterOptions = basketballShotActorOptions(state, draft.teamSide)
  const allActorOptions = basketballShotActorOptions(state)
  const relationshipOptions = Object.fromEntries(
    (['assist', 'rebound', 'block'] as const).map(kind => [kind, historicalRelationshipOptions(
      kind,
      draft,
      allActorOptions,
      basketballShotActorSelectionKey(draft.shooter, draft.teamSide)
    )])
  ) as Record<BasketballShotRelationshipKind, HistoricalRelationshipOption[]>
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

  const update = (changes: Partial<BasketballHistoricalShotDraft>) => {
    setDraft(current => current
      ? reconcileBasketballHistoricalShotDraftRelationships(state, { ...current, ...changes })
      : current)
    setPreview(null)
    setError(null)
  }

  const selectSide = (teamSide: BasketballHistoricalShotDraft['teamSide']) => {
    const options = basketballShotActorOptions(state, teamSide)
    if (!options[0]) return
    update({
      teamSide,
      shooter: options[0].selection,
      relationships: {
        assist: { mode: 'none' },
        rebound: { mode: 'none' },
        block: { mode: 'none' },
      },
    })
  }

  const selectResult = (made: boolean) => update({
    made,
    relationships: made
      ? { ...draft.relationships, rebound: { mode: 'none' }, block: { mode: 'none' } }
      : { ...draft.relationships, assist: { mode: 'none' } },
  })

  const requestPreview = () => {
    const result = previewBasketballHistoricalShot(state, draft, user?.id ?? null)
    if (!result.ok) return setError(result.message)
    setPreview(result.value)
    setError(null)
  }

  const apply = () => {
    if (!preview) return
    const result = applyBasketballHistoricalShot(state, preview)
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
              flipped={basketballCourtOrientationForState(state) === 'flipped'}
              className="w-full"
              emptyHint="Tap to place"
            />
          </div>
          <p className="mt-3 text-center text-sm font-medium text-slate-600">
            {draft.location ? `${draft.location.x.toFixed(1)}, ${draft.location.y.toFixed(1)} ft` : 'Tap to place the shot.'}
          </p>
        </div>
        <footer className="border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={() => setPlacingLocation(false)} disabled={!draft.location} className="btn-primary min-h-11 w-full disabled:opacity-40">Done</button>
        </footer>
      </BasketballEditorFrame>
    )
  }

  if (preview) {
    return (
      <BasketballEditorFrame title="Review new shot" onClose={() => setPreview(null)} closeRef={closeRef}>
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
          <button type="button" onClick={apply} className="btn-primary min-h-11">Add shot</button>
        </footer>
      </BasketballEditorFrame>
    )
  }

  return (
    <BasketballEditorFrame title="Add shot" onClose={onClose} closeRef={closeRef}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BasketballEditorSection title="Historical field goal">
          <BasketballEditorSelectField
            label="Period"
            value={draft.period.id}
            options={periodOptions}
            onChange={periodId => {
              const period = sportState?.projection.periods.find(candidate => candidate.id === periodId)
              if (period) update({ period: { id: period.id, order: period.order } })
            }}
          />
          <BasketballHistoricalTimeField
            key={draft.period.id}
            state={state}
            period={draft.period}
            elapsedMs={draft.elapsedMs}
            onChange={elapsedMs => update({ elapsedMs })}
          />
          <BasketballEditorSegmentedControl
            label="Team"
            value={draft.teamSide}
            options={[
              { value: 'tracked', label: gameSideDisplayName(state.gameInfo, 'tracked') },
              { value: 'opponent', label: gameSideDisplayName(state.gameInfo, 'opponent') },
            ]}
            onChange={value => selectSide(value as BasketballHistoricalShotDraft['teamSide'])}
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
            onChange={value => selectResult(value === 'made')}
          />
          <BasketballEditorSegmentedControl
            label="Value"
            value={String(draft.value)}
            options={[{ value: '2', label: '2PT' }, { value: '3', label: '3PT' }]}
            onChange={value => update({ value: Number(value) as 2 | 3 })}
          />
        </BasketballEditorSection>

        <BasketballEditorSection title="Court location">
          <p className="text-sm font-medium text-slate-700">
            {draft.location ? `${draft.location.x.toFixed(1)}, ${draft.location.y.toFixed(1)} ft` : 'No court location'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPlacingLocation(true)} className="btn-secondary flex min-h-11 items-center justify-center gap-2">
              <LocateFixed size={17} aria-hidden /> {draft.location ? 'Move' : 'Locate'}
            </button>
            <button type="button" onClick={() => update({ location: null })} disabled={!draft.location} className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-rose-700 disabled:opacity-35">
              <MapPinOff size={17} aria-hidden /> Remove
            </button>
          </div>
        </BasketballEditorSection>

        <BasketballEditorSection title="Related stats">
          {(Object.keys(relationshipOptions) as BasketballShotRelationshipKind[]).map(kind => {
            const options = relationshipOptions[kind]
            return (
              <BasketballEditorSelectField
                key={kind}
                label={kind.charAt(0).toUpperCase() + kind.slice(1)}
                value={historicalRelationshipKey(draft.relationships[kind])}
                options={options.map(option => ({ value: option.key, label: option.label }))}
                onChange={key => {
                  const option = options.find(candidate => candidate.key === key)
                  if (option) update({ relationships: { ...draft.relationships, [kind]: option.selection } })
                }}
              />
            )
          })}
        </BasketballEditorSection>
        {error && <div className="px-4 pb-4"><BasketballEditorErrorMessage message={error} /></div>}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={onClose} className="btn-secondary min-h-11">Cancel</button>
        <button type="button" onClick={requestPreview} className="btn-primary flex min-h-11 items-center justify-center gap-2">
          <Plus size={17} aria-hidden /> Review
        </button>
      </footer>
    </BasketballEditorFrame>
  )
}

interface HistoricalRelationshipOption {
  key: string
  label: string
  selection: BasketballShotRelationshipSelection
}

function historicalRelationshipOptions(
  kind: BasketballShotRelationshipKind,
  draft: BasketballHistoricalShotDraft,
  actors: ReturnType<typeof basketballShotActorOptions>,
  shooterKey: string
): HistoricalRelationshipOption[] {
  const allowed = actors.filter(actor => {
    if (kind === 'assist') return draft.made && actor.teamSide === draft.teamSide && actor.key !== shooterKey
    if (kind === 'rebound') return !draft.made
    return !draft.made && actor.teamSide !== draft.teamSide
  })
  return [
    { key: 'none', label: 'None', selection: { mode: 'none' } },
    ...allowed.map(actor => ({
      key: `new:${actor.teamSide}:${actor.key}`,
      label: actor.label,
      selection: { mode: 'new' as const, teamSide: actor.teamSide, actor: actor.selection },
    })),
  ]
}

function historicalRelationshipKey(selection: BasketballShotRelationshipSelection): string {
  if (selection.mode === 'none') return 'none'
  if (selection.mode === 'event') return `event:${selection.eventId}`
  return `new:${selection.teamSide}:${basketballShotActorSelectionKey(selection.actor, selection.teamSide)}`
}

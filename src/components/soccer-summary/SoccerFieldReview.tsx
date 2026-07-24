import { MapPinOff, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import SoccerField, {
  type SoccerFieldMarker,
} from '../soccer/SoccerField'
import SoccerLocatedEventEditor from '../soccer/SoccerLocatedEventEditor'
import type { SoccerLiveResult } from '../../lib/soccer'
import {
  canEditSoccerSummaryField,
  SOCCER_FIELD_REVIEW_FAMILIES,
  soccerSummaryFieldReview,
  type SoccerFieldReviewEvent,
  type SoccerFieldReviewFamily,
  type SoccerFieldReviewOrientation,
  type SoccerFieldReviewParticipant,
  type SoccerFieldReviewPeriod,
  type SoccerFieldReviewSide,
} from '../../lib/soccer/summaryField'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'
import type { GameEvent } from '../../lib/gameEvents/types'

interface SoccerFieldReviewProps {
  source: SoccerSummarySource
  recorderUserId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
}

const ALL_FAMILIES = SOCCER_FIELD_REVIEW_FAMILIES.map(item => item.id)

export default function SoccerFieldReview({
  source,
  recorderUserId,
  busy,
  onApply,
}: SoccerFieldReviewProps) {
  const [orientation, setOrientation] =
    useState<SoccerFieldReviewOrientation>('normalized')
  const [side, setSide] = useState<SoccerFieldReviewSide>('all')
  const [families, setFamilies] =
    useState<SoccerFieldReviewFamily[]>([...ALL_FAMILIES])
  const [participant, setParticipant] =
    useState<SoccerFieldReviewParticipant>('all')
  const [period, setPeriod] =
    useState<SoccerFieldReviewPeriod>('full_match')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editing, setEditing] = useState<GameEvent | null>(null)
  const review = useMemo(
    () => soccerSummaryFieldReview(source.state, source.inspection, {
      orientation,
      side,
      families,
      participant,
      period,
    }),
    [families, orientation, participant, period, side, source]
  )
  const editable = canEditSoccerSummaryField(source)
  const selected = selectedIds.flatMap(id => {
    const item = review.events.find(event => event.event.id === id)
    return item ? [item] : []
  })
  const markers: SoccerFieldMarker[] = review.locatedEvents.map(item => ({
    id: item.event.id,
    x: item.displayLocation?.x ?? 0,
    y: item.displayLocation?.y ?? 0,
    teamSide: item.event.teamSide,
    kind: item.markerKind,
    label: `${item.title}, ${item.timeLabel}`,
  }))

  useEffect(() => {
    if (review.participantOptions.some(option => option.id === participant)) return
    setParticipant('all')
  }, [participant, review.participantOptions])

  useEffect(() => {
    if (review.periodOptions.some(option => option.id === period)) return
    setPeriod('full_match')
  }, [period, review.periodOptions])

  useEffect(() => {
    setSelectedIds(current =>
      current.filter(id => review.events.some(item => item.event.id === id))
    )
  }, [review.events])

  const toggleFamily = (family: SoccerFieldReviewFamily) => {
    setFamilies(current => {
      if (!current.includes(family)) return [...current, family]
      return current.length === 1
        ? current
        : current.filter(item => item !== family)
    })
  }

  return (
    <main className={busy ? 'pointer-events-none opacity-60' : ''} aria-busy={busy}>
      <section className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold uppercase text-slate-500">
                Field Review
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {review.locatedEvents.length} located event{review.locatedEvents.length === 1 ? '' : 's'}
              </p>
            </div>
            <Segmented
              label="Field orientation"
              value={orientation}
              options={[
                { id: 'normalized', label: 'Normalized' },
                { id: 'original', label: 'Original' },
              ]}
              onChange={setOrientation}
            />
          </div>

          <Segmented
            label="Team side"
            value={side}
            options={[
              { id: 'all', label: 'Both' },
              { id: 'tracked', label: 'Tracked' },
              { id: 'opponent', label: 'Opponent' },
            ]}
            onChange={setSide}
          />

          <div>
            <p className="mb-2 text-xs font-bold uppercase text-slate-500">
              Event families
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {SOCCER_FIELD_REVIEW_FAMILIES.map(item => {
                const active = families.includes(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleFamily(item.id)}
                    className={`min-h-9 shrink-0 border px-3 text-xs font-bold ${
                      active
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-slate-300 bg-white text-slate-600'
                    }`}
                    aria-pressed={active}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FilterSelect
              label="Participant"
              value={participant}
              options={review.participantOptions}
              onChange={value => setParticipant(value as SoccerFieldReviewParticipant)}
            />
            <FilterSelect
              label="Match period"
              value={period}
              options={review.periodOptions}
              onChange={value => setPeriod(value as SoccerFieldReviewPeriod)}
            />
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-100 px-3 py-4">
        <div className="mx-auto max-w-2xl">
          <SoccerField
            trackedDirection="left_to_right"
            captureSide="tracked"
            flipped={false}
            disabled
            markers={markers}
            onFlip={() => {}}
            onLocation={() => {}}
            onMarker={id => setSelectedIds([id])}
            onCluster={ids => setSelectedIds(
              review.events
                .filter(item => ids.includes(item.event.id))
                .map(item => item.event.id)
            )}
            presentation="review"
            legendFamilies={families}
          />
          {markers.length === 0 && (
            <p className="py-5 text-center text-sm text-slate-500">
              No located events match these filters.
            </p>
          )}
        </div>
      </section>

      {review.unknownLocationCount > 0 && (
        <section className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mx-auto max-w-2xl">
            <button
              type="button"
              onClick={() => setSelectedIds(
                review.events
                  .filter(item => item.displayLocation === null)
                  .map(item => item.event.id)
              )}
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-amber-900"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                <MapPinOff size={17} className="shrink-0" />
                Unknown location
              </span>
              <span className="text-xs font-bold">
                {review.unknownLocationCount} event{review.unknownLocationCount === 1 ? '' : 's'}
              </span>
            </button>
          </div>
        </section>
      )}

      {selected.length > 0 && (
        <FieldEventSheet
          events={selected}
          unlocated={selected.every(item => item.displayLocation === null)}
          editable={editable}
          onEdit={event => setEditing(event)}
          onClose={() => setSelectedIds([])}
        />
      )}

      <SoccerLocatedEventEditor
        event={editing}
        state={source.state}
        recorderUserId={recorderUserId}
        selectedParticipantId={
          source.state.sportGameState?.sportId === 'soccer'
            ? source.state.sportGameState.capturePreferences.selectedParticipantId
            : null
        }
        busy={busy}
        onApply={onApply}
        onClose={() => setEditing(null)}
      />
    </main>
  )
}

function Segmented<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: TValue
  options: Array<{ id: TValue; label: string }>
  onChange: (value: TValue) => void
}) {
  return (
    <div>
      <p className="sr-only">{label}</p>
      <div className="inline-flex border border-slate-300 bg-white" role="group" aria-label={label}>
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`min-h-9 px-3 text-xs font-bold ${
              value === option.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-600'
            }`}
            aria-pressed={value === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-xs font-bold uppercase text-slate-500">
      {label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="input-field mt-1"
      >
        {options.map(option => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function FieldEventSheet({
  events,
  unlocated,
  editable,
  onEdit,
  onClose,
}: {
  events: SoccerFieldReviewEvent[]
  unlocated: boolean
  editable: boolean
  onEdit: (event: GameEvent) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[82vh] w-full overflow-y-auto rounded-t-lg bg-white p-4 sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-800">
              {unlocated
                ? 'Events without a location'
                : events.length === 1 ? 'Field Event' : 'Events at this location'}
            </h2>
            {events.length > 1 && (
              <p className="text-xs text-slate-500">Oldest first</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center text-slate-500"
            aria-label="Close"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {events.map(item => (
            <article key={item.event.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-800">{item.title}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.timeLabel} - {item.participantLabel}
                  </p>
                  {item.detail && (
                    <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
                  )}
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => onEdit(item.event)}
                    className="grid h-9 w-9 shrink-0 place-items-center text-emerald-700"
                    aria-label={`Edit ${item.title}`}
                    title="Edit"
                  >
                    <Pencil size={17} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

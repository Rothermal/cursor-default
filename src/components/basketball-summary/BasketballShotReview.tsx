import { CircleDot, Eye, MapPinOff, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShotRecord } from '../../types'
import {
  basketballSummaryShotReview,
  DEFAULT_BASKETBALL_SUMMARY_SHOT_FILTERS,
  filterBasketballSummaryShots,
  type BasketballSummaryShot,
  type BasketballSummaryShotFilters,
} from '../../lib/basketball/summaryShots'
import type { BasketballSummarySource } from '../../lib/basketball/summarySource'
import {
  basketballTimelineCorrectionsEnabled,
  resolveBasketballMarkerActivation,
  type BasketballShotDetailModel,
} from '../../lib/basketball/timeline'
import BasketballCourt from '../shot-chart/BasketballCourt'
import BasketballShotDetailDialog from '../basketball/BasketballShotDetailDialog'
import BasketballShotEditor from '../basketball/BasketballShotEditor'
import BasketballTimelineCorrectionDialog, {
  type BasketballTimelineCorrectionIntent,
} from '../basketball/BasketballTimelineCorrectionDialog'

interface Props {
  source: BasketballSummarySource
}

type FocusTarget = HTMLElement | SVGElement

export default function BasketballShotReview({ source }: Props) {
  const review = useMemo(() => basketballSummaryShotReview(source.state), [source.state])
  const [filters, setFilters] = useState<BasketballSummaryShotFilters>(
    DEFAULT_BASKETBALL_SUMMARY_SHOT_FILTERS
  )
  const [detail, setDetail] = useState<BasketballShotDetailModel | null>(null)
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const [correctionIntent, setCorrectionIntent] = useState<BasketballTimelineCorrectionIntent | null>(null)
  const [overlapChoices, setOverlapChoices] = useState<BasketballSummaryShot[]>([])
  const returnFocusRef = useRef<FocusTarget | null>(null)
  const overlapFirstRef = useRef<HTMLButtonElement>(null)
  const overlapDialogRef = useRef<HTMLElement>(null)

  const filteredShots = useMemo(
    () => filterBasketballSummaryShots(review, filters),
    [filters, review]
  )
  const locatedShots = filteredShots.filter(shot => shot.marker)
  const markers = locatedShots.map(shot => shot.marker!)
  const unlocatedShots = filteredShots.filter(shot => !shot.marker)
  const shotById = useMemo(
    () => new Map(review.shots.map(shot => [shot.id, shot])),
    [review.shots]
  )
  const correctionsEnabled = source.kind === 'local' && source.editable &&
    basketballTimelineCorrectionsEnabled(source.state, true)
  const made = filteredShots.filter(shot => shot.made).length

  const rememberFocus = useCallback((element?: FocusTarget | null) => {
    returnFocusRef.current = element ?? (
      document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement
        ? document.activeElement
        : null
    )
  }, [])
  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    window.setTimeout(() => target?.focus(), 0)
  }, [])
  const openDetail = (shot: BasketballSummaryShot, trigger?: FocusTarget | null) => {
    rememberFocus(trigger)
    setDetail(shot.detail)
  }

  const activateMarker = (
    marker: ShotRecord,
    element: SVGGElement,
    point: { x: number; y: number } | null
  ) => {
    const activation = resolveBasketballMarkerActivation(markers, marker.id, point)
    if (!activation) return
    if (activation.kind === 'chooser') {
      rememberFocus(element)
      setOverlapChoices(activation.shots.flatMap(shot => {
        const resolved = shotById.get(shot.id)
        return resolved ? [resolved] : []
      }))
      return
    }
    const shot = shotById.get(activation.shot.id)
    if (shot) openDetail(shot, element)
  }

  const closeOverlap = useCallback(() => {
    setOverlapChoices([])
    restoreFocus()
  }, [restoreFocus])

  useEffect(() => {
    if (overlapChoices.length < 2) return
    overlapFirstRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeOverlap()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        overlapDialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []
      )
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeOverlap, overlapChoices.length])

  return (
    <main
      id="basketball-shots-panel"
      role="tabpanel"
      aria-labelledby="basketball-shots-tab"
      className="mx-auto w-full max-w-5xl pb-24"
    >
      <section className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Shot Chart</h2>
            <p className="mt-0.5 text-sm font-semibold text-slate-600">
              {made}/{filteredShots.length} field goals
            </p>
          </div>
          {!correctionsEnabled && (
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
              Read only
            </span>
          )}
        </div>

        <div className="mt-4" aria-label="Shot side filter">
          <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Side</span>
          <div className="grid grid-cols-3 rounded-md border border-slate-300 bg-slate-100 p-0.5">
            {([
              ['all', 'All'],
              ['tracked', source.state.gameInfo?.teamName || 'Tracked'],
              ['opponent', source.state.gameInfo?.opponentName || 'Opponent'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilters(current => ({ ...current, teamSide: value }))}
                className={`min-h-10 truncate rounded px-2 text-xs font-bold ${
                  filters.teamSide === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
                aria-pressed={filters.teamSide === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <FilterSelect
            label="Player"
            value={filters.participantId}
            onChange={participantId => setFilters(current => ({ ...current, participantId }))}
            options={[
              { value: 'all', label: 'All players' },
              ...review.participants.map(participant => ({
                value: participant.id,
                label: `${participant.label} (${participant.teamSide === 'tracked' ? 'Tracked' : 'Opponent'})`,
              })),
            ]}
          />
          <FilterSelect
            label="Period"
            value={filters.periodId}
            onChange={periodId => setFilters(current => ({ ...current, periodId }))}
            options={[
              { value: 'all', label: 'Full game' },
              ...review.periods.map(period => ({ value: period.id, label: period.label })),
            ]}
          />
          <FilterSelect
            label="Result"
            value={filters.result}
            onChange={result => setFilters(current => ({
              ...current,
              result: result as BasketballSummaryShotFilters['result'],
            }))}
            options={[
              { value: 'all', label: 'Made + missed' },
              { value: 'made', label: 'Made' },
              { value: 'missed', label: 'Missed' },
            ]}
          />
          <FilterSelect
            label="Value"
            value={filters.value}
            onChange={value => setFilters(current => ({
              ...current,
              value: value as BasketballSummaryShotFilters['value'],
            }))}
            options={[
              { value: 'all', label: '2PT + 3PT' },
              { value: '2', label: '2PT' },
              { value: '3', label: '3PT' },
            ]}
          />
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white px-3 py-4" aria-label="Filtered shot court">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs font-semibold text-slate-600">
          <LegendMark color="bg-blue-600" label={source.state.gameInfo?.teamName || 'Tracked'} />
          <LegendMark color="bg-amber-600" label={source.state.gameInfo?.opponentName || 'Opponent'} />
          <span>Circle = made</span>
          <span>X = missed</span>
        </div>
        <BasketballCourt
          shots={markers}
          onMarkerActivate={activateMarker}
          markerTone={marker => shotById.get(marker.id)?.teamSide ?? null}
          markerLabel={marker => {
            const shot = shotById.get(marker.id)
            return shot
              ? `View ${shot.detail.ordinalLabel}, ${shot.participantLabel}, ${shot.made ? 'made' : 'missed'} ${shot.value} point shot`
              : 'View shot detail'
          }}
          className="w-full"
        />
        {markers.length === 0 && (
          <div className="py-5 text-center text-sm text-slate-500">
            <CircleDot className="mx-auto text-slate-300" size={24} aria-hidden />
            <p className="mt-2 font-semibold">No located shots match these filters.</p>
          </div>
        )}
      </section>

      <ShotList
        title="Located shots"
        shots={locatedShots}
        emptyMessage="No located shots match these filters."
        onOpen={openDetail}
      />
      <ShotList
        title="Unlocated shots"
        shots={unlocatedShots}
        emptyMessage="No unlocated shots match these filters."
        onOpen={openDetail}
        unlocated
      />

      {overlapChoices.length > 1 && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/45 p-3 sm:items-center sm:p-4" onClick={closeOverlap}>
          <section
            ref={overlapDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="basketball-summary-overlap-title"
            className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
            onClick={event => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 id="basketball-summary-overlap-title" className="font-bold text-slate-900">Select shot</h2>
              <button type="button" onClick={closeOverlap} className="flex h-10 w-10 items-center justify-center rounded-md text-slate-600" aria-label="Close overlapping shots"><X size={18} /></button>
            </header>
            <div className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto">
              {overlapChoices.map((shot, index) => (
                <button
                  key={shot.id}
                  ref={index === 0 ? overlapFirstRef : undefined}
                  type="button"
                  onClick={() => {
                    setOverlapChoices([])
                    setDetail(shot.detail)
                  }}
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-blue-50"
                >
                  <ShotRowContent shot={shot} />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {detail && (
        <BasketballShotDetailDialog
          detail={detail}
          showCaptureSequence
          onClose={() => {
            setDetail(null)
            restoreFocus()
          }}
          onEdit={correctionsEnabled && !detail.removed ? () => {
            setDetail(null)
            setEditingShotId(detail.shotId)
          } : undefined}
          onRemove={correctionsEnabled && !detail.removed ? () => {
            setDetail(null)
            setCorrectionIntent({ kind: 'remove', eventId: detail.shotId, scope: 'event' })
          } : undefined}
        />
      )}

      {editingShotId && (
        <BasketballShotEditor
          eventId={editingShotId}
          onClose={() => {
            setEditingShotId(null)
            restoreFocus()
          }}
          onApplied={() => {
            setEditingShotId(null)
            restoreFocus()
          }}
        />
      )}

      {correctionIntent && (
        <BasketballTimelineCorrectionDialog
          intent={correctionIntent}
          onClose={() => {
            setCorrectionIntent(null)
            restoreFocus()
          }}
        />
      )}
    </main>
  )
}

function ShotList({
  title,
  shots,
  emptyMessage,
  onOpen,
  unlocated = false,
}: {
  title: string
  shots: BasketballSummaryShot[]
  emptyMessage: string
  onOpen: (shot: BasketballSummaryShot, trigger?: HTMLElement | null) => void
  unlocated?: boolean
}) {
  return (
    <section className="border-b border-slate-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <span className="text-xs font-bold text-slate-500">{shots.length}</span>
      </div>
      {unlocated && shots.length > 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-800">
          <MapPinOff size={14} aria-hidden /> These attempts count in totals but have no court marker.
        </p>
      )}
      {shots.length === 0 ? (
        <p className="py-5 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <ol className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {shots.map(shot => (
            <li key={shot.id}>
              <button
                type="button"
                onClick={event => onOpen(shot, event.currentTarget)}
                className="flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left active:bg-blue-50"
              >
                <ShotRowContent shot={shot} />
                <Eye size={16} className="shrink-0 text-slate-400" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function ShotRowContent({ shot }: { shot: BasketballSummaryShot }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold text-slate-900">{shot.detail.ordinalLabel}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
          shot.teamSide === 'tracked' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-900'
        }`}>
          {shot.teamSide === 'tracked' ? 'Tracked' : 'Opponent'}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-xs font-semibold text-slate-600">
        {shot.participantLabel} | {shot.periodLabel} | {shot.made ? 'Made' : 'Missed'} {shot.value}PT
      </span>
    </span>
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
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700">
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function LegendMark({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</span>
}

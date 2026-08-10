import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, CircleDot, Layers3 } from 'lucide-react'
import { useGame } from '../../context/GameContext'
import {
  BASKETBALL_TIMELINE_FAMILIES,
  basketballShotDetailFromReview,
  buildBasketballTimelineReview,
  filterBasketballTimelineGroups,
  type BasketballShotDetailModel,
  type BasketballTimelineEventReview,
  type BasketballTimelineFilters,
  type BasketballTimelineGroup,
} from '../../lib/basketball/timeline'
import BasketballShotDetailDialog from './BasketballShotDetailDialog'

export default function BasketballTimeline() {
  const { state } = useGame()
  const review = useMemo(() => buildBasketballTimelineReview(state), [state])
  const [filters, setFilters] = useState<BasketballTimelineFilters>(() => ({
    family: 'all',
    periodId: review.defaultPeriodId,
    teamSide: 'all',
    participantId: 'all',
  }))
  const [shotDetail, setShotDetail] = useState<BasketballShotDetailModel | null>(null)

  useEffect(() => {
    if (
      filters.periodId !== 'all' &&
      !review.periods.some(period => period.id === filters.periodId)
    ) {
      setFilters(current => ({ ...current, periodId: review.defaultPeriodId }))
    }
  }, [filters.periodId, review.defaultPeriodId, review.periods])

  const activeGroups = useMemo(
    () => filterBasketballTimelineGroups(review.activeGroups, filters),
    [filters, review.activeGroups]
  )
  const removedGroups = useMemo(
    () => filterBasketballTimelineGroups(review.removedGroups, filters),
    [filters, review.removedGroups]
  )
  const removedEventCount = removedGroups.reduce((sum, group) => sum + group.events.length, 0)

  const openShotDetail = (eventId: string) => {
    setShotDetail(basketballShotDetailFromReview(state, review, eventId))
  }

  return (
    <section
      id="basketball-timeline-panel"
      role="tabpanel"
      aria-labelledby="basketball-timeline-tab"
      className="mx-auto w-full max-w-lg pb-24"
    >
      <div className="border-y border-slate-200 bg-white px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="basketball-timeline-title" className="text-base font-bold text-slate-900">Timeline</h2>
            <p className="text-xs font-medium text-slate-500">
              {activeGroups.length} {activeGroups.length === 1 ? 'capture' : 'captures'}
            </p>
          </div>
          {!review.complete && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
              <AlertTriangle size={14} aria-hidden />
              Diagnostics
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <FilterSelect
            label="Event type"
            value={filters.family}
            onChange={value => setFilters(current => ({
              ...current,
              family: value as BasketballTimelineFilters['family'],
            }))}
            options={BASKETBALL_TIMELINE_FAMILIES.map(family => ({ value: family.id, label: family.label }))}
          />
          <FilterSelect
            label="Period"
            value={filters.periodId}
            onChange={value => setFilters(current => ({ ...current, periodId: value }))}
            options={[
              { value: 'all', label: 'Full match' },
              ...review.periods.map(period => ({ value: period.id, label: period.label })),
            ]}
          />
          <FilterSelect
            label="Side"
            value={filters.teamSide}
            onChange={value => setFilters(current => ({
              ...current,
              teamSide: value as BasketballTimelineFilters['teamSide'],
            }))}
            options={[
              { value: 'all', label: 'Both sides' },
              { value: 'tracked', label: state.gameInfo?.teamName || 'Tracked team' },
              { value: 'opponent', label: state.gameInfo?.opponentName || 'Opponent' },
            ]}
          />
          <FilterSelect
            label="Participant"
            value={filters.participantId}
            onChange={value => setFilters(current => ({ ...current, participantId: value }))}
            options={[
              { value: 'all', label: 'All participants' },
              ...review.participants.map(participant => ({ value: participant.id, label: participant.label })),
            ]}
          />
        </div>
      </div>

      {review.globalWarnings.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-3" role="status">
          {review.globalWarnings.map(warning => (
            <p key={warning} className="flex gap-2 text-sm font-medium text-amber-900">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} aria-hidden />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}

      <div className="px-3 py-3">
        {activeGroups.length === 0 ? (
          <div className="border-y border-slate-200 bg-white px-4 py-10 text-center">
            <CircleDot className="mx-auto text-slate-300" size={28} aria-hidden />
            <p className="mt-2 text-sm font-semibold text-slate-700">No matching events</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {activeGroups.map(group => (
              <li key={group.id}>
                <TimelineGroup group={group} onOpenShot={openShotDetail} />
              </li>
            ))}
          </ol>
        )}

        {review.removedGroups.length > 0 && (
          <details className="mt-4 border-y border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-bold text-slate-700">
              <span>Removed events ({removedEventCount})</span>
              <ChevronDown size={17} aria-hidden />
            </summary>
            <ol className="space-y-2 border-t border-slate-100 p-2">
              {removedGroups.length === 0 ? (
                <li className="px-3 py-5 text-center text-sm text-slate-500">No removed events match these filters.</li>
              ) : removedGroups.map(group => (
                <li key={group.id}>
                  <TimelineGroup group={group} onOpenShot={openShotDetail} removed />
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>

      {shotDetail && (
        <BasketballShotDetailDialog detail={shotDetail} onClose={() => setShotDetail(null)} />
      )}
    </section>
  )
}

function TimelineGroup({
  group,
  onOpenShot,
  removed = false,
}: {
  group: BasketballTimelineGroup
  onOpenShot: (eventId: string) => void
  removed?: boolean
}) {
  const grouped = group.captureCommandId !== null && group.events.length > 1
  if (!grouped) {
    return (
      <TimelineEventRow
        review={group.events[0]}
        group={group}
        onOpenShot={onOpenShot}
        removed={removed}
      />
    )
  }

  return (
    <details className={`overflow-hidden rounded-lg border bg-white ${removed ? 'border-slate-200 opacity-80' : 'border-slate-200'}`}>
      <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-3">
        <Layers3 className="mt-0.5 shrink-0 text-slate-500" size={18} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={`text-sm font-bold ${removed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
              {group.title}
            </p>
            <StatusBadges group={group} removed={removed} />
          </div>
          <p className="mt-0.5 truncate text-xs font-medium text-slate-600">
            {group.actorLabel} | {group.periodLabel} | {formatTimelineTime(group.occurredAt)}
          </p>
        </div>
        <ChevronDown className="mt-0.5 shrink-0 text-slate-400" size={17} aria-hidden />
      </summary>
      <div className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50 p-2">
        {group.events.map(review => (
          <TimelineEventRow
            key={review.id}
            review={review}
            group={group}
            onOpenShot={onOpenShot}
            removed={removed}
            nested
          />
        ))}
      </div>
    </details>
  )
}

function TimelineEventRow({
  review,
  group,
  onOpenShot,
  removed,
  nested = false,
}: {
  review: BasketballTimelineEventReview
  group: BasketballTimelineGroup
  onOpenShot: (eventId: string) => void
  removed: boolean
  nested?: boolean
}) {
  const shot = review.event.eventType === 'basketball.shot'
  const content = (
    <>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={`text-sm font-bold ${removed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
            {review.title}
          </p>
          {!nested && <StatusBadges group={group} removed={removed} />}
          {review.revised && nested && (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">Revised</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs font-medium text-slate-600">
          {review.actorLabel} | {review.periodLabel} | {formatTimelineTime(review.event.occurredAt)}
        </p>
        {review.relationshipLabels.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">{review.relationshipLabels.join(' | ')}</p>
        )}
        {review.warnings.map(warning => (
          <p key={warning} className="mt-1 flex gap-1.5 text-xs font-medium text-amber-800">
            <AlertTriangle className="mt-0.5 shrink-0" size={13} aria-hidden />
            <span>{warning}</span>
          </p>
        ))}
      </div>
      {shot && <span className="shrink-0 text-xs font-bold text-blue-700">View</span>}
    </>
  )
  const className = `${nested ? 'rounded-md px-2.5 py-2' : 'rounded-lg border border-slate-200 bg-white px-3 py-3'} flex w-full items-start gap-3`

  return shot ? (
    <button type="button" className={`${className} active:bg-blue-50`} onClick={() => onOpenShot(review.id)}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  )
}

function StatusBadges({ group, removed }: { group: BasketballTimelineGroup; removed: boolean }) {
  return (
    <>
      {removed && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Removed</span>}
      {group.revised && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">Revised</span>}
      {group.boundary && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">Boundary</span>}
      {!removed && group.removedCompanionCount > 0 && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
          {group.removedCompanionCount} removed
        </span>
      )}
    </>
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
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function formatTimelineTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

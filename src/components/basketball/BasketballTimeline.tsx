import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, CircleDot, Eye, Layers3, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useGame } from '../../context/GameContext'
import {
  isBasketballEditableRelatedEvent,
  type BasketballHistoricalRelatedEventType,
} from '../../lib/basketball/relatedEventEditCommands'
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
import BasketballShotEditor from './BasketballShotEditor'
import BasketballHistoricalShotEditor from './BasketballHistoricalShotEditor'
import BasketballAddEventChooser from './BasketballAddEventChooser'
import BasketballEventDetailDialog from './BasketballEventDetailDialog'
import BasketballHistoricalRelatedEventEditor from './BasketballHistoricalRelatedEventEditor'
import BasketballRelatedEventEditor from './BasketballRelatedEventEditor'
import BasketballTimelineCorrectionDialog, {
  type BasketballTimelineCorrectionIntent,
} from './BasketballTimelineCorrectionDialog'
import {
  basketballManualMinutesAvailable,
  isBasketballEditableValueEvent,
  type BasketballEditableValueEventType,
} from '../../lib/basketball/valueEventEditCommands'
import BasketballValueEventEditor from './BasketballValueEventEditor'
import { basketballRecoverableScoreAdjustmentId } from '../../lib/basketball/scoreAdjustmentRecovery'

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
  const [correctionIntent, setCorrectionIntent] = useState<BasketballTimelineCorrectionIntent | null>(null)
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const [eventDetail, setEventDetail] = useState<BasketballTimelineEventReview | null>(null)
  const [editingRelatedEventId, setEditingRelatedEventId] = useState<string | null>(null)
  const [editingValueEventId, setEditingValueEventId] = useState<string | null>(null)
  const [highlightEventId, setHighlightEventId] = useState<string | null>(null)
  const [showAddChooser, setShowAddChooser] = useState(false)
  const [addingShot, setAddingShot] = useState(false)
  const [addingRelatedType, setAddingRelatedType] = useState<BasketballHistoricalRelatedEventType | null>(null)
  const [addingValueType, setAddingValueType] = useState<BasketballEditableValueEventType | null>(null)

  useEffect(() => {
    if (!highlightEventId) return
    const timer = window.setTimeout(() => setHighlightEventId(null), 1_600)
    return () => window.clearTimeout(timer)
  }, [highlightEventId])

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
  const correctionsEnabled = review.complete && state.sportGameState?.sportId === 'basketball' && (
    state.sportGameState.projection.status === 'in_progress' ||
    state.sportGameState.projection.status === 'period_break'
  )
  const recoveryEventId = review.complete
    ? null
    : basketballRecoverableScoreAdjustmentId(state, review.diagnostics)

  const openShotDetail = (eventId: string) => {
    setShotDetail(basketballShotDetailFromReview(state, review, eventId))
  }

  const openEventDetail = (eventId: string) => {
    setEventDetail(review.eventById.get(eventId) ?? null)
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
          {correctionsEnabled && (
            <button
              type="button"
              onClick={() => setShowAddChooser(true)}
              className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-sm"
            >
              <Plus size={16} aria-hidden />
              Add event
            </button>
          )}
          {!review.complete && !correctionsEnabled && (
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
                <TimelineGroup
                  group={group}
                  onOpenShot={openShotDetail}
                  onOpenEvent={openEventDetail}
                  onCorrect={setCorrectionIntent}
                  correctionsEnabled={correctionsEnabled}
                  recoveryEventId={recoveryEventId}
                  highlightEventId={highlightEventId}
                />
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
                  <TimelineGroup
                    group={group}
                    onOpenShot={openShotDetail}
                    onOpenEvent={openEventDetail}
                    onCorrect={setCorrectionIntent}
                    correctionsEnabled={correctionsEnabled}
                    recoveryEventId={recoveryEventId}
                    highlightEventId={highlightEventId}
                    removed
                  />
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>

      {shotDetail && (
        <BasketballShotDetailDialog
          detail={shotDetail}
          onClose={() => setShotDetail(null)}
          onEdit={correctionsEnabled && shotDetail.source === 'event' && !shotDetail.removed
            ? () => {
                setShotDetail(null)
                setEditingShotId(shotDetail.shotId)
              }
            : undefined}
          onRemove={correctionsEnabled && shotDetail.source === 'event' && !shotDetail.removed
            ? () => {
                setShotDetail(null)
                setCorrectionIntent({ kind: 'remove', eventId: shotDetail.shotId, scope: 'event' })
              }
            : undefined}
          onRestore={correctionsEnabled && shotDetail.source === 'event' && shotDetail.removed
            ? () => {
                setShotDetail(null)
                setCorrectionIntent({ kind: 'restore', eventId: shotDetail.shotId })
              }
            : undefined}
        />
      )}

      {eventDetail && (
        <BasketballEventDetailDialog
          review={eventDetail}
          teamLabel={eventDetail.teamSide === 'tracked'
            ? state.gameInfo?.teamName || 'Tracked team'
            : state.gameInfo?.opponentName || 'Opponent'}
          onClose={() => setEventDetail(null)}
          onEdit={(correctionsEnabled || eventDetail.id === recoveryEventId) && !eventDetail.removed
            ? () => {
                if (isBasketballEditableValueEvent(eventDetail.event)) setEditingValueEventId(eventDetail.id)
                else setEditingRelatedEventId(eventDetail.id)
                setEventDetail(null)
              }
            : undefined}
          onRemove={(correctionsEnabled || eventDetail.id === recoveryEventId) && !eventDetail.removed
            ? () => {
                setCorrectionIntent({ kind: 'remove', eventId: eventDetail.id, scope: 'event' })
                setEventDetail(null)
              }
            : undefined}
        />
      )}

      {correctionIntent && (
        <BasketballTimelineCorrectionDialog
          intent={correctionIntent}
          onClose={() => setCorrectionIntent(null)}
          onApplied={() => setShotDetail(null)}
        />
      )}

      {editingShotId && (
        <BasketballShotEditor
          eventId={editingShotId}
          onClose={() => setEditingShotId(null)}
          onApplied={eventId => {
            setEditingShotId(null)
            setHighlightEventId(eventId)
          }}
        />
      )}

      {editingRelatedEventId && (
        <BasketballRelatedEventEditor
          eventId={editingRelatedEventId}
          onClose={() => setEditingRelatedEventId(null)}
          onApplied={eventId => {
            setEditingRelatedEventId(null)
            setHighlightEventId(eventId)
          }}
        />
      )}

      {editingValueEventId && (
        <BasketballValueEventEditor
          mode="edit"
          eventId={editingValueEventId}
          onClose={() => setEditingValueEventId(null)}
          onApplied={eventId => {
            setEditingValueEventId(null)
            setHighlightEventId(eventId)
          }}
        />
      )}

      {showAddChooser && (
        <BasketballAddEventChooser
          onClose={() => setShowAddChooser(false)}
          onShot={() => {
            setShowAddChooser(false)
            setAddingShot(true)
          }}
          onRelated={eventType => {
            setShowAddChooser(false)
            setAddingRelatedType(eventType)
          }}
          onValue={eventType => {
            setShowAddChooser(false)
            setAddingValueType(eventType)
          }}
          minutesAvailable={basketballManualMinutesAvailable(state)}
        />
      )}

      {addingShot && (
        <BasketballHistoricalShotEditor
          onClose={() => setAddingShot(false)}
          onApplied={eventId => {
            setAddingShot(false)
            setHighlightEventId(eventId)
          }}
        />
      )}

      {addingRelatedType && (
        <BasketballHistoricalRelatedEventEditor
          eventType={addingRelatedType}
          onClose={() => setAddingRelatedType(null)}
          onApplied={eventId => {
            setAddingRelatedType(null)
            setHighlightEventId(eventId)
          }}
        />
      )}

      {addingValueType && (
        <BasketballValueEventEditor
          mode="add"
          eventType={addingValueType}
          onClose={() => setAddingValueType(null)}
          onApplied={eventId => {
            setAddingValueType(null)
            setHighlightEventId(eventId)
          }}
        />
      )}
    </section>
  )
}

function TimelineGroup({
  group,
  onOpenShot,
  onOpenEvent,
  onCorrect,
  correctionsEnabled,
  recoveryEventId,
  highlightEventId,
  removed = false,
}: {
  group: BasketballTimelineGroup
  onOpenShot: (eventId: string) => void
  onOpenEvent: (eventId: string) => void
  onCorrect: (intent: BasketballTimelineCorrectionIntent) => void
  correctionsEnabled: boolean
  recoveryEventId: string | null
  highlightEventId: string | null
  removed?: boolean
}) {
  const grouped = group.captureCommandId !== null && group.events.length > 1
  if (!grouped) {
    return (
      <TimelineEventRow
        review={group.events[0]}
        group={group}
        onOpenShot={onOpenShot}
        onOpenEvent={onOpenEvent}
        onCorrect={onCorrect}
        correctionsEnabled={correctionsEnabled}
        recoveryEventId={recoveryEventId}
        highlighted={highlightEventId === group.events[0].id}
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
            onOpenEvent={onOpenEvent}
            onCorrect={onCorrect}
            correctionsEnabled={correctionsEnabled}
            recoveryEventId={recoveryEventId}
            highlighted={highlightEventId === review.id}
            removed={removed}
            nested
          />
        ))}
        {correctionsEnabled && !removed && !group.boundary && (
          <button
            type="button"
            onClick={() => onCorrect({
              kind: 'remove',
              eventId: group.events[0].id,
              scope: 'capture_group',
            })}
            className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-white text-sm font-bold text-rose-800"
          >
            <Trash2 size={16} aria-hidden />
            Remove capture
          </button>
        )}
      </div>
    </details>
  )
}

function TimelineEventRow({
  review,
  group,
  onOpenShot,
  onOpenEvent,
  onCorrect,
  correctionsEnabled,
  recoveryEventId,
  removed,
  highlighted = false,
  nested = false,
}: {
  review: BasketballTimelineEventReview
  group: BasketballTimelineGroup
  onOpenShot: (eventId: string) => void
  onOpenEvent: (eventId: string) => void
  onCorrect: (intent: BasketballTimelineCorrectionIntent) => void
  correctionsEnabled: boolean
  recoveryEventId: string | null
  removed: boolean
  highlighted?: boolean
  nested?: boolean
}) {
  const shot = review.event.eventType === 'basketball.shot'
  const relatedEvent = isBasketballEditableRelatedEvent(review.event) || isBasketballEditableValueEvent(review.event)
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
          {review.recordedLater && nested && (
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">Recorded later</span>
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
      <div className="flex shrink-0 items-center gap-1">
        {shot && (
          <button
            type="button"
            onClick={() => onOpenShot(review.id)}
            className="flex h-10 w-10 items-center justify-center rounded-md text-blue-700 active:bg-blue-50"
            aria-label={`View ${review.title}`}
            title="View details"
          >
            <Eye size={17} aria-hidden />
          </button>
        )}
        {relatedEvent && (
          <button
            type="button"
            onClick={() => onOpenEvent(review.id)}
            className="flex h-10 w-10 items-center justify-center rounded-md text-blue-700 active:bg-blue-50"
            aria-label={`View ${review.title}`}
            title="View details"
          >
            <Eye size={17} aria-hidden />
          </button>
        )}
        {(correctionsEnabled || review.id === recoveryEventId) && !review.boundary && (
          <button
            type="button"
            onClick={() => onCorrect(removed
              ? { kind: 'restore', eventId: review.id }
              : { kind: 'remove', eventId: review.id, scope: 'event' })}
            className={`flex h-10 w-10 items-center justify-center rounded-md ${
              removed ? 'text-blue-700 active:bg-blue-50' : 'text-rose-700 active:bg-rose-50'
            }`}
            aria-label={`${removed ? 'Restore' : 'Remove'} ${review.title}`}
            title={removed ? 'Restore event' : 'Remove event'}
          >
            {removed ? <RotateCcw size={17} aria-hidden /> : <Trash2 size={17} aria-hidden />}
          </button>
        )}
      </div>
    </>
  )
  const className = `${nested ? 'rounded-md px-2.5 py-2' : 'rounded-lg border border-slate-200 bg-white px-3 py-3'} ${
    highlighted ? 'ring-2 ring-emerald-400 ring-offset-1' : ''
  } flex w-full items-start gap-3`

  return <div className={className}>{content}</div>
}

function StatusBadges({ group, removed }: { group: BasketballTimelineGroup; removed: boolean }) {
  return (
    <>
      {removed && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Removed</span>}
      {group.revised && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">Revised</span>}
      {group.recordedLater && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">Recorded later</span>}
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

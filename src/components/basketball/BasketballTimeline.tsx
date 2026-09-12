import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, CircleDot, Eye, Layers3, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useGame } from '../../context/GameContext'
import type { GameState } from '../../types'
import { gameSideDisplayName } from '../../lib/display'
import {
  isBasketballEditableRelatedEvent,
  type BasketballHistoricalRelatedEventType,
} from '../../lib/basketball/relatedEventEditCommands'
import {
  BASKETBALL_TIMELINE_FAMILIES,
  basketballShotDetailFromReview,
  basketballTimelineCorrectionsEnabled,
  buildBasketballTimelineReview,
  filterBasketballTimelineGroups,
  groupBasketballTimelineByPeriod,
  type BasketballShotDetailModel,
  type BasketballTimelineEventReview,
  type BasketballTimelineFilters,
  type BasketballTimelineGroup,
  type BasketballTimelinePeriodGroup,
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
import {
  isBasketballEditableFoulFreeThrowEvent,
  type BasketballFoulFreeThrowDraftType,
} from '../../lib/basketball/foulFreeThrowEditCommands'
import BasketballFoulFreeThrowEditor from './BasketballFoulFreeThrowEditor'
import {
  isBasketballEditableAdministrationEvent,
  type BasketballEditableAdministrationEventType,
} from '../../lib/basketball/administrationEditCommands'
import BasketballAdministrationEditor from './BasketballAdministrationEditor'
import {
  isBasketballEditableLineupEvent,
} from '../../lib/basketball/lineupCorrectionCommands'
import BasketballLineupCorrectionEditor from './BasketballLineupCorrectionEditor'

interface Props {
  reviewState?: GameState
  mode?: 'tracker' | 'summary'
  editingEnabled?: boolean
  onOpenOwnedRecording?: () => void
}

export default function BasketballTimeline({
  reviewState,
  mode = 'tracker',
  editingEnabled,
  onOpenOwnedRecording,
}: Props = {}) {
  const { state: contextState } = useGame()
  const state = reviewState ?? contextState
  const summaryMode = mode === 'summary'
  const trackedSideLabel = summaryMode
    ? state.gameInfo?.teamName || 'Tracked team'
    : gameSideDisplayName(state.gameInfo, 'tracked', 'Tracked team')
  const opponentSideLabel = summaryMode
    ? state.gameInfo?.opponentName || 'Opponent'
    : gameSideDisplayName(state.gameInfo, 'opponent')
  const allowMutations = editingEnabled ?? !summaryMode
  const review = useMemo(
    () => buildBasketballTimelineReview(state, {
      groupOrder: summaryMode ? 'oldest_first' : 'newest_first',
    }),
    [state, summaryMode]
  )
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
  const [editingFoulFreeThrowEventId, setEditingFoulFreeThrowEventId] = useState<string | null>(null)
  const [editingAdministrationEventId, setEditingAdministrationEventId] = useState<string | null>(null)
  const [editingLineupEventId, setEditingLineupEventId] = useState<string | null>(null)
  const [highlightEventId, setHighlightEventId] = useState<string | null>(null)
  const [showAddChooser, setShowAddChooser] = useState(false)
  const [addingShot, setAddingShot] = useState(false)
  const [addingRelatedType, setAddingRelatedType] = useState<BasketballHistoricalRelatedEventType | null>(null)
  const [addingValueType, setAddingValueType] = useState<BasketballEditableValueEventType | null>(null)
  const [addingFoulFreeThrowType, setAddingFoulFreeThrowType] = useState<BasketballFoulFreeThrowDraftType | null>(null)
  const [addingAdministrationType, setAddingAdministrationType] = useState<BasketballEditableAdministrationEventType | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const rememberFocus = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  }

  const restoreFocus = () => {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    window.setTimeout(() => target?.focus(), 0)
  }

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
  const activePeriodGroups = useMemo(
    () => groupBasketballTimelineByPeriod(activeGroups, review.periods),
    [activeGroups, review.periods]
  )
  const removedPeriodGroups = useMemo(
    () => groupBasketballTimelineByPeriod(removedGroups, review.periods),
    [removedGroups, review.periods]
  )
  const removedEventCount = removedGroups.reduce((sum, group) => sum + group.events.length, 0)
  const correctionsEnabled = review.complete &&
    basketballTimelineCorrectionsEnabled(state, allowMutations)
  const recoveryEventId = review.complete || !allowMutations
    ? null
    : basketballRecoverableScoreAdjustmentId(state, review.diagnostics)

  const openShotDetail = (eventId: string) => {
    rememberFocus()
    setShotDetail(basketballShotDetailFromReview(state, review, eventId))
  }

  const openEventDetail = (eventId: string) => {
    rememberFocus()
    setEventDetail(review.eventById.get(eventId) ?? null)
  }

  const openCorrection = (intent: BasketballTimelineCorrectionIntent) => {
    rememberFocus()
    setCorrectionIntent(intent)
  }

  return (
    <section
      id="basketball-timeline-panel"
      role="tabpanel"
      aria-labelledby="basketball-timeline-tab"
      className="mx-auto w-full max-w-lg pb-24"
    >
      <div className="border-y border-line bg-surface px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="basketball-timeline-title" className="text-base font-bold text-content">Timeline</h2>
            <p className="text-xs font-medium text-content-subtle">
              {activeGroups.length} {activeGroups.length === 1 ? 'capture' : 'captures'}
            </p>
          </div>
          {correctionsEnabled && (
            <button
              type="button"
              onClick={() => {
                rememberFocus()
                setShowAddChooser(true)
              }}
              className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-sm"
            >
              <Plus size={16} aria-hidden />
              Add event
            </button>
          )}
          {!correctionsEnabled && onOpenOwnedRecording && (
            <button
              type="button"
              onClick={onOpenOwnedRecording}
              className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-sm"
            >
              <Play size={16} aria-hidden />
              Open owned recording
            </button>
          )}
          {!review.complete && !correctionsEnabled && (
            <span className="inline-flex items-center gap-1 rounded-md bg-warning px-2 py-1 text-xs font-semibold text-warning-content">
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
              { value: 'tracked', label: trackedSideLabel },
              { value: 'opponent', label: opponentSideLabel },
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
        <div className="border-b border-warning-line bg-warning px-3 py-3" role="status">
          {review.globalWarnings.map(warning => (
            <p key={warning} className="flex gap-2 text-sm font-medium text-warning-content">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} aria-hidden />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}

      <div className="px-3 py-3">
        {activeGroups.length === 0 ? (
          <div className="border-y border-line bg-surface px-4 py-10 text-center">
            <CircleDot className="mx-auto text-content" size={28} aria-hidden />
            <p className="mt-2 text-sm font-semibold text-content">No matching events</p>
          </div>
        ) : summaryMode ? (
          <TimelinePeriodGroups
            sections={activePeriodGroups}
            onOpenShot={openShotDetail}
            onOpenEvent={openEventDetail}
            onCorrect={openCorrection}
            correctionsEnabled={correctionsEnabled}
            recoveryEventId={recoveryEventId}
            highlightEventId={highlightEventId}
            summaryMode
          />
        ) : (
          <ol className="space-y-2">
            {activeGroups.map(group => (
              <li key={group.id}>
                <TimelineGroup
                  group={group}
                  onOpenShot={openShotDetail}
                  onOpenEvent={openEventDetail}
                  onCorrect={openCorrection}
                  correctionsEnabled={correctionsEnabled}
                  recoveryEventId={recoveryEventId}
                  highlightEventId={highlightEventId}
                  summaryMode={false}
                />
              </li>
            ))}
          </ol>
        )}

        {review.removedGroups.length > 0 && (
          <details className="mt-4 border-y border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-bold text-content">
              <span>Removed events ({removedEventCount})</span>
              <ChevronDown size={17} aria-hidden />
            </summary>
            <ol className="space-y-2 border-t border-line p-2">
              {removedGroups.length === 0 ? (
                <li className="px-3 py-5 text-center text-sm text-content-subtle">No removed events match these filters.</li>
              ) : summaryMode ? (
                <li>
                  <TimelinePeriodGroups
                    sections={removedPeriodGroups}
                    onOpenShot={openShotDetail}
                    onOpenEvent={openEventDetail}
                    onCorrect={openCorrection}
                    correctionsEnabled={correctionsEnabled}
                    recoveryEventId={recoveryEventId}
                    highlightEventId={highlightEventId}
                    summaryMode
                    removed
                  />
                </li>
              ) : removedGroups.map(group => (
                <li key={group.id}>
                  <TimelineGroup
                    group={group}
                    onOpenShot={openShotDetail}
                    onOpenEvent={openEventDetail}
                    onCorrect={openCorrection}
                    correctionsEnabled={correctionsEnabled}
                    recoveryEventId={recoveryEventId}
                    highlightEventId={highlightEventId}
                    removed
                    summaryMode={false}
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
          onClose={() => {
            setShotDetail(null)
            restoreFocus()
          }}
          onEdit={correctionsEnabled && shotDetail.source === 'event' && !shotDetail.removed
            ? () => {
                setShotDetail(null)
                const event = review.eventById.get(shotDetail.shotId)?.event
                if (event && isBasketballEditableFoulFreeThrowEvent(event) && event.eventType === 'basketball.shot') {
                  setEditingFoulFreeThrowEventId(shotDetail.shotId)
                } else {
                  setEditingShotId(shotDetail.shotId)
                }
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
          showCaptureSequence={summaryMode}
        />
      )}

      {eventDetail && (
        <BasketballEventDetailDialog
          review={eventDetail}
          participantLabel={participantId => {
            const participant = state.sportGameState?.sportId === 'basketball'
              ? state.sportGameState.projection.participants[participantId]
              : null
            return participant
              ? `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`
              : 'Unknown participant'
          }}
          teamLabel={eventDetail.teamSide === 'tracked'
            ? trackedSideLabel
            : eventDetail.teamSide === 'opponent'
              ? opponentSideLabel
              : 'Game administration'}
          onClose={() => {
            setEventDetail(null)
            restoreFocus()
          }}
          onEdit={(correctionsEnabled || eventDetail.id === recoveryEventId) &&
            !eventDetail.removed && (
              isBasketballEditableFoulFreeThrowEvent(eventDetail.event) ||
              isBasketballEditableValueEvent(eventDetail.event) ||
              isBasketballEditableRelatedEvent(eventDetail.event) ||
              isBasketballEditableAdministrationEvent(eventDetail.event) ||
              isBasketballEditableLineupEvent(eventDetail.event)
            )
            ? () => {
                if (isBasketballEditableFoulFreeThrowEvent(eventDetail.event)) setEditingFoulFreeThrowEventId(eventDetail.id)
                else if (isBasketballEditableValueEvent(eventDetail.event)) setEditingValueEventId(eventDetail.id)
                else if (isBasketballEditableRelatedEvent(eventDetail.event)) setEditingRelatedEventId(eventDetail.id)
                else if (isBasketballEditableAdministrationEvent(eventDetail.event)) setEditingAdministrationEventId(eventDetail.id)
                else setEditingLineupEventId(eventDetail.id)
                setEventDetail(null)
              }
            : undefined}
          onRemove={(correctionsEnabled || eventDetail.id === recoveryEventId) && !eventDetail.removed
            ? () => {
                setCorrectionIntent({ kind: 'remove', eventId: eventDetail.id, scope: 'event' })
                setEventDetail(null)
              }
            : undefined}
          captureLabel={summaryMode ? eventDetail.sequenceLabel : undefined}
        />
      )}

      {correctionIntent && (
        <BasketballTimelineCorrectionDialog
          intent={correctionIntent}
          onClose={() => {
            setCorrectionIntent(null)
            restoreFocus()
          }}
          onApplied={() => setShotDetail(null)}
        />
      )}

      {editingShotId && (
        <BasketballShotEditor
          eventId={editingShotId}
          onClose={() => {
            setEditingShotId(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setEditingShotId(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {editingRelatedEventId && (
        <BasketballRelatedEventEditor
          eventId={editingRelatedEventId}
          onClose={() => {
            setEditingRelatedEventId(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setEditingRelatedEventId(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {editingValueEventId && (
        <BasketballValueEventEditor
          mode="edit"
          eventId={editingValueEventId}
          onClose={() => {
            setEditingValueEventId(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setEditingValueEventId(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {editingFoulFreeThrowEventId && (
        <BasketballFoulFreeThrowEditor
          mode="edit"
          eventId={editingFoulFreeThrowEventId}
          onClose={() => {
            setEditingFoulFreeThrowEventId(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setEditingFoulFreeThrowEventId(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {editingAdministrationEventId && (
        <BasketballAdministrationEditor
          mode="edit"
          eventId={editingAdministrationEventId}
          onClose={() => {
            setEditingAdministrationEventId(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setEditingAdministrationEventId(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {editingLineupEventId && (
        <BasketballLineupCorrectionEditor
          eventId={editingLineupEventId}
          onClose={() => {
            setEditingLineupEventId(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setEditingLineupEventId(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {showAddChooser && (
        <BasketballAddEventChooser
          onClose={() => {
            setShowAddChooser(false)
            restoreFocus()
          }}
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
          onFoulFreeThrow={eventType => {
            setShowAddChooser(false)
            setAddingFoulFreeThrowType(eventType)
          }}
          onAdministration={eventType => {
            setShowAddChooser(false)
            setAddingAdministrationType(eventType)
          }}
          minutesAvailable={basketballManualMinutesAvailable(state)}
        />
      )}

      {addingShot && (
        <BasketballHistoricalShotEditor
          onClose={() => {
            setAddingShot(false)
            restoreFocus()
          }}
          onApplied={eventId => {
            setAddingShot(false)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {addingRelatedType && (
        <BasketballHistoricalRelatedEventEditor
          eventType={addingRelatedType}
          onClose={() => {
            setAddingRelatedType(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setAddingRelatedType(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {addingValueType && (
        <BasketballValueEventEditor
          mode="add"
          eventType={addingValueType}
          onClose={() => {
            setAddingValueType(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setAddingValueType(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {addingFoulFreeThrowType && (
        <BasketballFoulFreeThrowEditor
          mode="add"
          eventType={addingFoulFreeThrowType}
          onClose={() => {
            setAddingFoulFreeThrowType(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setAddingFoulFreeThrowType(null)
            setHighlightEventId(eventId)
            restoreFocus()
          }}
        />
      )}

      {addingAdministrationType && (
        <BasketballAdministrationEditor
          mode="add"
          eventType={addingAdministrationType}
          onClose={() => {
            setAddingAdministrationType(null)
            restoreFocus()
          }}
          onApplied={eventId => {
            setAddingAdministrationType(null)
            setHighlightEventId(eventId)
            restoreFocus()
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
  summaryMode,
  removed = false,
}: {
  group: BasketballTimelineGroup
  onOpenShot: (eventId: string) => void
  onOpenEvent: (eventId: string) => void
  onCorrect: (intent: BasketballTimelineCorrectionIntent) => void
  correctionsEnabled: boolean
  recoveryEventId: string | null
  highlightEventId: string | null
  summaryMode: boolean
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
        summaryMode={summaryMode}
        removed={removed}
      />
    )
  }

  return (
    <details className={`overflow-hidden rounded-lg border bg-surface ${removed ? 'border-line opacity-80' : 'border-line'}`}>
      <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-3">
        <Layers3 className="mt-0.5 shrink-0 text-content-subtle" size={18} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={`text-sm font-bold ${removed ? 'text-content-subtle line-through' : 'text-content'}`}>
              {group.title}
            </p>
            <StatusBadges group={group} removed={removed} />
          </div>
          <p className="mt-0.5 truncate text-xs font-medium text-content-muted">
            {group.actorLabel} | {group.periodLabel} | {summaryMode ? group.sequenceLabel : formatTimelineTime(group.occurredAt)}
          </p>
        </div>
        <ChevronDown className="mt-0.5 shrink-0 text-content-subtle" size={17} aria-hidden />
      </summary>
      <div className="divide-y divide-line border-t border-line bg-surface-muted p-2">
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
            summaryMode={summaryMode}
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
            className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-danger-line bg-surface text-sm font-bold text-danger-content"
          >
            <Trash2 size={16} aria-hidden />
            Remove capture
          </button>
        )}
        {correctionsEnabled && removed && !group.boundary && (
          <button
            type="button"
            onClick={() => onCorrect({
              kind: 'restore',
              eventId: group.events[0].id,
              scope: 'capture_group',
            })}
            className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-info-line bg-surface text-sm font-bold text-info-content"
          >
            <RotateCcw size={16} aria-hidden />
            Restore capture
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
  summaryMode,
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
  summaryMode: boolean
  highlighted?: boolean
  nested?: boolean
}) {
  const shot = review.event.eventType === 'basketball.shot'
  const detailAvailable = !shot
  const content = (
    <>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={`text-sm font-bold ${removed ? 'text-content-subtle line-through' : 'text-content'}`}>
            {review.title}
          </p>
          {!nested && <StatusBadges group={group} removed={removed} />}
          {review.revised && nested && (
            <span className="rounded bg-info px-1.5 py-0.5 text-[10px] font-bold text-info-content">Revised</span>
          )}
          {review.recordedLater && nested && (
            <span className="rounded bg-info px-1.5 py-0.5 text-[10px] font-bold text-info-content">Recorded later</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs font-medium text-content-muted">
          {review.actorLabel} | {review.periodLabel} | {summaryMode ? review.sequenceLabel : formatTimelineTime(review.event.occurredAt)}
        </p>
        {review.relationshipLabels.length > 0 && (
          <p className="mt-1 text-xs text-content-subtle">{review.relationshipLabels.join(' | ')}</p>
        )}
        {review.warnings.map(warning => (
          <p key={warning} className="mt-1 flex gap-1.5 text-xs font-medium text-warning-content">
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-info-content active:bg-info"
            aria-label={`View ${review.title}`}
            title="View details"
          >
            <Eye size={17} aria-hidden />
          </button>
        )}
        {detailAvailable && (
          <button
            type="button"
            onClick={() => onOpenEvent(review.id)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-info-content active:bg-info"
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
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
              removed ? 'text-info-content active:bg-info' : 'text-danger-content active:bg-danger'
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
  const className = `${nested ? 'rounded-md px-2.5 py-2' : 'rounded-lg border border-line bg-surface px-3 py-3'} ${
    highlighted ? 'ring-2 ring-success-line ring-offset-1 ring-offset-surface' : ''
  } flex w-full items-start gap-3`

  return <div className={className}>{content}</div>
}

function TimelinePeriodGroups({
  sections,
  onOpenShot,
  onOpenEvent,
  onCorrect,
  correctionsEnabled,
  recoveryEventId,
  highlightEventId,
  summaryMode,
  removed = false,
}: {
  sections: BasketballTimelinePeriodGroup[]
  onOpenShot: (eventId: string) => void
  onOpenEvent: (eventId: string) => void
  onCorrect: (intent: BasketballTimelineCorrectionIntent) => void
  correctionsEnabled: boolean
  recoveryEventId: string | null
  highlightEventId: string | null
  summaryMode: boolean
  removed?: boolean
}) {
  return (
    <div className="space-y-4">
      {sections.map(section => (
        <section key={section.periodId} aria-labelledby={`basketball-timeline-period-${removed ? 'removed-' : ''}${section.periodId}`}>
          <h3
            id={`basketball-timeline-period-${removed ? 'removed-' : ''}${section.periodId}`}
            className="mb-2 text-xs font-bold uppercase text-content-subtle"
          >
            {section.periodLabel}
          </h3>
          <ol className="space-y-2">
            {section.groups.map(group => (
              <li key={group.id}>
                <TimelineGroup
                  group={group}
                  onOpenShot={onOpenShot}
                  onOpenEvent={onOpenEvent}
                  onCorrect={onCorrect}
                  correctionsEnabled={correctionsEnabled}
                  recoveryEventId={recoveryEventId}
                  highlightEventId={highlightEventId}
                  summaryMode={summaryMode}
                  removed={removed}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function StatusBadges({ group, removed }: { group: BasketballTimelineGroup; removed: boolean }) {
  return (
    <>
      {removed && <span className="rounded bg-control px-1.5 py-0.5 text-[10px] font-bold text-content">Removed</span>}
      {group.revised && <span className="rounded bg-info px-1.5 py-0.5 text-[10px] font-bold text-info-content">Revised</span>}
      {group.recordedLater && <span className="rounded bg-info px-1.5 py-0.5 text-[10px] font-bold text-info-content">Recorded later</span>}
      {group.boundary && <span className="rounded bg-warning px-1.5 py-0.5 text-[10px] font-bold text-warning-content">Boundary</span>}
      {!removed && group.removedCompanionCount > 0 && (
        <span className="rounded bg-control px-1.5 py-0.5 text-[10px] font-bold text-content-muted">
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
      <span className="mb-1 block text-[11px] font-semibold uppercase text-content-subtle">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-sm font-semibold text-content"
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

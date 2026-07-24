import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { GameState } from '../../types'
import ConfirmDialog from '../ConfirmDialog'
import SoccerIncidentCaptureDialog, {
  type SoccerIncidentDraft,
  type SoccerIncidentKind,
} from './SoccerIncidentCaptureDialog'
import SoccerScoreTimelineDialog from './SoccerScoreTimelineDialog'
import SoccerShotCaptureDialog, {
  type SoccerCaptureDraft,
} from './SoccerShotCaptureDialog'
import SoccerLocatedEventEditor from './SoccerLocatedEventEditor'
import {
  deleteSoccerHistoryEvent,
  formatSoccerInputTime,
  isSoccerLocatedEditableEvent,
  parseSoccerInputTime,
  restoreSoccerHistoryEvent,
  SOCCER_SUMMARY_TIMELINE_FILTERS,
  soccerEventMatchesTimelineFilter,
  soccerEventTimeLabel,
  soccerPeriodTimings,
  soccerSummaryTimelineReview,
  updateSoccerHistoryEvent,
  type SoccerLiveResult,
  type SoccerMatchEvent,
  type SoccerMatchRules,
  type SoccerRole,
  type SoccerRoleGroup,
  type SoccerScoreAdjustmentEvent,
  type SoccerSummaryTimelineFilter,
  type SoccerSummaryTimelineSection,
  type SoccerTimelineFilter,
  withSoccerTieResolution,
} from '../../lib/soccer'
import type {
  GameEvent,
  GameEventInspection,
  GameEventTeamSide,
} from '../../lib/gameEvents/types'

interface SoccerTimelineProps {
  state: GameState
  inspection: GameEventInspection
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  recorderUserId: string | null
  selectedParticipantId?: string | null
  defaultTeamSide?: GameEventTeamSide
  onTrackedParticipantUsed?: (participantId: string) => void
  allowAddEvent?: boolean
  readOnly?: boolean
  presentation?: 'live' | 'review'
}

const ROLE_OPTIONS: Array<{ value: SoccerRoleGroup; label: string }> = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
  { value: 'custom', label: 'Custom' },
]

const LIVE_TIMELINE_FILTERS: ReadonlyArray<{
  id: SoccerTimelineFilter
  label: string
}> = [
  { id: 'all', label: 'All' },
  { id: 'attacking', label: 'Attacking' },
  { id: 'defensive', label: 'Defensive' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'team_events', label: 'Team Events' },
  { id: 'match_control', label: 'Match Control' },
]

export default function SoccerTimeline({
  state,
  inspection,
  busy,
  onApply,
  recorderUserId,
  selectedParticipantId = null,
  defaultTeamSide = 'tracked',
  onTrackedParticipantUsed = () => {},
  allowAddEvent = true,
  readOnly = false,
  presentation = 'live',
}: SoccerTimelineProps) {
  const [editing, setEditing] = useState<SoccerMatchEvent | null>(null)
  const [deleting, setDeleting] = useState<GameEvent | null>(null)
  const [reviewFilter, setReviewFilter] =
    useState<SoccerSummaryTimelineFilter>('all')
  const [liveFilter, setLiveFilter] = useState<SoccerTimelineFilter>('all')
  const [removedOpen, setRemovedOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [captureDraft, setCaptureDraft] = useState<SoccerCaptureDraft | null>(null)
  const [incidentDraft, setIncidentDraft] = useState<SoccerIncidentDraft | null>(null)
  const [scoreTimelineOpen, setScoreTimelineOpen] = useState(false)
  const [scoreAdjustmentEdit, setScoreAdjustmentEdit] =
    useState<SoccerScoreAdjustmentEvent | null>(null)
  const [locatedEditing, setLocatedEditing] = useState<GameEvent | null>(null)
  const timings = useMemo(() => soccerPeriodTimings(state), [state])
  const review = useMemo(
    () => presentation === 'review'
      ? soccerSummaryTimelineReview(state, inspection, reviewFilter)
      : null,
    [inspection, presentation, reviewFilter, state]
  )
  const allEventsReview = useMemo(
    () => presentation === 'review'
      ? soccerSummaryTimelineReview(state, inspection, 'all')
      : null,
    [inspection, presentation, state]
  )
  const active = [...inspection.activeEvents]
    .reverse()
    .filter(event => soccerEventMatchesTimelineFilter(event, liveFilter))
  const deleted = [...inspection.deletedEvents]
    .reverse()
    .filter(event => soccerEventMatchesTimelineFilter(event, liveFilter))
  const removedCount = presentation === 'review'
    ? allEventsReview?.removedCount ?? 0
    : inspection.deletedEvents.length

  const restoreEvent = (event: GameEvent) => {
    const result = restoreSoccerHistoryEvent(state, event.id)
    if (!result.ok) {
      setTimelineError(result.message)
      return
    }
    if (onApply(result)) setTimelineError(null)
  }

  const editEvent = (event: GameEvent) => {
    if (isSoccerLocatedEditableEvent(event)) return setLocatedEditing(event)
    if (event.eventType === 'soccer.score_adjustment') {
      setScoreAdjustmentEdit(event as SoccerScoreAdjustmentEvent)
      setScoreTimelineOpen(true)
      return
    }
    setEditing(event as SoccerMatchEvent)
  }

  const addEvent = (kind: 'shot' | SoccerIncidentKind) => {
    setAddOpen(false)
    if (kind === 'shot') {
      setCaptureDraft({
        mode: 'historical',
        teamSide: defaultTeamSide,
        location: null,
      })
      return
    }
    setIncidentDraft({
      kind,
      teamSide: defaultTeamSide,
      location: null,
      mode: 'historical',
    })
  }

  return (
    <div className={busy ? 'space-y-5 pointer-events-none opacity-60' : 'space-y-5'} aria-busy={busy}>
      {!inspection.complete && (
        <section className="border border-red-200 bg-red-50 rounded-md px-3 py-3 space-y-2">
          <h2 className="text-sm font-bold text-red-800">Match timeline needs correction</h2>
          {inspection.diagnostics.map((item, index) => (
            <p key={`${item.eventId ?? 'stream'}-${index}`} className="text-xs text-red-700">
              {item.message}
            </p>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase text-slate-500">Timeline</h2>
            <p className="text-xs text-slate-400">
              {presentation === 'review' ? 'Oldest first by period' : 'Newest first'}
            </p>
          </div>
          {allowAddEvent && !readOnly && <button type="button" onClick={() => setAddOpen(true)} disabled={!inspection.complete} className="min-h-9 rounded-md bg-emerald-700 px-3 text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-40"><Plus size={15} /> Add Event</button>}
        </div>
        {timelineError && (
          <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {timelineError}
          </p>
        )}
        {presentation === 'review' ? (
          <>
            <TimelineFilterChips
              filter={reviewFilter}
              onChange={setReviewFilter}
            />
            <ReviewSections
              sections={review?.activeSections ?? []}
              readOnly={readOnly}
              onEdit={editEvent}
              onDelete={setDeleting}
            />
          </>
        ) : (
          <>
            <label className="block text-xs font-bold uppercase text-slate-500">
              Event family
              <select
                value={liveFilter}
                onChange={event =>
                  setLiveFilter(event.target.value as SoccerTimelineFilter)
                }
                className="input-field mt-1"
              >
                {LIVE_TIMELINE_FILTERS.map(item => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {active.map(event => (
                <HistoryRow
                  key={event.id}
                  event={event}
                  timeLabel={soccerEventTimeLabel(event, timings)}
                  onEdit={readOnly ? undefined : () => editEvent(event)}
                  onDelete={readOnly ? undefined : () => setDeleting(event)}
                />
              ))}
              {active.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No events in this view.</p>}
            </div>
          </>
        )}
      </section>

      {removedCount > 0 && (
        <section>
          <button type="button" onClick={() => setRemovedOpen(value => !value)} className="flex min-h-10 w-full items-center justify-between border-y border-slate-200 text-sm font-bold text-slate-600">
            <span>Removed Events ({removedCount})</span>
            {removedOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {removedOpen && (
            presentation === 'review' ? (
              <ReviewSections
                sections={review?.removedSections ?? []}
                readOnly={readOnly}
                removed
                onRestore={restoreEvent}
              />
            ) : (
              <div className="divide-y divide-slate-200 border-b border-slate-200 opacity-70">
                {deleted.map(event => (
                  <HistoryRow
                    key={event.id}
                    event={event}
                    timeLabel={soccerEventTimeLabel(event, timings)}
                    deleted
                    onRestore={
                      readOnly
                        ? undefined
                        : () => restoreEvent(event)
                    }
                  />
                ))}
                {deleted.length === 0 && <p className="py-5 text-center text-xs text-slate-500">No removed events in this filter.</p>}
              </div>
            )
          )}
        </section>
      )}

      {editing && (
        <SoccerEventCorrectionDialog
          key={`${editing.id}-${editing.revision}`}
          event={editing}
          state={state}
          onClose={() => setEditing(null)}
          onSave={result => {
            if (result.ok && onApply(result)) setEditing(null)
          }}
        />
      )}

      {addOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setAddOpen(false)}>
          <div className="w-full rounded-t-lg bg-white p-4 sm:max-w-md sm:rounded-lg" onClick={event => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-slate-800">Add Event</h2><button type="button" onClick={() => setAddOpen(false)} className="grid h-9 w-9 place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['shot', 'Shot'],
                ['defense', 'Defense'],
                ['foul', 'Foul'],
                ['card', 'Card'],
                ['team_event', 'Team Event'],
              ] as const).map(([kind, label]) => <button key={kind} type="button" onClick={() => addEvent(kind)} className="min-h-12 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">{label}</button>)}
            </div>
          </div>
        </div>
      )}

      <SoccerShotCaptureDialog
        draft={captureDraft}
        state={state}
        recorderUserId={recorderUserId}
        selectedParticipantId={selectedParticipantId}
        busy={busy}
        onApply={onApply}
        onTrackedParticipantUsed={onTrackedParticipantUsed}
        onClose={() => setCaptureDraft(null)}
      />

      <SoccerLocatedEventEditor
        event={locatedEditing}
        state={state}
        recorderUserId={recorderUserId}
        selectedParticipantId={selectedParticipantId}
        busy={busy}
        onApply={onApply}
        onTrackedParticipantUsed={onTrackedParticipantUsed}
        onClose={() => setLocatedEditing(null)}
      />

      <SoccerIncidentCaptureDialog
        draft={incidentDraft}
        state={state}
        recorderUserId={recorderUserId}
        selectedParticipantId={selectedParticipantId}
        busy={busy}
        onApply={onApply}
        onTrackedParticipantUsed={onTrackedParticipantUsed}
        onClose={() => setIncidentDraft(null)}
      />

      <SoccerScoreTimelineDialog
        open={scoreTimelineOpen}
        state={state}
        inspection={inspection}
        recorderUserId={recorderUserId}
        initialEdit={scoreAdjustmentEdit}
        busy={busy}
        readOnly={readOnly}
        onApply={onApply}
        onEditAttacking={event => {
          setScoreTimelineOpen(false)
          setScoreAdjustmentEdit(null)
          setCaptureDraft({
            mode: 'edit',
            teamSide: event.teamSide,
            location: event.location,
            event,
          })
        }}
        onClose={() => {
          setScoreTimelineOpen(false)
          setScoreAdjustmentEdit(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove match event?"
        message="The event remains in the Timeline and can be restored. Later events may need correction."
        confirmLabel="Remove Event"
        cancelLabel="Cancel"
        error={removeError}
        onConfirm={() => {
          if (!deleting) return
          const result = deleteSoccerHistoryEvent(state, deleting.id)
          if (!result.ok) {
            setRemoveError(result.message)
            return
          }
          if (onApply(result)) {
            setDeleting(null)
            setRemoveError(null)
          }
        }}
        onCancel={() => {
          setDeleting(null)
          setRemoveError(null)
        }}
      />
    </div>
  )
}

function TimelineFilterChips({
  filter,
  onChange,
}: {
  filter: SoccerSummaryTimelineFilter
  onChange: (filter: SoccerSummaryTimelineFilter) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Timeline event family">
      {SOCCER_SUMMARY_TIMELINE_FILTERS.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`min-h-9 shrink-0 border px-3 text-xs font-bold ${
            filter === item.id
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : 'border-slate-300 bg-white text-slate-600'
          }`}
          aria-pressed={filter === item.id}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function ReviewSections({
  sections,
  readOnly,
  removed = false,
  onEdit,
  onDelete,
  onRestore,
}: {
  sections: SoccerSummaryTimelineSection[]
  readOnly: boolean
  removed?: boolean
  onEdit?: (event: GameEvent) => void
  onDelete?: (event: GameEvent) => void
  onRestore?: (event: GameEvent) => void
}) {
  if (sections.length === 0) {
    return (
      <p className="border-y border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
        No {removed ? 'removed ' : ''}events in this view.
      </p>
    )
  }
  return (
    <div className={removed ? 'opacity-70' : ''}>
      {sections.map(section => (
        <section key={section.periodId}>
          <h3 className="border-y border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold uppercase text-slate-600">
            {section.label}
          </h3>
          <div className="divide-y divide-slate-200 bg-white">
            {section.rows.map(row => (
              <HistoryRow
                key={row.event.id}
                event={row.event}
                timeLabel={row.timeLabel}
                deleted={removed}
                review
                onEdit={!readOnly && onEdit ? () => onEdit(row.event) : undefined}
                onDelete={!readOnly && onDelete ? () => onDelete(row.event) : undefined}
                onRestore={!readOnly && onRestore ? () => onRestore(row.event) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function HistoryRow({
  event,
  timeLabel,
  deleted = false,
  review = false,
  onEdit,
  onDelete,
  onRestore,
}: {
  event: GameEvent
  timeLabel: string
  deleted?: boolean
  review?: boolean
  onEdit?: () => void
  onDelete?: () => void
  onRestore?: () => void
}) {
  const [metadataOpen, setMetadataOpen] = useState(false)
  const contextDetail = eventContextDetail(event)
  return (
    <div className="min-h-16 px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{eventTitle(event.eventType)}</p>
          <p className="truncate text-xs text-slate-500">{eventDetail(event)}</p>
          {contextDetail && <p className="truncate text-[11px] text-slate-500">{contextDetail}</p>}
          {!review && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              {timeLabel} · rev {event.revision}
            </p>
          )}
          {review && (
            <p className="mt-0.5 text-[11px] text-slate-400">{timeLabel}</p>
          )}
          {review && event.revision > 1 && (
            <button
              type="button"
              onClick={() => setMetadataOpen(value => !value)}
              className="mt-1 text-[11px] font-bold text-emerald-700"
              aria-expanded={metadataOpen}
            >
              {metadataOpen ? 'Hide correction details' : 'Corrected'}
            </button>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {deleted ? (
            onRestore && <button type="button" onClick={onRestore} className="grid h-9 w-9 place-items-center text-blue-600" aria-label={`Restore ${eventTitle(event.eventType)}`} title="Restore"><RotateCcw size={17} /></button>
          ) : (
            <>
              {onEdit && <button type="button" onClick={onEdit} className="grid h-9 w-9 place-items-center text-slate-600" aria-label={`Correct ${eventTitle(event.eventType)}`} title="Correct"><Pencil size={17} /></button>}
              {onDelete && <button type="button" onClick={onDelete} className="grid h-9 w-9 place-items-center text-red-600" aria-label={`Remove ${eventTitle(event.eventType)}`} title="Remove"><Trash2 size={17} /></button>}
            </>
          )}
        </div>
      </div>
      {review && event.revision > 1 && metadataOpen && (
        <div className="mt-2 border-l-2 border-emerald-200 pl-3 text-[11px] text-slate-500">
          <p>Current revision {event.revision}</p>
          <p>Updated {formatEventTimestamp(event.updatedAt)}</p>
          {deleted && event.deletedAt && (
            <p>Removed {formatEventTimestamp(event.deletedAt)}</p>
          )}
        </div>
      )}
    </div>
  )
}

function formatEventTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function eventContextDetail(event: GameEvent): string | null {
  const payload = event.payload as Record<string, unknown>
  if (event.eventType === 'soccer.shot' && typeof payload.sourceEventId === 'string') {
    return `Linked restart: ${payload.sourceEventId.slice(0, 8)}`
  }
  if (event.eventType === 'soccer.foul' || event.eventType === 'soccer.card') {
    const resolution = payload.lineupResolution as { exit?: unknown; replacementChanges?: unknown[] } | null
    if (!resolution || typeof resolution.exit !== 'string') return null
    const replacement = Array.isArray(resolution.replacementChanges) && resolution.replacementChanges.length > 0
      ? ' with replacement'
      : ''
    return `Lineup: ${resolution.exit.replace(/_/g, ' ')}${replacement}`
  }
  return null
}

function SoccerEventCorrectionDialog({ event, state, onSave, onClose }: {
  event: SoccerMatchEvent
  state: GameState
  onSave: (result: SoccerLiveResult) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<SoccerMatchEvent>(() => structuredClone(event))
  const [error, setError] = useState<string | null>(null)
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') return null
  const participants = Object.values(sportState.projection.participants)
  const segments = [
    ...sportState.projection.currentRules.regulationSegments,
    ...sportState.projection.currentRules.extraTimeSegments,
  ]

  const setPayload = (payload: SoccerMatchEvent['payload']) => {
    setDraft(current => ({ ...current, payload } as SoccerMatchEvent))
  }
  const save = () => {
    const result = updateSoccerHistoryEvent(state, event.id, {
      payload: draft.payload,
      period: draft.period,
      elapsedMs: draft.elapsedMs,
      teamSide: draft.teamSide,
      location: draft.location,
      actors: draft.actors,
    })
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSave(result)
  }

  return (
    <Dialog title={`Correct ${eventTitle(event.eventType)}`} onClose={onClose}>
      <div className="space-y-4">
        {renderEventEditor(draft, setDraft, setPayload, participants, segments, state)}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
        <button type="button" onClick={save} className="w-full rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white">Save Correction</button>
      </div>
    </Dialog>
  )
}

function renderEventEditor(
  event: SoccerMatchEvent,
  setEvent: Dispatch<SetStateAction<SoccerMatchEvent>>,
  setPayload: (payload: SoccerMatchEvent['payload']) => void,
  participants: Array<{ participantId: string; displayName: string; number: string | null; role: SoccerRole }>,
  segments: Array<{ id: string; label: string; order: number }>,
  state: GameState
): ReactNode {
  switch (event.eventType) {
    case 'soccer.opening_lineup': {
      const payload = event.payload
      return (
        <div className="space-y-2">
          {participants.map(participant => {
            const starter = payload.starters.find(item => item.participantId === participant.participantId)
            return (
              <div key={participant.participantId} className="border border-slate-200 rounded-md px-3 py-2 space-y-2">
                <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={Boolean(starter)} onChange={change => {
                    const starters = change.target.checked
                      ? [...payload.starters, { participantId: participant.participantId, role: participant.role }]
                      : payload.starters.filter(item => item.participantId !== participant.participantId)
                    setPayload({ starters })
                  }} className="h-4 w-4 accent-emerald-600" />
                  {participant.number ? `#${participant.number} ` : ''}{participant.displayName}
                </label>
                {starter && <RoleEditor role={starter.role} onChange={role => setPayload({ starters: payload.starters.map(item => item.participantId === participant.participantId ? { ...item, role } : item) })} />}
              </div>
            )
          })}
        </div>
      )
    }
    case 'soccer.period_started':
    case 'soccer.period_ended': {
      const payload = event.payload
      return <SegmentEditor value={payload.periodId} segments={segments} onChange={periodId => {
        const segment = segments.find(item => item.id === periodId)
        setEvent(current => ({
          ...current,
          period: segment ? { id: segment.id, order: segment.order } : current.period,
          payload: { periodId },
        } as SoccerMatchEvent))
      }} />
    }
    case 'soccer.clock_started': {
      const payload = event.payload
      return <TimeEditor label="Anchor time" value={payload.anchorElapsedMs} onChange={anchorElapsedMs => setEvent(current => ({ ...current, elapsedMs: anchorElapsedMs, payload: { anchorElapsedMs } } as SoccerMatchEvent))} />
    }
    case 'soccer.clock_paused': {
      const payload = event.payload
      return <TimeEditor label="Paused time" value={payload.elapsedMs} onChange={elapsedMs => setEvent(current => ({ ...current, elapsedMs, payload: { elapsedMs } } as SoccerMatchEvent))} />
    }
    case 'soccer.clock_adjusted': {
      const payload = event.payload
      return <div className="grid grid-cols-2 gap-2"><TimeEditor label="From" value={payload.fromElapsedMs} onChange={fromElapsedMs => setPayload({ ...payload, fromElapsedMs })} /><TimeEditor label="To" value={payload.toElapsedMs} onChange={toElapsedMs => setEvent(current => ({ ...current, elapsedMs: toElapsedMs, payload: { ...payload, toElapsedMs } } as SoccerMatchEvent))} /></div>
    }
    case 'soccer.match_rules_changed': {
      const payload = event.payload
      return <RulesEditor rules={payload.rules} onChange={rules => setPayload({ rules })} />
    }
    case 'soccer.substitution_window': {
      const payload = event.payload
      return (
        <div className="space-y-3">
          {payload.changes.map((change, index) => (
            <div key={index} className="border border-slate-200 rounded-md p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <ParticipantEditor label="Player out" value={change.playerOutParticipantId ?? ''} participants={participants} allowEmpty onChange={playerOutParticipantId => setPayload({ ...payload, changes: payload.changes.map((item, itemIndex) => itemIndex === index ? { ...item, playerOutParticipantId: playerOutParticipantId || null } : item) })} />
                <ParticipantEditor label="Player in" value={change.playerInParticipantId ?? ''} participants={participants} allowEmpty onChange={playerInParticipantId => setPayload({ ...payload, changes: payload.changes.map((item, itemIndex) => itemIndex === index ? { ...item, playerInParticipantId: playerInParticipantId || null, playerInRole: playerInParticipantId ? item.playerInRole ?? defaultRole() : null } : item) })} />
              </div>
              {change.playerInParticipantId && <RoleEditor role={change.playerInRole ?? defaultRole()} onChange={playerInRole => setPayload({ ...payload, changes: payload.changes.map((item, itemIndex) => itemIndex === index ? { ...item, playerInRole } : item) })} />}
              {payload.changes.length > 1 && <button type="button" onClick={() => setPayload({ ...payload, changes: payload.changes.filter((_, itemIndex) => itemIndex !== index) })} className="text-xs font-semibold text-red-600">Remove change</button>}
            </div>
          ))}
          <button type="button" onClick={() => setPayload({ ...payload, changes: [...payload.changes, { playerOutParticipantId: null, playerInParticipantId: null, playerInRole: null }] })} className="btn-secondary w-full">Add change</button>
          <label className="flex items-center justify-between text-sm font-medium text-slate-700">Halftime window<input type="checkbox" checked={payload.halftime} onChange={change => setPayload({ ...payload, halftime: change.target.checked })} className="h-5 w-5 accent-emerald-600" /></label>
        </div>
      )
    }
    case 'soccer.role_changed': {
      const payload = event.payload
      return <div className="space-y-3">{payload.changes.map((change, index) => <div key={index} className="border border-slate-200 rounded-md p-3 space-y-2"><ParticipantEditor label="Participant" value={change.participantId} participants={participants} onChange={participantId => setPayload({ changes: payload.changes.map((item, itemIndex) => itemIndex === index ? { ...item, participantId } : item) })} /><RoleEditor role={change.role} onChange={role => setPayload({ changes: payload.changes.map((item, itemIndex) => itemIndex === index ? { ...item, role } : item) })} /></div>)}</div>
    }
    case 'soccer.attacking_direction_changed': {
      const payload = event.payload
      return <label className="block text-sm font-medium text-slate-700">Direction<select value={payload.direction} onChange={change => setPayload({ direction: change.target.value as 'left_to_right' | 'right_to_left' })} className="input-field mt-1"><option value="left_to_right">Left to right</option><option value="right_to_left">Right to left</option></select></label>
    }
    case 'soccer.match_roster_added': {
      const payload = event.payload
      return <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">Name<input value={payload.participant.displayName} onChange={change => setPayload({ ...payload, participant: { ...payload.participant, displayName: change.target.value } })} className="input-field mt-1" /></label><label className="block text-sm font-medium text-slate-700">Number<input value={payload.participant.number ?? ''} onChange={change => setPayload({ ...payload, participant: { ...payload.participant, number: change.target.value || null } })} className="input-field mt-1" /></label><RoleEditor role={payload.participant.initialRole} onChange={initialRole => setPayload({ ...payload, participant: { ...payload.participant, initialRole } })} /><label className="block text-sm font-medium text-slate-700">Destination<select value={payload.destination} onChange={change => setPayload({ ...payload, destination: change.target.value as 'bench' | 'on_field' })} className="input-field mt-1"><option value="bench">Bench</option><option value="on_field">On field</option></select></label></div>
    }
    case 'soccer.participant_resolved': {
      const payload = event.payload
      return <div className="space-y-3"><ParticipantEditor label="Anonymous participant" value={payload.participantId} participants={participants.filter(item => item.participantId === payload.participantId || !item.participantId)} onChange={participantId => setPayload({ ...payload, participantId })} /><label className="block text-sm font-medium text-slate-700">Roster player<select value={payload.playerId} onChange={change => { const player = state.players.find(item => item.id === change.target.value); if (player) setPayload({ ...payload, playerId: player.id, displayName: player.name, number: player.number || null }) }} className="input-field mt-1">{state.players.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label></div>
    }
    case 'soccer.match_ended': {
      const payload = event.payload
      return <label className="block text-sm font-medium text-slate-700">Reason<select value={payload.reason} onChange={change => setPayload({ reason: change.target.value as 'completed' | 'suspended' | 'abandoned' })} className="input-field mt-1"><option value="completed">Completed</option><option value="suspended">Suspended</option><option value="abandoned">Abandoned</option></select></label>
    }
    case 'soccer.match_reopened': {
      const payload = event.payload
      return <label className="block text-sm font-medium text-slate-700">Reason<input value={payload.reason ?? ''} onChange={change => setPayload({ reason: change.target.value || null })} className="input-field mt-1" /></label>
    }
    case 'soccer.shootout_started': {
      const payload = event.payload
      const accounted = [...new Set([...payload.trackedEligibleParticipantIds, ...payload.trackedExcludedParticipantIds])]
      const eligibleGoalkeepers = participants.filter(participant =>
        participant.role.group === 'goalkeeper' &&
        payload.trackedEligibleParticipantIds.includes(participant.participantId)
      )
      return <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">First side<select value={payload.firstKickingSide} onChange={change => setPayload({ ...payload, firstKickingSide: change.target.value as 'tracked' | 'opponent' })} className="input-field mt-1"><option value="tracked">Tracked</option><option value="opponent">Opponent</option></select></label><NumberEditor label="Opponent eligible" value={payload.opponentEligibleCount} onChange={opponentEligibleCount => setPayload({ ...payload, opponentEligibleCount })} /><div className="divide-y divide-slate-200 border-y border-slate-200">{accounted.map(id => { const participant = participants.find(item => item.participantId === id); const checked = payload.trackedEligibleParticipantIds.includes(id); return <label key={id} className="flex min-h-10 items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={checked} onChange={() => setPayload({ ...payload, trackedEligibleParticipantIds: checked ? payload.trackedEligibleParticipantIds.filter(item => item !== id) : [...payload.trackedEligibleParticipantIds, id], trackedExcludedParticipantIds: checked ? [...payload.trackedExcludedParticipantIds, id] : payload.trackedExcludedParticipantIds.filter(item => item !== id) })} className="h-5 w-5 accent-emerald-700" />{participant?.displayName ?? id}</label> })}</div><ParticipantEditor label="Tracked goalkeeper" value={payload.trackedGoalkeeperParticipantId} participants={eligibleGoalkeepers} onChange={trackedGoalkeeperParticipantId => setPayload({ ...payload, trackedGoalkeeperParticipantId })} /></div>
    }
    case 'soccer.shootout_eligibility_changed': {
      const payload = event.payload
      const accounted = [...new Set([...payload.trackedEligibleParticipantIds, ...payload.trackedExcludedParticipantIds])]
      return <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">Reason<select value={payload.reason} onChange={change => setPayload({ ...payload, reason: change.target.value as typeof payload.reason })} className="input-field mt-1"><option value="equalization">Equalization</option><option value="sent_off">Sent off</option><option value="unable_to_continue">Unable to continue</option><option value="goalkeeper_replacement">Goalkeeper replacement</option></select></label><NumberEditor label="Opponent eligible" value={payload.opponentEligibleCount} onChange={opponentEligibleCount => setPayload({ ...payload, opponentEligibleCount })} /><div className="divide-y divide-slate-200 border-y border-slate-200">{accounted.map(id => { const participant = participants.find(item => item.participantId === id); const checked = payload.trackedEligibleParticipantIds.includes(id); return <label key={id} className="flex min-h-10 items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={checked} onChange={() => setPayload({ ...payload, trackedEligibleParticipantIds: checked ? payload.trackedEligibleParticipantIds.filter(item => item !== id) : [...payload.trackedEligibleParticipantIds, id], trackedExcludedParticipantIds: checked ? [...payload.trackedExcludedParticipantIds, id] : payload.trackedExcludedParticipantIds.filter(item => item !== id) })} className="h-5 w-5 accent-emerald-700" />{participant?.displayName ?? id}</label> })}</div></div>
    }
    case 'soccer.shootout_goalkeeper_changed': {
      const payload = event.payload
      const incoming = event.actors.find(actor => actor.role === 'goalkeeper_in')
      return <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">Reason<select value={payload.reason} onChange={change => setPayload({ reason: change.target.value as typeof payload.reason })} className="input-field mt-1"><option value="tactical">Tactical</option><option value="unable_to_continue">Unable to continue</option><option value="sent_off">Sent off</option></select></label><label className="block text-sm font-medium text-slate-700">Incoming goalkeeper<input value={incoming?.label ?? ''} onChange={change => setEvent(current => ({ ...current, actors: current.actors.map(actor => actor.role === 'goalkeeper_in' ? { ...actor, label: change.target.value } : actor) } as SoccerMatchEvent))} className="input-field mt-1" /></label></div>
    }
    case 'soccer.shootout_kick': {
      const payload = event.payload
      return <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">Outcome<select value={payload.outcome} onChange={change => setPayload({ ...payload, outcome: change.target.value as typeof payload.outcome })} className="input-field mt-1"><option value="scored">Scored</option><option value="saved">Saved</option><option value="missed">Missed</option><option value="woodwork">Woodwork</option><option value="retake">Retake</option><option value="forfeited">Forfeited</option></select></label>{payload.anonymousKickerSlot !== null && <NumberEditor label="Anonymous slot" value={payload.anonymousKickerSlot} onChange={anonymousKickerSlot => setPayload({ ...payload, anonymousKickerSlot })} />}</div>
    }
    case 'soccer.card': {
      const payload = event.payload
      return <div className="space-y-3"><div><p className="text-sm font-medium text-slate-700">Sanction</p><p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm capitalize text-slate-700">{payload.sanction.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-slate-500">Remove and record a replacement card to change its sanction.</p></div><label className="block text-sm font-medium text-slate-700">Note<input value={payload.note ?? ''} onChange={change => setPayload({ ...payload, note: change.target.value || null })} className="input-field mt-1" /></label></div>
    }
  }
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center" onClick={onClose}><div role="dialog" aria-modal="true" aria-label={title} className="bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-lg sm:rounded-lg shadow-xl" onClick={event => event.stopPropagation()}><header className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 z-10"><h2 className="font-bold text-slate-800 flex-1">{title}</h2><button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button></header><div className="p-4">{children}</div></div></div>
}

function RoleEditor({ role, onChange }: { role: SoccerRole; onChange: (role: SoccerRole) => void }) {
  return <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-medium text-slate-600">Role<select value={role.group} onChange={change => { const group = change.target.value as SoccerRoleGroup; onChange({ group, label: group === 'custom' ? role.label ?? 'Custom' : null }) }} className="input-field mt-1 py-2 text-sm">{ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{role.group === 'custom' ? <label className="block text-xs font-medium text-slate-600">Label<input value={role.label ?? ''} onChange={change => onChange({ group: 'custom', label: change.target.value })} className="input-field mt-1 py-2 text-sm" /></label> : <span />}</div>
}

function ParticipantEditor({ label, value, participants, allowEmpty = false, onChange }: { label: string; value: string; participants: Array<{ participantId: string; displayName: string; number: string | null }>; allowEmpty?: boolean; onChange: (value: string) => void }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<select value={value} onChange={change => onChange(change.target.value)} className="input-field mt-1 py-2 text-sm">{allowEmpty && <option value="">None</option>}{participants.map(participant => <option key={participant.participantId} value={participant.participantId}>{participant.number ? `#${participant.number} ` : ''}{participant.displayName}</option>)}</select></label>
}

function SegmentEditor({ value, segments, onChange }: { value: string; segments: Array<{ id: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium text-slate-700">Period<select value={value} onChange={change => onChange(change.target.value)} className="input-field mt-1">{segments.map(segment => <option key={segment.id} value={segment.id}>{segment.label}</option>)}</select></label>
}

function TimeEditor({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(formatSoccerInputTime(value))
  return <label className="block text-xs font-medium text-slate-600">{label}<input value={draft} onChange={change => setDraft(change.target.value)} onBlur={() => { const parsed = parseSoccerInputTime(draft); if (parsed !== null) onChange(parsed); else setDraft(formatSoccerInputTime(value)) }} className="input-field mt-1 text-center tabular-nums" inputMode="numeric" /></label>
}

function RulesEditor({ rules, onChange }: { rules: SoccerMatchRules; onChange: (rules: SoccerMatchRules) => void }) {
  return <div className="space-y-3"><div className="grid grid-cols-3 gap-2"><NumberEditor label="Players" value={rules.maxOnFieldPlayers} onChange={maxOnFieldPlayers => onChange({ ...rules, maxOnFieldPlayers })} /><NullableEditor label="Subs" value={rules.substitutionLimit} onChange={substitutionLimit => onChange({ ...rules, substitutionLimit })} /><NullableEditor label="Windows" value={rules.substitutionWindowLimit} onChange={substitutionWindowLimit => onChange({ ...rules, substitutionWindowLimit })} /></div><Toggle label="Allow return substitutions" checked={rules.allowReturnSubstitutions} onChange={allowReturnSubstitutions => onChange({ ...rules, allowReturnSubstitutions })} /><Toggle label="Extra time available" checked={rules.extraTimeAvailable} onChange={extraTimeAvailable => onChange(withSoccerTieResolution(rules, extraTimeAvailable ? 'extra_time_then_shootout' : rules.shootoutAvailable ? 'direct_to_shootout' : 'draw_allowed'))} /><Toggle label="Shootout available" checked={rules.shootoutAvailable} onChange={shootoutAvailable => onChange(withSoccerTieResolution(rules, shootoutAvailable ? rules.extraTimeAvailable ? 'extra_time_then_shootout' : 'direct_to_shootout' : 'draw_allowed'))} /></div>
}

function NumberEditor({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<input type="number" min={1} value={value} onChange={change => onChange(Math.max(1, Number(change.target.value) || 1))} className="input-field mt-1 px-2" /></label>
}

function NullableEditor({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<input type="number" min={0} value={value ?? ''} placeholder="Any" onChange={change => onChange(change.target.value === '' ? null : Math.max(0, Number(change.target.value) || 0))} className="input-field mt-1 px-2" /></label>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between text-sm font-medium text-slate-700 min-h-10">{label}<input type="checkbox" checked={checked} onChange={change => onChange(change.target.checked)} className="h-5 w-5 accent-emerald-600" /></label>
}

function eventTitle(type: string): string {
  return ({
    'soccer.opening_lineup': 'Opening lineup',
    'soccer.period_started': 'Period started',
    'soccer.period_ended': 'Period ended',
    'soccer.clock_started': 'Clock started',
    'soccer.clock_paused': 'Clock paused',
    'soccer.clock_adjusted': 'Clock corrected',
    'soccer.match_rules_changed': 'Rules changed',
    'soccer.substitution_window': 'Substitution window',
    'soccer.role_changed': 'Roles changed',
    'soccer.attacking_direction_changed': 'Direction changed',
    'soccer.match_roster_added': 'Participant added',
    'soccer.participant_resolved': 'Participant resolved',
    'soccer.match_ended': 'Match ended',
    'soccer.match_reopened': 'Match reopened',
    'soccer.shot': 'Shot',
    'soccer.own_goal': 'Own goal',
    'soccer.score_adjustment': 'Score adjustment',
    'soccer.defensive_action': 'Defensive action',
    'soccer.foul': 'Foul',
    'soccer.card': 'Card',
    'soccer.team_event': 'Team event',
    'soccer.shootout_started': 'Shootout started',
    'soccer.shootout_eligibility_changed': 'Shootout eligibility',
    'soccer.shootout_goalkeeper_changed': 'Shootout goalkeeper',
    'soccer.shootout_kick': 'Shootout kick',
  } as Record<string, string>)[type] ?? type
}

function eventDetail(event: GameEvent): string {
  const payload = event.payload as Record<string, unknown>
  switch (event.eventType) {
    case 'soccer.opening_lineup': return `${Array.isArray(payload.starters) ? payload.starters.length : 0} starters`
    case 'soccer.period_started':
    case 'soccer.period_ended': return String(payload.periodId ?? event.period.id)
    case 'soccer.substitution_window': return `${Array.isArray(payload.changes) ? payload.changes.length : 0} change(s)`
    case 'soccer.role_changed': return `${Array.isArray(payload.changes) ? payload.changes.length : 0} role(s)`
    case 'soccer.attacking_direction_changed': return payload.direction === 'left_to_right' ? 'Left to right' : 'Right to left'
    case 'soccer.match_roster_added': return String((payload.participant as { displayName?: unknown } | undefined)?.displayName ?? 'Participant')
    case 'soccer.participant_resolved': return String(payload.displayName ?? 'Roster player')
    case 'soccer.match_ended': return String(payload.reason ?? 'Ended')
    case 'soccer.match_reopened': return String(payload.reason ?? 'Reopened')
    case 'soccer.shot': {
      const shooter = event.actors.find(actor => actor.role === 'shooter')
      return `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} · ${String(payload.outcome ?? 'shot').replace('_', ' ')} · ${shooter?.label ?? 'Team'}`
    }
    case 'soccer.own_goal': return `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} benefits · ${event.actors.find(actor => actor.role === 'own_goal_by')?.label ?? 'Unknown'}`
    case 'soccer.score_adjustment': return `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} ${Number(payload.delta) > 0 ? '+' : ''}${String(payload.delta ?? '')} · ${String(payload.reason ?? 'No reason')}`
    case 'soccer.defensive_action': {
      const actor = event.actors.find(item => item.role === 'defender')
      const outcome = payload.action === 'tackle' ? ` ${String(payload.tackleOutcome ?? '')}` : ''
      return `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} / ${String(payload.action ?? 'defense').replace(/_/g, ' ')}${outcome} / ${actor?.label ?? 'Team'}`
    }
    case 'soccer.foul': {
      const actor = event.actors.find(item => item.role === 'committed_by')
      const sanction = payload.sanction === 'none' ? '' : ` / ${String(payload.sanction).replace(/_/g, ' ')}`
      return `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} / ${actor?.label ?? 'Team'} / ${String(payload.restart ?? 'none').replace(/_/g, ' ')}${sanction}`
    }
    case 'soccer.card': {
      const actor = event.actors.find(item => item.role === 'recipient')
      return `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} / ${String(payload.sanction ?? 'card').replace(/_/g, ' ')} / ${actor?.label ?? 'Team'} / ${String(payload.reason ?? '').replace(/_/g, ' ')}`
    }
    case 'soccer.team_event': {
      const actor = event.actors.find(item => item.role === 'offside_player')
      return `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} / ${String(payload.kind ?? 'team event')}${actor?.label ? ` / ${actor.label}` : ''}`
    }
    case 'soccer.shootout_started': return `${String(payload.firstKickingSide)} first / ${String(payload.initialKicksPerSide)} kicks / ${String(payload.opponentEligibleCount)} eligible`
    case 'soccer.shootout_eligibility_changed': return `${String(payload.reason).replace(/_/g, ' ')} / ${Array.isArray(payload.trackedEligibleParticipantIds) ? payload.trackedEligibleParticipantIds.length : 0} each`
    case 'soccer.shootout_goalkeeper_changed': return `${event.teamSide} / ${event.actors.find(actor => actor.role === 'goalkeeper_in')?.label ?? 'Unknown'} / ${String(payload.reason).replace(/_/g, ' ')}`
    case 'soccer.shootout_kick': return `${event.teamSide} / ${event.actors.find(actor => actor.role === 'kicker')?.label ?? 'Unknown'} / ${String(payload.outcome)}`
    default: return event.period.id
  }
}

function defaultRole(): SoccerRole {
  return { group: 'midfielder', label: null }
}

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { GameState } from '../../types'
import ConfirmDialog from '../ConfirmDialog'
import {
  deleteSoccerHistoryEvent,
  formatSoccerInputTime,
  parseSoccerInputTime,
  restoreSoccerHistoryEvent,
  soccerEventMatchesTimelineFilter,
  soccerEventTimeLabel,
  soccerPeriodTimings,
  updateSoccerHistoryEvent,
  type SoccerLiveResult,
  type SoccerMatchEvent,
  type SoccerOwnGoalEvent,
  type SoccerMatchRules,
  type SoccerRole,
  type SoccerRoleGroup,
  type SoccerScoreAdjustmentEvent,
  type SoccerShotEvent,
  type SoccerTimelineFilter,
  withSoccerTieResolution,
} from '../../lib/soccer'
import type { GameEvent, GameEventInspection } from '../../lib/gameEvents/types'

interface SoccerMatchHistoryProps {
  state: GameState
  inspection: GameEventInspection
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onAddMissed: () => void
  onEditAttacking: (event: SoccerShotEvent | SoccerOwnGoalEvent) => void
  onEditScoreAdjustment: (event: SoccerScoreAdjustmentEvent) => void
}

const ROLE_OPTIONS: Array<{ value: SoccerRoleGroup; label: string }> = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
  { value: 'custom', label: 'Custom' },
]

export default function SoccerMatchHistory({
  state,
  inspection,
  busy,
  onApply,
  onAddMissed,
  onEditAttacking,
  onEditScoreAdjustment,
}: SoccerMatchHistoryProps) {
  const [editing, setEditing] = useState<SoccerMatchEvent | null>(null)
  const [deleting, setDeleting] = useState<GameEvent | null>(null)
  const [filter, setFilter] = useState<SoccerTimelineFilter>('all')
  const [removedOpen, setRemovedOpen] = useState(false)
  const timings = useMemo(() => soccerPeriodTimings(state), [state])
  const active = [...inspection.activeEvents].reverse().filter(event => soccerEventMatchesTimelineFilter(event, filter))
  const deleted = [...inspection.deletedEvents].reverse().filter(event => soccerEventMatchesTimelineFilter(event, filter))

  const editEvent = (event: GameEvent) => {
    if (event.eventType === 'soccer.shot' || event.eventType === 'soccer.own_goal') {
      onEditAttacking(event as SoccerShotEvent | SoccerOwnGoalEvent)
      return
    }
    if (event.eventType === 'soccer.score_adjustment') {
      onEditScoreAdjustment(event as SoccerScoreAdjustmentEvent)
      return
    }
    setEditing(event as SoccerMatchEvent)
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
            <p className="text-xs text-slate-400">Newest first</p>
          </div>
          <button type="button" onClick={onAddMissed} disabled={!inspection.complete} className="min-h-9 rounded-md bg-emerald-700 px-3 text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-40"><Plus size={15} /> Add missed event</button>
        </div>
        <div className="grid grid-cols-3 rounded-md bg-slate-200 p-1">
          <FilterButton active={filter === 'all'} label="All" onClick={() => setFilter('all')} />
          <FilterButton active={filter === 'attacking'} label="Attacking" onClick={() => setFilter('attacking')} />
          <FilterButton active={filter === 'match_control'} label="Match Control" onClick={() => setFilter('match_control')} />
        </div>
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {active.map(event => (
            <HistoryRow
              key={event.id}
              event={event}
              timeLabel={soccerEventTimeLabel(event, timings)}
              onEdit={() => editEvent(event)}
              onDelete={() => setDeleting(event)}
            />
          ))}
          {active.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No events in this view.</p>}
        </div>
      </section>

      {inspection.deletedEvents.length > 0 && (
        <section>
          <button type="button" onClick={() => setRemovedOpen(value => !value)} className="flex min-h-10 w-full items-center justify-between border-y border-slate-200 text-sm font-bold text-slate-600">
            <span>Removed Events ({inspection.deletedEvents.length})</span>
            {removedOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {removedOpen && (
            <div className="divide-y divide-slate-200 border-b border-slate-200 opacity-70">
              {deleted.map(event => (
                <HistoryRow
                  key={event.id}
                  event={event}
                  timeLabel={soccerEventTimeLabel(event, timings)}
                  deleted
                  onRestore={() => onApply(restoreSoccerHistoryEvent(state, event.id))}
                />
              ))}
              {deleted.length === 0 && <p className="py-5 text-center text-xs text-slate-500">No removed events in this filter.</p>}
            </div>
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

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove match event?"
        message="The event remains in the Timeline and can be restored. Later events may need correction."
        confirmLabel="Remove Event"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (deleting) onApply(deleteSoccerHistoryEvent(state, deleting.id))
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

function HistoryRow({ event, timeLabel, deleted = false, onEdit, onDelete, onRestore }: {
  event: GameEvent
  timeLabel: string
  deleted?: boolean
  onEdit?: () => void
  onDelete?: () => void
  onRestore?: () => void
}) {
  return (
    <div className="min-h-16 py-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 truncate">{eventTitle(event.eventType)}</p>
        <p className="text-xs text-slate-500 truncate">{eventDetail(event)}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {timeLabel} · rev {event.revision}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {deleted ? (
          <button type="button" onClick={onRestore} className="h-9 w-9 grid place-items-center text-blue-600" aria-label={`Restore ${eventTitle(event.eventType)}`} title="Restore"><RotateCcw size={17} /></button>
        ) : (
          <>
            {onEdit && <button type="button" onClick={onEdit} className="h-9 w-9 grid place-items-center text-slate-600" aria-label={`Correct ${eventTitle(event.eventType)}`} title="Correct"><Pencil size={17} /></button>}
            <button type="button" onClick={onDelete} className="h-9 w-9 grid place-items-center text-red-600" aria-label={`Remove ${eventTitle(event.eventType)}`} title="Remove"><Trash2 size={17} /></button>
          </>
        )}
      </div>
    </div>
  )
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
    default: return event.period.id
  }
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`min-h-9 rounded px-1 text-xs font-semibold ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{label}</button>
}

function defaultRole(): SoccerRole {
  return { group: 'midfielder', label: null }
}

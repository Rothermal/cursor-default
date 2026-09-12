import { Pencil, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GameEvent, GameEventInspection } from '../../lib/gameEvents/types'
import {
  isSoccerScoringEvent,
  recordSoccerScoreAdjustment,
  reviseSoccerScoreAdjustment,
  soccerEventTimeLabel,
  soccerPeriodTimings,
  type SoccerLiveResult,
  type SoccerOwnGoalEvent,
  type SoccerScoreAdjustmentEvent,
  type SoccerShotEvent,
  type SoccerTeamSide,
} from '../../lib/soccer'
import type { GameState } from '../../types'
import { gameSideDisplayName } from '../../lib/display'

interface SoccerScoreTimelineDialogProps {
  open: boolean
  state: GameState
  inspection: GameEventInspection
  recorderUserId: string | null
  initialEdit: SoccerScoreAdjustmentEvent | null
  busy: boolean
  readOnly?: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onEditAttacking: (event: SoccerShotEvent | SoccerOwnGoalEvent) => void
  onClose: () => void
}

export default function SoccerScoreTimelineDialog({
  open,
  state,
  inspection,
  recorderUserId,
  initialEdit,
  busy,
  readOnly = false,
  onApply,
  onEditAttacking,
  onClose,
}: SoccerScoreTimelineDialogProps) {
  const [editing, setEditing] = useState<SoccerScoreAdjustmentEvent | 'new' | null>(null)
  const scoringEvents = useMemo(
    () => [...inspection.activeEvents].reverse().filter(isSoccerScoringEvent),
    [inspection.activeEvents]
  )
  const timings = useMemo(() => soccerPeriodTimings(state), [state])
  const correctionsLocked = state.sportGameState?.sportId === 'soccer' &&
    Boolean(state.sportGameState.projection.shootout)
  const trackedLabel = gameSideDisplayName(state.gameInfo, 'tracked')
  const opponentLabel = gameSideDisplayName(state.gameInfo, 'opponent')

  useEffect(() => {
    if (open) setEditing(correctionsLocked || readOnly ? null : initialEdit)
  }, [correctionsLocked, initialEdit, open, readOnly])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.5] sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="soccer-score-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-lg sm:rounded-lg" onClick={event => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <div className="min-w-0 flex-1">
            <h2 id="soccer-score-title" className="font-bold text-content">Scoring Timeline</h2>
            <p className="text-xs text-content-muted">{trackedLabel} {state.homeTeamScore ?? 0} - {state.opponentScore} {opponentLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Close" title="Close"><X size={20} /></button>
        </header>

        <div className="space-y-4 p-4">
          {editing ? (
            <ScoreAdjustmentForm
              state={state}
              event={editing === 'new' ? null : editing}
              recorderUserId={recorderUserId}
              busy={busy}
              onApply={result => {
                if (onApply(result)) setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              {correctionsLocked ? (
                <p className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">Remove the shootout events before correcting the normal match score.</p>
              ) : readOnly ? null : (
                <button type="button" onClick={() => setEditing('new')} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-success px-3 text-sm font-bold text-content"><Plus size={17} /> Add Score Adjustment</button>
              )}
              <div className="divide-y divide-line border-y border-line">
                {scoringEvents.map(event => (
                  <ScoringRow
                    key={event.id}
                    event={event}
                    timeLabel={soccerEventTimeLabel(event, timings)}
                    editable={!correctionsLocked && !readOnly}
                    sideLabel={event.teamSide === 'tracked' ? trackedLabel : opponentLabel}
                    onEdit={() => {
                      if (event.eventType === 'soccer.score_adjustment') {
                        setEditing(event as SoccerScoreAdjustmentEvent)
                      } else {
                        onEditAttacking(event as SoccerShotEvent | SoccerOwnGoalEvent)
                      }
                    }}
                  />
                ))}
                {scoringEvents.length === 0 && <p className="py-8 text-center text-sm text-content-muted">No scoring events yet.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ScoreAdjustmentForm({ state, event, recorderUserId, busy, onApply, onCancel }: {
  state: GameState
  event: SoccerScoreAdjustmentEvent | null
  recorderUserId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => void
  onCancel: () => void
}) {
  const timings = useMemo(() => soccerPeriodTimings(state), [state])
  const initialTiming = timings.find(item => item.period.id === event?.period.id)
    ?? timings[timings.length - 1]
    ?? null
  const [teamSide, setTeamSide] = useState<SoccerTeamSide>(event?.teamSide ?? 'tracked')
  const [delta, setDelta] = useState<1 | -1>(event?.payload.delta ?? 1)
  const [reason, setReason] = useState(event?.payload.reason ?? '')
  const [periodId, setPeriodId] = useState(initialTiming?.period.id ?? '')
  const [periodElapsedMs, setPeriodElapsedMs] = useState(initialTiming
    ? Math.max(0, (event?.elapsedMs ?? initialTiming.endElapsedMs) - initialTiming.startElapsedMs)
    : 0)
  const [error, setError] = useState<string | null>(null)
  const timing = timings.find(item => item.period.id === periodId) ?? initialTiming
  const absoluteElapsedMs = timing ? timing.startElapsedMs + periodElapsedMs : 0
  const timingInvalid = !timing || absoluteElapsedMs < timing.startElapsedMs || absoluteElapsedMs > timing.endElapsedMs
  const score = teamSide === 'tracked' ? state.homeTeamScore ?? 0 : state.opponentScore
  const trackedLabel = gameSideDisplayName(state.gameInfo, 'tracked')
  const opponentLabel = gameSideDisplayName(state.gameInfo, 'opponent')
  const disabled = busy || !reason.trim() || timingInvalid || (delta === -1 && !event && score <= 0)

  const save = () => {
    if (!timing) return
    const input = { teamSide, delta, reason }
    const moment = { period: timing.period, elapsedMs: absoluteElapsedMs }
    const result = event
      ? reviseSoccerScoreAdjustment(state, event.id, input, moment)
      : recordSoccerScoreAdjustment(state, input, moment, { recorderUserId })
    if (!result.ok) {
      setError(result.message)
      return
    }
    onApply(result)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-bold uppercase text-content-muted">Side</p>
        <div className="grid grid-cols-2 rounded-md bg-control p-1">
          <ModeButton active={teamSide === 'tracked'} label={trackedLabel} onClick={() => setTeamSide('tracked')} />
          <ModeButton active={teamSide === 'opponent'} label={opponentLabel} onClick={() => setTeamSide('opponent')} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase text-content-muted">Adjustment</p>
        <div className="grid grid-cols-2 rounded-md bg-control p-1">
          <ModeButton active={delta === 1} label="+1 Goal" onClick={() => setDelta(1)} />
          <ModeButton active={delta === -1} label="-1 Goal" onClick={() => setDelta(-1)} />
        </div>
      </div>
      <label className="block text-xs font-bold uppercase text-content-muted">Reason<input value={reason} onChange={change => setReason(change.target.value)} placeholder="Required correction reason" className="input-field mt-2 normal-case" /></label>
      <div>
        <p className="mb-2 text-xs font-bold uppercase text-content-muted">Match time</p>
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2">
          <select value={timing?.period.id ?? ''} onChange={change => { const next = timings.find(item => item.period.id === change.target.value); setPeriodId(change.target.value); setPeriodElapsedMs(next ? next.endElapsedMs - next.startElapsedMs : 0) }} className="input-field">
            {timings.map(item => <option key={item.period.id} value={item.period.id}>{item.label}</option>)}
          </select>
          <label className="text-[11px] font-bold uppercase text-content-muted">Min<input type="number" min="0" value={Math.floor(periodElapsedMs / 60_000)} onChange={change => setPeriodElapsedMs(Math.max(0, Number(change.target.value) || 0) * 60_000 + Math.floor(periodElapsedMs / 1_000) % 60 * 1_000)} className="input-field mt-1" /></label>
          <label className="text-[11px] font-bold uppercase text-content-muted">Sec<input type="number" min="0" max="59" value={Math.floor(periodElapsedMs / 1_000) % 60} onChange={change => setPeriodElapsedMs(Math.floor(periodElapsedMs / 60_000) * 60_000 + Math.min(59, Math.max(0, Number(change.target.value) || 0)) * 1_000)} className="input-field mt-1" /></label>
        </div>
      </div>
      {error && <p className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-md border border-line-strong bg-surface text-sm font-bold text-content">Cancel</button>
        <button type="button" onClick={save} disabled={disabled} className="min-h-11 rounded-md bg-success text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled">{event ? 'Save Correction' : 'Add Adjustment'}</button>
      </div>
    </div>
  )
}

function ScoringRow({ event, timeLabel, editable, sideLabel, onEdit }: { event: GameEvent; timeLabel: string; editable: boolean; sideLabel: string; onEdit: () => void }) {
  const detail = event.eventType === 'soccer.shot'
    ? actorLabel(event, 'shooter')
    : event.eventType === 'soccer.own_goal'
      ? `Own goal by ${actorLabel(event, 'own_goal_by')}`
      : String((event.payload as { reason?: unknown }).reason ?? 'Score correction')
  const delta = event.eventType === 'soccer.score_adjustment'
    ? Number((event.payload as { delta?: unknown }).delta ?? 0)
    : 1
  return (
    <div className="flex min-h-16 items-center gap-3 py-3">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md text-sm font-black ${event.teamSide === 'tracked' ? 'bg-success text-success-content' : 'bg-control text-content'}`}>{delta > 0 ? `+${delta}` : delta}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-content">{sideLabel} score</p>
        <p className="truncate text-xs text-content-muted">{detail}</p>
        <p className="mt-0.5 text-[11px] text-content-subtle">{timeLabel} · rev {event.revision}</p>
      </div>
      {editable && <button type="button" onClick={onEdit} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Correct scoring event" title="Correct"><Pencil size={17} /></button>}
    </div>
  )
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} title={label} className={`min-h-9 min-w-0 truncate rounded px-2 text-xs font-semibold ${active ? 'bg-surface text-content shadow-sm' : 'text-content-muted'}`}>{label}</button>
}

function actorLabel(event: GameEvent, role: string): string {
  const actor = event.actors.find(item => item.role === role)
  return actor?.label ?? (actor?.kind === 'team' ? 'Team' : 'Unknown')
}

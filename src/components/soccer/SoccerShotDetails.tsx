import { useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { SOCCER_DIAGRAM, SOCCER_DIAGRAM_GOAL_TOP } from '../../lib/soccer/diagramGeometry'
import type { GameEvent, GameEventLocation } from '../../lib/gameEvents/types'
import { isSoccerShotDetailFamily, soccerBodyPartLabel, soccerPlacementAllowed, soccerShotApproach,
  validateSoccerShotDetails, shotDetailDraft, type ShotDetailDraft, type SoccerBodyPart, type SoccerGoalPlacement } from '../../lib/soccer/shotDetails'

export function SoccerShotDetailsEditor({ value, onChange, goal, shootout = false, disabled = false, location = null, outcomeControl, children }: {
  value: ShotDetailDraft; onChange: (value: ShotDetailDraft) => void; goal: boolean;
  shootout?: boolean; disabled?: boolean; location?: GameEventLocation | null
  outcomeControl?: ReactNode; children?: ReactNode
}) {
  const id = useId()
  return <details className="border-y border-line py-3">
    <summary className="cursor-pointer text-sm font-semibold text-content">Shot details</summary>
    <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-3">
      {outcomeControl}
      <label htmlFor={`${id}-body`} className="block text-sm font-medium text-content">Body part</label>
      <select id={`${id}-body`} value={value.bodyPart ?? ''} className="input-field w-full" onChange={event => onChange({ ...value, bodyPart: event.target.value as SoccerBodyPart || null })}>
        <option value="">Unspecified</option><option value="left_foot">Left foot</option><option value="right_foot">Right foot</option>
        {!shootout && <option value="header">Header</option>}
      </select>
      {goal && <>
        <div className="flex items-center justify-between gap-2 text-sm font-medium text-content">
          <span>Goal placement</span>
          <button type="button" disabled={!value.goalPlacement} aria-label="Clear goal placement" title="Clear goal placement" className="grid h-9 w-9 place-items-center disabled:text-content-disabled" onClick={() => onChange({ ...value, goalPlacement: null })}><X size={18} /></button>
        </div>
        <GoalMouth placement={value.goalPlacement} onChange={disabled ? undefined : goalPlacement => onChange({ ...value, goalPlacement })} />
        <div className="grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs text-content-muted">Left / Right
            <input aria-label="Goal placement horizontal" className="block w-full accent-accent" type="range" min="0" max="100" value={Math.round((value.goalPlacement?.x ?? 0.5) * 100)} onChange={event => onChange({ ...value, goalPlacement: { x: Number(event.target.value) / 100, y: value.goalPlacement?.y ?? 0.5 } })} />
          </label>
          <label className="min-w-0 text-xs text-content-muted">High / Low
            <input aria-label="Goal placement vertical" className="block w-full accent-accent" type="range" min="0" max="100" value={Math.round((value.goalPlacement?.y ?? 0.5) * 100)} onChange={event => onChange({ ...value, goalPlacement: { x: value.goalPlacement?.x ?? 0.5, y: Number(event.target.value) / 100 } })} />
          </label>
        </div>
        {!shootout && <Approach location={location} placement={value.goalPlacement} />}
      </>}
      {children}
    </fieldset>
  </details>
}

export function SoccerShotDetailsReview({ event, collapsed = false }: { event: GameEvent; collapsed?: boolean }) {
  if (!isSoccerShotDetailFamily(event.eventType) || !validateSoccerShotDetails(event.eventType, event.payload)) return null
  const value = shotDetailDraft(event)
  if (collapsed && !value.bodyPart && !value.goalPlacement) return null
  const content = <div className="space-y-3 py-3 text-sm text-content">
    <p>Body part: {soccerBodyPartLabel(value.bodyPart)}</p>
    {soccerPlacementAllowed(event.eventType, event.payload) && <>
      <GoalMouth placement={value.goalPlacement} />
      {event.eventType !== 'soccer.shootout_kick' && <Approach location={event.location} placement={value.goalPlacement} />}
    </>}
  </div>
  return collapsed ? <details className="mt-2 border-t border-line"><summary className="cursor-pointer py-2 text-xs font-semibold text-content-muted">Shot details{value.bodyPart ? ` - ${soccerBodyPartLabel(value.bodyPart)}` : ''}</summary>{content}</details> : content
}

function GoalMouth({ placement, onChange }: { placement: SoccerGoalPlacement | null; onChange?: (value: SoccerGoalPlacement) => void }) {
  const dragging = useRef<number | null>(null)
  const update = (element: HTMLDivElement, clientX: number, clientY: number) => {
    const b = element.getBoundingClientRect()
    if (!b.width || !b.height) return
    onChange?.({ x: Math.max(0, Math.min(1, (clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (clientY - b.top) / b.height)) })
  }
  return <figure className="m-0 min-w-0">
    <div className={`relative mx-6 my-6 ${onChange ? 'touch-none cursor-crosshair' : ''}`}
      onPointerDown={onChange ? event => {
        if (!event.isPrimary || event.button !== 0) return
        dragging.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        if (!(event.target instanceof Element && event.target.closest('[data-placement-handle]'))) update(event.currentTarget, event.clientX, event.clientY)
      } : undefined}
      onPointerMove={event => { if (dragging.current === event.pointerId) update(event.currentTarget, event.clientX, event.clientY) }}
      onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }} onLostPointerCapture={() => { dragging.current = null }}>
    <svg viewBox="0 0 100 34" role="img" aria-label="Goal mouth, facing the goal" className="block aspect-[100/34] w-full rounded-sm bg-pitch-surface ring-2 ring-pitch-line">
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(x => <line key={x} x1={x} y1="0" x2={x} y2="34" stroke="rgb(var(--pitch-line))" strokeOpacity="0.3" strokeWidth="0.3" />)}
      {[8.5, 17, 25.5].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgb(var(--pitch-line))" strokeOpacity="0.3" strokeWidth="0.3" />)}
    </svg>
    {placement && <span data-placement-handle="true" aria-hidden="true" className={`absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center ${onChange ? 'cursor-grab' : 'pointer-events-none'}`} style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%` }}>
      <span className="block h-3 w-3 rounded-full border-2 border-pitch-ink bg-pitch-line" />
    </span>}
    </div>
    <figcaption className="mt-1 text-xs text-content-muted">{placement ? `Placement: ${Math.round(placement.x * 100)}% from left, ${Math.round(placement.y * 100)}% from top` : 'Placement unrecorded'}</figcaption>
  </figure>
}

function Approach({ location, placement }: { location: GameEventLocation | null; placement: SoccerGoalPlacement | null }) {
  const approach = soccerShotApproach(location, placement)
  if (!approach) return <p className="text-xs text-content-muted">Shot direction unavailable</p>
  return <figure className="m-0">
    <svg viewBox="0 0 100 64" role="img" aria-label={`Shot direction ${approach.degrees} degrees`} className="block aspect-[100/64] w-full rounded-sm border border-pitch-line bg-pitch-surface">
      <rect x="1" y="1" width="98" height="62" fill="none" stroke="rgb(var(--pitch-line))" strokeWidth="0.6" />
      <line x1="50" y1="1" x2="50" y2="63" stroke="rgb(var(--pitch-line))" strokeWidth="0.5" />
      <circle cx="50" cy="32" r="9" fill="none" stroke="rgb(var(--pitch-line))" strokeWidth="0.5" />
      {[0.5, 99.5].map(x => <line key={x} x1={x} x2={x} y1={SOCCER_DIAGRAM_GOAL_TOP} y2={SOCCER_DIAGRAM_GOAL_TOP + SOCCER_DIAGRAM.goalWidth} stroke="rgb(var(--pitch-line))" strokeWidth="1" />)}
      <line data-shot-direction="true" x1={approach.origin.x * 100} y1={approach.origin.y * 64} x2={approach.goal.x * 100} y2={approach.goal.y * 64} stroke="rgb(var(--pitch-line))" strokeWidth="1" strokeDasharray="2 1" />
      <circle cx={approach.origin.x * 100} cy={approach.origin.y * 64} r="1.5" fill="rgb(var(--pitch-line))" />
    </svg>
    <figcaption className="mt-1 text-xs text-content-muted">Shot direction: {approach.degrees} degrees (illustrative estimate; {placement ? 'recorded placement' : 'goal center'})</figcaption>
  </figure>
}

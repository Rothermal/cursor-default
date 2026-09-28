import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import type { GameEventLocation } from '../../lib/gameEvents/types'
import {
  HOCKEY_CREASE_RADIUS_FT,
  HOCKEY_FACEOFF_CIRCLE_DOT_IDS,
  HOCKEY_FACEOFF_CIRCLE_RADIUS_FT,
  HOCKEY_FACEOFF_DOT_IDS,
  HOCKEY_FACEOFF_DOTS,
  HOCKEY_NET_DEPTH_FT,
  HOCKEY_NET_WIDTH_FT,
  HOCKEY_RINK_CORNER_RADIUS_FT,
  HOCKEY_RINK_LENGTH_FT,
  HOCKEY_RINK_LINES,
  HOCKEY_RINK_WIDTH_FT,
  HOCKEY_TRAPEZOID_BOARDS_WIDTH_FT,
  HOCKEY_TRAPEZOID_GOAL_LINE_WIDTH_FT,
  hockeyRinkLocation,
  oppositeHockeyDirection,
  type HockeyFaceoffDotId,
} from '../../lib/hockey/rinkGeometry'
import type { HockeyAttackingDirection } from '../../lib/hockey'

export type HockeyRinkMarkerKind = 'goal' | 'saved' | 'missed' | 'blocked' | 'event'

export interface HockeyRinkMarker {
  id: string
  /** Canonical 0..1 coordinates. */
  x: number
  y: number
  teamSide: 'tracked' | 'opponent'
  kind: HockeyRinkMarkerKind
  label: string
}

interface HockeyRinkProps {
  trackedDirection: HockeyAttackingDirection
  captureSide?: 'tracked' | 'opponent'
  flipped: boolean
  disabled?: boolean
  trapezoid: boolean
  markers?: HockeyRinkMarker[]
  /** Rings the faceoff dot a tap snapped to (HKY-2C). */
  highlightDotId?: HockeyFaceoffDotId | null
  /**
   * When set, each faceoff dot is its own tap target (HKY-2C), so a faceoff takes a dot
   * tap plus Won or Lost. Taps elsewhere still go to `onLocation`.
   */
  onFaceoffDot?: (dotId: HockeyFaceoffDotId) => void
  onFlip: () => void
  onLocation: (location: GameEventLocation) => void
  onMarker?: (markerId: string) => void
  trackedLabel?: string
  opponentLabel?: string
}

const L = HOCKEY_RINK_LENGTH_FT
const W = HOCKEY_RINK_WIDTH_FT
const MID_Y = W / 2
const LEFT_GOAL_FT = HOCKEY_RINK_LINES.leftGoalLine * L
const RIGHT_GOAL_FT = HOCKEY_RINK_LINES.rightGoalLine * L
const LINE = 'rgb(var(--rink-red))'
const BLUE = 'rgb(var(--rink-blue))'

/** Half the goal line's length where it meets the rounded corners. */
function goalLineHalfSpan(): number {
  const r = HOCKEY_RINK_CORNER_RADIUS_FT
  const dx = r - LEFT_GOAL_FT
  return MID_Y - (r - Math.sqrt(r * r - dx * dx))
}

export default function HockeyRink({
  trackedDirection,
  captureSide = 'tracked',
  flipped,
  disabled = false,
  trapezoid,
  markers = [],
  highlightDotId = null,
  onFaceoffDot,
  onFlip,
  onLocation,
  onMarker,
  trackedLabel = 'Tracked',
  opponentLabel = 'Opponent',
}: HockeyRinkProps) {
  const captureDirection = captureSide === 'tracked'
    ? trackedDirection
    : oppositeHockeyDirection(trackedDirection)
  const displayDirection = flipped ? oppositeHockeyDirection(captureDirection) : captureDirection
  const goalHalf = goalLineHalfSpan()

  return (
    <div>
      <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase text-content-muted">
          {displayDirection === 'left_to_right' ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
          <span className="truncate">{captureSide === 'tracked' ? trackedLabel : opponentLabel} attack</span>
        </div>
        <button
          type="button"
          onClick={onFlip}
          className="h-9 w-9 shrink-0 grid place-items-center rounded-md border border-line-strong bg-surface text-content-muted"
          aria-label="Flip rink view"
          title="Flip rink view"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="relative aspect-[200/85] w-full">
        <svg
          viewBox={`0 0 ${L} ${W}`}
          className={`block h-full w-full origin-center transition-transform motion-reduce:transition-none ${flipped ? 'rotate-180' : ''} ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
          role="group"
          aria-label="Hockey rink"
          onClick={event => {
            if (disabled) return
            const bounds = event.currentTarget.getBoundingClientRect()
            const displayX = (event.clientX - bounds.left) / bounds.width
            const displayY = (event.clientY - bounds.top) / bounds.height
            onLocation(hockeyRinkLocation(displayX, displayY, flipped, captureDirection))
          }}
        >
          <rect
            x="0.75" y="0.75" width={L - 1.5} height={W - 1.5}
            rx={HOCKEY_RINK_CORNER_RADIUS_FT} ry={HOCKEY_RINK_CORNER_RADIUS_FT}
            fill="rgb(var(--rink-ice))" stroke="rgb(var(--rink-board))" strokeWidth="1.5"
          />

          {trapezoid && [LEFT_GOAL_FT, RIGHT_GOAL_FT].map(goalX => {
            const boardsX = goalX < L / 2 ? 0.75 : L - 0.75
            const goalHalfWidth = HOCKEY_TRAPEZOID_GOAL_LINE_WIDTH_FT / 2
            const boardsHalfWidth = HOCKEY_TRAPEZOID_BOARDS_WIDTH_FT / 2
            return (
              <g key={`trapezoid-${goalX}`} stroke={LINE} strokeWidth="0.4">
                <line x1={goalX} y1={MID_Y - goalHalfWidth} x2={boardsX} y2={MID_Y - boardsHalfWidth} />
                <line x1={goalX} y1={MID_Y + goalHalfWidth} x2={boardsX} y2={MID_Y + boardsHalfWidth} />
              </g>
            )
          })}

          {[LEFT_GOAL_FT, RIGHT_GOAL_FT].map(goalX => {
            const toward = goalX < L / 2 ? 1 : -1
            const r = HOCKEY_CREASE_RADIUS_FT
            return (
              <g key={`goal-${goalX}`}>
                <path
                  d={`M ${goalX} ${MID_Y - r} A ${r} ${r} 0 0 ${toward > 0 ? 1 : 0} ${goalX} ${MID_Y + r} Z`}
                  fill="rgb(var(--rink-crease))" stroke={LINE} strokeWidth="0.4"
                />
                <line x1={goalX} y1={MID_Y - goalHalf} x2={goalX} y2={MID_Y + goalHalf} stroke={LINE} strokeWidth="0.4" />
                <rect
                  x={toward > 0 ? goalX - HOCKEY_NET_DEPTH_FT : goalX}
                  y={MID_Y - HOCKEY_NET_WIDTH_FT / 2}
                  width={HOCKEY_NET_DEPTH_FT} height={HOCKEY_NET_WIDTH_FT}
                  fill="none" stroke={LINE} strokeWidth="0.6"
                />
              </g>
            )
          })}

          <rect x={HOCKEY_RINK_LINES.leftBlueLine * L - 0.5} y="0.75" width="1" height={W - 1.5} fill={BLUE} />
          <rect x={HOCKEY_RINK_LINES.rightBlueLine * L - 0.5} y="0.75" width="1" height={W - 1.5} fill={BLUE} />
          <rect x={L / 2 - 0.5} y="0.75" width="1" height={W - 1.5} fill={LINE} />

          {HOCKEY_FACEOFF_CIRCLE_DOT_IDS.map(id => {
            const dot = HOCKEY_FACEOFF_DOTS[id]
            return (
              <circle
                key={`circle-${id}`}
                cx={dot.x * L} cy={dot.y * W} r={HOCKEY_FACEOFF_CIRCLE_RADIUS_FT}
                fill="none" stroke={id === 'center' ? BLUE : LINE} strokeWidth="0.4"
              />
            )
          })}
          {HOCKEY_FACEOFF_DOT_IDS.map(id => {
            const dot = HOCKEY_FACEOFF_DOTS[id]
            return (
              <circle
                key={`dot-${id}`}
                data-faceoff-dot={id}
                cx={dot.x * L} cy={dot.y * W} r={id === 'center' ? 0.6 : 1}
                fill={id === 'center' ? BLUE : LINE}
              />
            )
          })}

          {onFaceoffDot && !disabled && HOCKEY_FACEOFF_DOT_IDS.map(id => (
            <FaceoffDotTarget key={`target-${id}`} dotId={id} onSelect={() => onFaceoffDot(id)} />
          ))}

          {highlightDotId && (
            <circle
              data-highlight-dot={highlightDotId}
              cx={HOCKEY_FACEOFF_DOTS[highlightDotId].x * L}
              cy={HOCKEY_FACEOFF_DOTS[highlightDotId].y * W}
              r="4"
              fill="none"
              stroke="rgb(var(--rink-tracked))"
              strokeWidth="1.2"
            />
          )}

          {markers.map(marker => (
            <HockeyMarker
              key={marker.id}
              marker={marker}
              onSelect={onMarker ? () => onMarker(marker.id) : undefined}
            />
          ))}
        </svg>
        {disabled && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <span className="rounded-md bg-control-hover px-3 py-1.5 text-xs font-bold text-content">Review only</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Tap radius around a dot, in feet: wider than the painted dot so a thumb can hit it. */
const FACEOFF_DOT_TARGET_RADIUS_FT = 5

function FaceoffDotTarget({ dotId, onSelect }: { dotId: HockeyFaceoffDotId; onSelect: () => void }) {
  const dot = HOCKEY_FACEOFF_DOTS[dotId]
  return (
    <circle
      role="button"
      tabIndex={0}
      aria-label={`Faceoff at the ${dotId.replace(/_/g, ' ')} dot`}
      data-faceoff-target={dotId}
      cx={dot.x * L}
      cy={dot.y * W}
      r={FACEOFF_DOT_TARGET_RADIUS_FT}
      fill="transparent"
      className="cursor-pointer outline-none focus-visible:stroke-[rgb(var(--rink-tracked))]"
      strokeWidth="0.8"
      onClick={event => {
        event.stopPropagation()
        onSelect()
      }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
    />
  )
}

function HockeyMarker({ marker, onSelect }: { marker: HockeyRinkMarker; onSelect?: () => void }) {
  const x = marker.x * L
  const y = marker.y * W
  const color = marker.teamSide === 'tracked' ? 'rgb(var(--rink-tracked))' : 'rgb(var(--rink-opponent))'
  return (
    <g
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={marker.label}
      className={onSelect ? 'cursor-pointer outline-none' : undefined}
      onClick={onSelect ? event => {
        event.stopPropagation()
        onSelect()
      } : undefined}
      onKeyDown={event => {
        if (!onSelect || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
    >
      <circle cx={x} cy={y} r="4.6" fill="rgb(var(--rink-ink))" fillOpacity="0.78" />
      {marker.kind === 'missed' ? (
        <g stroke={color} strokeWidth="1.1" strokeLinecap="round">
          <line x1={x - 2.2} y1={y - 2.2} x2={x + 2.2} y2={y + 2.2} />
          <line x1={x + 2.2} y1={y - 2.2} x2={x - 2.2} y2={y + 2.2} />
        </g>
      ) : marker.kind === 'blocked' ? (
        <rect x={x - 2.2} y={y - 2.2} width="4.4" height="4.4" fill="none" stroke={color} strokeWidth="1.1" />
      ) : marker.kind === 'event' ? (
        <path d={`M ${x} ${y - 2.8} L ${x + 2.8} ${y} L ${x} ${y + 2.8} L ${x - 2.8} ${y} Z`} fill="none" stroke={color} strokeWidth="1.1" />
      ) : (
        <circle
          cx={x} cy={y} r={marker.kind === 'goal' ? 2.8 : 2.4}
          fill={marker.kind === 'goal' ? color : 'none'} stroke={color} strokeWidth="1.1"
        />
      )}
    </g>
  )
}

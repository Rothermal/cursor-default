/**
 * Horizontal full-court SVG (BKE-7). Drawn in full-court feet: `x` 0..94 along the
 * length (0 = left baseline), `y` 0..50 across. Each end is the half-court drawing
 * turned to face the other, so a point classifies exactly as it would on the half court.
 * Taps report the canonical point as 0..1 each way; the flip only turns the drawing.
 */
import type { ShotRecord } from '../../types'
import { BASELINE_Y, COURT_WIDTH, FT_CIRCLE_RADIUS } from './courtGeometry'
import { FULL_COURT_LENGTH } from '../../lib/basketball/fullCourtGeometry'
import {
  BasketballCourtEndLines,
  COURT_BG,
  LINE_COLOR,
  LINE_WIDTH,
  ShotMarker,
} from './courtDrawing'
import { useCourtTapHandlers } from './courtTap'

/** Half-court feet to the left end: rim-relative `(x, y)` → full-court feet. */
const LEFT_END_TRANSFORM = `matrix(0 -1 1 0 ${-BASELINE_Y} ${COURT_WIDTH / 2})`
/** The right end is the left end turned half a turn about the court's center. */
const RIGHT_END_TRANSFORM = `matrix(0 1 -1 0 ${FULL_COURT_LENGTH + BASELINE_Y} ${COURT_WIDTH / 2})`
const PADDING = 2
const CENTER_X = FULL_COURT_LENGTH / 2
const CENTER_Y = COURT_WIDTH / 2

export interface BasketballFullCourtLabels {
  /** The team shooting at the left basket (canonical), or null. */
  left: string | null
  /** The team shooting at the right basket (canonical), or null. */
  right: string | null
}

/** A located play (BKE-7D Plays map), in full-court feet (canonical). */
export interface BasketballCourtPlayMarker {
  id: string
  x: number
  y: number
  letter: string
  tone: 'tracked' | 'opponent'
  label: string
}

interface BasketballFullCourtProps {
  /** Shots in full-court feet (canonical). */
  shots: ShotRecord[]
  /** Canonical tap, 0..1 along the length and across. */
  onCourtTap?: (point: { x: number; y: number }) => void
  onMarkerActivate?: (
    shot: ShotRecord,
    marker: SVGGElement,
    point: { x: number; y: number } | null
  ) => void
  className?: string
  newlyPlacedShotId?: string | null
  emptyHint?: string | boolean
  markerTone?: (shot: ShotRecord) => 'tracked' | 'opponent' | null
  markerLabel?: (shot: ShotRecord) => string
  /** Team names shown on the half each attacks, with an arrow toward its basket. */
  labels?: BasketballFullCourtLabels
  /** Turn the drawing half a turn; stored points never change. */
  flipped?: boolean
  plays?: BasketballCourtPlayMarker[]
  onPlayActivate?: (play: BasketballCourtPlayMarker, marker: SVGGElement) => void
}

export default function BasketballFullCourt({
  shots,
  onCourtTap,
  onMarkerActivate,
  className,
  newlyPlacedShotId = null,
  emptyHint,
  markerTone,
  markerLabel,
  labels,
  flipped = false,
  plays = [],
  onPlayActivate,
}: BasketballFullCourtProps) {
  const courtTransform = flipped ? `rotate(180 ${CENTER_X} ${CENTER_Y})` : undefined
  const canonicalFeet = (point: { x: number; y: number }) => flipped
    ? { x: FULL_COURT_LENGTH - point.x, y: COURT_WIDTH - point.y }
    : point
  const tapHandlers = useCourtTapHandlers(onCourtTap ? point => {
    const feet = canonicalFeet(point)
    onCourtTap({
      x: clamp(feet.x / FULL_COURT_LENGTH),
      y: clamp(feet.y / COURT_WIDTH),
    })
  } : undefined)
  // What the viewer sees on each side after the flip.
  const shownLeft = flipped ? labels?.right : labels?.left
  const shownRight = flipped ? labels?.left : labels?.right

  return (
    <div className={className}>
      {labels && (shownLeft || shownRight) && (
        <div className="mb-1 grid grid-cols-2 gap-2 text-xs font-bold text-content-muted">
          <span className="relative min-w-0 truncate text-left" title={shownLeft ? `${shownLeft} attacking the left basket` : undefined}>
            {shownLeft && <><span aria-hidden="true">← </span>{shownLeft}<span className="sr-only"> attacking the left basket</span></>}
          </span>
          <span className="relative min-w-0 truncate text-right" title={shownRight ? `${shownRight} attacking the right basket` : undefined}>
            {shownRight && <>{shownRight}<span className="sr-only"> attacking the right basket</span><span aria-hidden="true"> →</span></>}
          </span>
        </div>
      )}
      <svg
        viewBox={`${-PADDING} ${-PADDING} ${FULL_COURT_LENGTH + PADDING * 2} ${COURT_WIDTH + PADDING * 2}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <g transform={courtTransform}>
          <rect
            x={0}
            y={0}
            width={FULL_COURT_LENGTH}
            height={COURT_WIDTH}
            fill={COURT_BG}
            stroke={LINE_COLOR}
            strokeWidth={LINE_WIDTH}
          />
          <g stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} fill="none">
            <line x1={CENTER_X} y1={0} x2={CENTER_X} y2={COURT_WIDTH} />
            <circle cx={CENTER_X} cy={CENTER_Y} r={FT_CIRCLE_RADIUS} />
          </g>
          <g transform={LEFT_END_TRANSFORM}><BasketballCourtEndLines halfCourtLine={false} /></g>
          <g transform={RIGHT_END_TRANSFORM}><BasketballCourtEndLines halfCourtLine={false} /></g>
        </g>

        {onCourtTap && (
          <rect
            x={-PADDING}
            y={-PADDING}
            width={FULL_COURT_LENGTH + PADDING * 2}
            height={COURT_WIDTH + PADDING * 2}
            fill="transparent"
            {...tapHandlers}
            style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
          />
        )}

        <g transform={courtTransform}>
          {shots.map(shot => (
            <ShotMarker
              key={shot.id}
              shot={shot}
              pulse={shot.id === newlyPlacedShotId}
              tone={markerTone?.(shot) ?? null}
              label={markerLabel?.(shot) ?? `View ${shot.made ? 'made' : 'missed'} shot detail`}
              onActivate={onMarkerActivate ? (activated, marker, point) => onMarkerActivate(
                activated,
                marker,
                point ? canonicalFeet(point) : null
              ) : undefined}
            />
          ))}
        </g>

        {/* Drawn upright after the flip so the letters stay readable. */}
        {plays.map(play => {
          const shown = flipped ? { x: FULL_COURT_LENGTH - play.x, y: COURT_WIDTH - play.y } : play
          const color = play.tone === 'tracked' ? 'rgb(var(--court-tracked))' : 'rgb(var(--court-opponent))'
          return (
            <g
              key={play.id}
              role={onPlayActivate ? 'button' : undefined}
              tabIndex={onPlayActivate ? 0 : undefined}
              aria-label={onPlayActivate ? play.label : undefined}
              onClick={onPlayActivate ? event => onPlayActivate(play, event.currentTarget) : undefined}
              onKeyDown={onPlayActivate ? event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onPlayActivate(play, event.currentTarget)
                }
              } : undefined}
              style={onPlayActivate ? { cursor: 'pointer' } : undefined}
            >
              <circle cx={shown.x} cy={shown.y} r={1.8} fill="transparent" />
              <rect x={shown.x - 1.1} y={shown.y - 1.1} width={2.2} height={2.2} rx={0.4} fill={color} pointerEvents="none" />
              <text
                x={shown.x}
                y={shown.y + 0.6}
                textAnchor="middle"
                fontSize="1.6"
                fontWeight="700"
                fill={COURT_BG}
                pointerEvents="none"
                style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
              >
                {play.letter}
              </text>
            </g>
          )
        })}

        {onCourtTap && shots.length === 0 && emptyHint && (
          <g pointerEvents="none" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
            <text
              x={CENTER_X}
              y={CENTER_Y - 9}
              textAnchor="middle"
              fill="rgb(var(--court-hint))"
              stroke={COURT_BG}
              strokeWidth={1.2}
              paintOrder="stroke"
              fontSize="2.2"
              fontWeight="600"
            >
              Tap the end a team shoots at
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

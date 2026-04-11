import type { ShotRecord } from '../../types'
import {
  COURT_WIDTH,
  HALF_COURT_DEPTH,
  PAINT_WIDTH,
  PAINT_DEPTH,
  FT_CIRCLE_RADIUS,
  RESTRICTED_RADIUS,
  THREE_POINT_RADIUS,
  CORNER_THREE_X,
  BASKET_RADIUS,
  BACKBOARD_WIDTH,
} from './courtGeometry'

interface BasketballCourtProps {
  shots: ShotRecord[]
  onCourtTap?: (x: number, y: number) => void
  className?: string
}

const LINE_COLOR = '#8B6914'
const LINE_WIDTH = 0.3
const COURT_BG = '#e8d5b7'

/**
 * Three-point arc path from left corner to right corner.
 * The arc sits at radius 23.75 ft from the basket (origin).
 * Corner threes are straight verticals at x = ±22 from y = 0 up to where the arc begins.
 */
function threePointArcPath(): string {
  const r = THREE_POINT_RADIUS
  const cx = CORNER_THREE_X

  // y where the arc starts (at x = ±22): y = sqrt(r^2 - 22^2)
  const arcStartY = Math.sqrt(r * r - cx * cx)

  // Left corner vertical: from (−22, 0) up to (−22, arcStartY)
  // Then arc from (−22, arcStartY) around to (22, arcStartY)
  // Then right corner vertical: from (22, arcStartY) down to (22, 0)
  return [
    `M ${-cx} 0`,
    `L ${-cx} ${arcStartY}`,
    `A ${r} ${r} 0 0 1 ${cx} ${arcStartY}`,
    `L ${cx} 0`,
  ].join(' ')
}

/** Restricted area: semicircle at radius 4 ft from basket (0,0), from left to right. */
function restrictedAreaPath(): string {
  const r = RESTRICTED_RADIUS
  return `M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`
}

/** Free throw circle top half (solid) — semicircle above y = 19 */
function ftCircleTopPath(): string {
  const r = FT_CIRCLE_RADIUS
  const cy = PAINT_DEPTH
  return `M ${-r} ${cy} A ${r} ${r} 0 0 1 ${r} ${cy}`
}

/** Free throw circle bottom half (dashed) — semicircle below y = 19 */
function ftCircleBottomPath(): string {
  const r = FT_CIRCLE_RADIUS
  const cy = PAINT_DEPTH
  return `M ${-r} ${cy} A ${r} ${r} 0 0 0 ${r} ${cy}`
}

/** Half-court circle bottom half — at (0, 47), radius 6 ft */
function halfCourtCirclePath(): string {
  const r = FT_CIRCLE_RADIUS
  const cy = HALF_COURT_DEPTH
  return `M ${-r} ${cy} A ${r} ${r} 0 0 0 ${r} ${cy}`
}

function handlePointerDown(
  e: React.PointerEvent<SVGRectElement>,
  onCourtTap: (x: number, y: number) => void
) {
  const svg = e.currentTarget.ownerSVGElement
  if (!svg) return
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const svgPt = pt.matrixTransform(ctm.inverse())
  onCourtTap(
    Math.round(svgPt.x * 10) / 10,
    Math.round(svgPt.y * 10) / 10
  )
}

export default function BasketballCourt({ shots, onCourtTap, className }: BasketballCourtProps) {
  const interactive = Boolean(onCourtTap)
  const halfW = COURT_WIDTH / 2
  const padding = 2

  return (
    <svg
      viewBox={`${-halfW - padding} ${-padding} ${COURT_WIDTH + padding * 2} ${HALF_COURT_DEPTH + padding * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {/* Court background */}
      <rect
        x={-halfW}
        y={0}
        width={COURT_WIDTH}
        height={HALF_COURT_DEPTH}
        fill={COURT_BG}
        stroke={LINE_COLOR}
        strokeWidth={LINE_WIDTH}
      />

      <g stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} fill="none">
        {/* Paint / lane */}
        <rect
          x={-PAINT_WIDTH / 2}
          y={0}
          width={PAINT_WIDTH}
          height={PAINT_DEPTH}
        />

        {/* Free throw circle — top half solid */}
        <path d={ftCircleTopPath()} />

        {/* Free throw circle — bottom half dashed */}
        <path
          d={ftCircleBottomPath()}
          strokeDasharray="1.0 0.8"
        />

        {/* Restricted area arc */}
        <path d={restrictedAreaPath()} />

        {/* Three-point arc + corner lines */}
        <path d={threePointArcPath()} />

        {/* Half-court line */}
        <line
          x1={-halfW}
          y1={HALF_COURT_DEPTH}
          x2={halfW}
          y2={HALF_COURT_DEPTH}
        />

        {/* Half-court circle (bottom half only, visible inside the court) */}
        <path d={halfCourtCirclePath()} />

        {/* Backboard */}
        <line
          x1={-BACKBOARD_WIDTH / 2}
          y1={-0.5}
          x2={BACKBOARD_WIDTH / 2}
          y2={-0.5}
          strokeWidth={0.4}
        />

        {/* Basket (rim) */}
        <circle cx={0} cy={0} r={BASKET_RADIUS} strokeWidth={0.25} />

        {/* Connector from backboard to rim */}
        <line x1={0} y1={-0.5} x2={0} y2={-BASKET_RADIUS} strokeWidth={0.15} />
      </g>

      {/* Shot markers */}
      {shots.map(shot =>
        shot.made ? (
          <circle
            key={shot.id}
            cx={shot.x}
            cy={shot.y}
            r={0.8}
            fill="rgba(34,197,94,0.8)"
            stroke="rgba(22,163,74,0.9)"
            strokeWidth={0.15}
          />
        ) : (
          <g key={shot.id}>
            <line
              x1={shot.x - 0.6}
              y1={shot.y - 0.6}
              x2={shot.x + 0.6}
              y2={shot.y + 0.6}
              stroke="rgba(239,68,68,0.8)"
              strokeWidth={0.3}
              strokeLinecap="round"
            />
            <line
              x1={shot.x + 0.6}
              y1={shot.y - 0.6}
              x2={shot.x - 0.6}
              y2={shot.y + 0.6}
              stroke="rgba(239,68,68,0.8)"
              strokeWidth={0.3}
              strokeLinecap="round"
            />
          </g>
        )
      )}

      {/* Transparent tap target overlay */}
      {interactive && onCourtTap && (
        <rect
          x={-halfW - padding}
          y={-padding}
          width={COURT_WIDTH + padding * 2}
          height={HALF_COURT_DEPTH + padding * 2}
          fill="transparent"
          onPointerDown={e => handlePointerDown(e, onCourtTap)}
          style={{ touchAction: 'none', cursor: 'crosshair' }}
        />
      )}
    </svg>
  )
}

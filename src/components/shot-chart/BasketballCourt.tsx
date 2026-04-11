import type { ShotRecord } from '../../types'
import {
  COURT_WIDTH,
  BASELINE_Y,
  HALFCOURT_Y,
  BACKBOARD_Y,
  BACKBOARD_WIDTH,
  BASKET_RADIUS,
  PAINT_WIDTH,
  FT_LINE_Y,
  FT_CIRCLE_RADIUS,
  RESTRICTED_RADIUS,
  THREE_POINT_RADIUS,
  CORNER_THREE_X,
  LANE_MARKS_FROM_BASELINE,
  BASKET_CENTER_Y,
} from './courtGeometry'

interface BasketballCourtProps {
  shots: ShotRecord[]
  onCourtTap?: (x: number, y: number) => void
  className?: string
}

const LINE_COLOR = '#8B6914'
const LINE_WIDTH = 0.3
const COURT_BG = '#e8d5b7'

// Converts from court coordinates (origin at basket, +y toward half-court)
// to SVG coordinates (origin at top-left, +y downward).
// SVG y = HALFCOURT_Y - court y  →  basket (court y=0) maps to bottom area,
// half-court line (court y=HALFCOURT_Y) maps to y=0 (top).
function cy(courtY: number): number {
  return HALFCOURT_Y - courtY
}

function threePointArcPath(): string {
  const r = THREE_POINT_RADIUS
  const cx = CORNER_THREE_X
  const arcStartY = Math.sqrt(r * r - cx * cx)

  // Corner verticals from baseline up to where the arc starts,
  // then arc sweeping across. In SVG-y the arc start is higher (smaller y).
  return [
    `M ${-cx} ${cy(BASELINE_Y)}`,
    `L ${-cx} ${cy(arcStartY)}`,
    `A ${r} ${r} 0 0 0 ${cx} ${cy(arcStartY)}`,
    `L ${cx} ${cy(BASELINE_Y)}`,
  ].join(' ')
}

function restrictedAreaPath(): string {
  const r = RESTRICTED_RADIUS
  // Semicircle above the basket in court-space (toward half-court).
  // In SVG-y that means smaller y values → sweep flag 1.
  return `M ${-r} ${cy(0)} A ${r} ${r} 0 0 1 ${r} ${cy(0)}`
}

function ftCircleTopPath(): string {
  const r = FT_CIRCLE_RADIUS
  // "Top half" of the FT circle = the part farther from the basket (toward half-court)
  // In SVG-y that means smaller y values → use sweep flag 0
  return `M ${-r} ${cy(FT_LINE_Y)} A ${r} ${r} 0 0 0 ${r} ${cy(FT_LINE_Y)}`
}

function ftCircleBottomPath(): string {
  const r = FT_CIRCLE_RADIUS
  // "Bottom half" = the part closer to the basket → larger SVG y values → sweep flag 1
  return `M ${-r} ${cy(FT_LINE_Y)} A ${r} ${r} 0 0 1 ${r} ${cy(FT_LINE_Y)}`
}

function halfCourtCirclePath(): string {
  const r = FT_CIRCLE_RADIUS
  // The visible half is the part that bulges into the court (downward in SVG-y) → sweep flag 1
  return `M ${-r} ${cy(HALFCOURT_Y)} A ${r} ${r} 0 0 1 ${r} ${cy(HALFCOURT_Y)}`
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
  // Convert SVG-y back to court-y for the callback
  onCourtTap(
    Math.round(svgPt.x * 10) / 10,
    Math.round((HALFCOURT_Y - svgPt.y) * 10) / 10
  )
}

export default function BasketballCourt({ shots, onCourtTap, className }: BasketballCourtProps) {
  const interactive = Boolean(onCourtTap)
  const halfW = COURT_WIDTH / 2
  const padding = 2
  const halfPaintW = PAINT_WIDTH / 2

  const svgCourtTop = cy(HALFCOURT_Y)    // 0
  const svgCourtBottom = cy(BASELINE_Y)  // HALFCOURT_Y - BASELINE_Y
  const courtH = svgCourtBottom - svgCourtTop
  const viewW = COURT_WIDTH + padding * 2
  const viewH = courtH + padding * 2

  return (
    <svg
      viewBox={`${-halfW - padding} ${svgCourtTop - padding} ${viewW} ${viewH}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {/* Court background */}
      <rect
        x={-halfW}
        y={svgCourtTop}
        width={COURT_WIDTH}
        height={courtH}
        fill={COURT_BG}
        stroke={LINE_COLOR}
        strokeWidth={LINE_WIDTH}
      />

      <g stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} fill="none">
        {/* Paint / lane */}
        <rect
          x={-halfPaintW}
          y={cy(FT_LINE_Y)}
          width={PAINT_WIDTH}
          height={cy(BASELINE_Y) - cy(FT_LINE_Y)}
        />

        {/* Lane hash marks */}
        {LANE_MARKS_FROM_BASELINE.map(d => {
          const svgY = cy(d - BASKET_CENTER_Y)
          return (
            <g key={d}>
              <line x1={-halfPaintW - 0.5} y1={svgY} x2={-halfPaintW} y2={svgY} strokeWidth={0.25} />
              <line x1={halfPaintW} y1={svgY} x2={halfPaintW + 0.5} y2={svgY} strokeWidth={0.25} />
            </g>
          )
        })}

        {/* Free throw circle — top half solid (farther from basket) */}
        <path d={ftCircleTopPath()} />

        {/* Free throw circle — bottom half dashed (closer to basket) */}
        <path d={ftCircleBottomPath()} strokeDasharray="1.0 0.8" />

        {/* Restricted area arc */}
        <path d={restrictedAreaPath()} />

        {/* Three-point arc + corner lines */}
        <path d={threePointArcPath()} />

        {/* Half-court line */}
        <line x1={-halfW} y1={cy(HALFCOURT_Y)} x2={halfW} y2={cy(HALFCOURT_Y)} />

        {/* Half-court circle */}
        <path d={halfCourtCirclePath()} />

        {/* Backboard */}
        <line
          x1={-BACKBOARD_WIDTH / 2}
          y1={cy(BACKBOARD_Y)}
          x2={BACKBOARD_WIDTH / 2}
          y2={cy(BACKBOARD_Y)}
          strokeWidth={0.5}
        />

        {/* Basket (rim) */}
        <circle cx={0} cy={cy(0)} r={BASKET_RADIUS} strokeWidth={0.3} />

        {/* Connector from backboard to rim */}
        <line x1={0} y1={cy(BACKBOARD_Y)} x2={0} y2={cy(0) + BASKET_RADIUS} strokeWidth={0.2} />
      </g>

      {/* Shot markers */}
      {shots.map(shot =>
        shot.made ? (
          <circle
            key={shot.id}
            cx={shot.x}
            cy={cy(shot.y)}
            r={0.8}
            fill="rgba(34,197,94,0.8)"
            stroke="rgba(22,163,74,0.9)"
            strokeWidth={0.15}
          />
        ) : (
          <g key={shot.id}>
            <line
              x1={shot.x - 0.6}
              y1={cy(shot.y) - 0.6}
              x2={shot.x + 0.6}
              y2={cy(shot.y) + 0.6}
              stroke="rgba(239,68,68,0.8)"
              strokeWidth={0.3}
              strokeLinecap="round"
            />
            <line
              x1={shot.x + 0.6}
              y1={cy(shot.y) - 0.6}
              x2={shot.x - 0.6}
              y2={cy(shot.y) + 0.6}
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
          y={svgCourtTop - padding}
          width={viewW}
          height={viewH}
          fill="transparent"
          onPointerDown={e => handlePointerDown(e, onCourtTap)}
          style={{ touchAction: 'none', cursor: 'crosshair' }}
        />
      )}
    </svg>
  )
}

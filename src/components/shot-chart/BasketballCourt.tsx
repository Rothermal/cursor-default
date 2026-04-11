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
  CORNER_THREE_ARC_Y,
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

/**
 * Three-point boundary: corner verticals to arc tangents, then two minor arcs
 * meeting at (0, R) so the curve unambiguously cups toward +y (no ambiguous sweep).
 */
function threePointArcPath(): string {
  const r = THREE_POINT_RADIUS
  const cx = CORNER_THREE_X
  const arcY = CORNER_THREE_ARC_Y

  return [
    `M ${-cx} ${BASELINE_Y}`,
    `L ${-cx} ${arcY}`,
    `A ${r} ${r} 0 0 0 0 ${r}`,
    `A ${r} ${r} 0 0 0 ${cx} ${arcY}`,
    `L ${cx} ${BASELINE_Y}`,
  ].join(' ')
}

/** Restricted area: semicircle opening toward the court (+y). */
function restrictedAreaPath(): string {
  const r = RESTRICTED_RADIUS
  return `M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`
}

/**
 * Free-throw circle: dashed semicircle lying on the FT line (endpoints on the line),
 * opening toward the basket (center of full circle is on the half-court side of the line).
 */
function freeThrowKeySemicirclePath(): string {
  const r = FT_CIRCLE_RADIUS
  const cy = FT_LINE_Y
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
  const halfPaintW = PAINT_WIDTH / 2

  const svgCourtTop = BASELINE_Y
  const svgCourtBottom = HALFCOURT_Y
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
        <rect
          x={-halfPaintW}
          y={BASELINE_Y}
          width={PAINT_WIDTH}
          height={FT_LINE_Y - BASELINE_Y}
        />

        {LANE_MARKS_FROM_BASELINE.map(d => {
          const courtY = d - BASKET_CENTER_Y
          return (
            <g key={d}>
              <line
                x1={-halfPaintW - 0.5}
                y1={courtY}
                x2={-halfPaintW}
                y2={courtY}
                strokeWidth={0.25}
              />
              <line
                x1={halfPaintW}
                y1={courtY}
                x2={halfPaintW + 0.5}
                y2={courtY}
                strokeWidth={0.25}
              />
            </g>
          )
        })}

        <path
          d={freeThrowKeySemicirclePath()}
          strokeDasharray="1.0 0.8"
          strokeLinecap="round"
        />

        <path d={restrictedAreaPath()} />

        <path d={threePointArcPath()} />

        <line x1={-halfW} y1={HALFCOURT_Y} x2={halfW} y2={HALFCOURT_Y} />

        <line
          x1={-BACKBOARD_WIDTH / 2}
          y1={BACKBOARD_Y}
          x2={BACKBOARD_WIDTH / 2}
          y2={BACKBOARD_Y}
          strokeWidth={0.5}
        />

        <circle cx={0} cy={0} r={BASKET_RADIUS} strokeWidth={0.3} />

        <line x1={0} y1={BACKBOARD_Y} x2={0} y2={-BASKET_RADIUS} strokeWidth={0.2} />
      </g>

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

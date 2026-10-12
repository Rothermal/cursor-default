/**
 * Half-court SVG. Tap and marker `(x, y)` are feet in rim-centered space — see
 * `src/lib/shotChartCoordinates.ts`.
 */
import type { ShotRecord } from '../../types'
import {
  COURT_WIDTH,
  BASELINE_Y,
  HALFCOURT_Y,
  orientBasketballCourtPoint,
} from './courtGeometry'
import {
  BasketballCourtEndLines,
  COURT_BG,
  LINE_COLOR,
  LINE_WIDTH,
  ShotMarker,
} from './courtDrawing'
import { useCourtTapHandlers } from './courtTap'

interface BasketballCourtProps {
  shots: ShotRecord[]
  onCourtTap?: (x: number, y: number) => void
  onMarkerActivate?: (
    shot: ShotRecord,
    marker: SVGGElement,
    point: { x: number; y: number } | null
  ) => void
  className?: string
  /** When set, this marker plays a short pulse (newly recorded shot). */
  newlyPlacedShotId?: string | null
  /** When truthy, show empty-court hint when interactive and there are no shots. */
  emptyHint?: string | boolean
  /** Optional review-only side tone; live capture keeps the existing result colors by default. */
  markerTone?: (shot: ShotRecord) => 'tracked' | 'opponent' | null
  markerLabel?: (shot: ShotRecord) => string
  /** Rotate presentation while preserving canonical stored shot coordinates. */
  flipped?: boolean
}

export default function BasketballCourt({
  shots,
  onCourtTap,
  onMarkerActivate,
  className,
  newlyPlacedShotId = null,
  emptyHint,
  markerTone,
  markerLabel,
  flipped = false,
}: BasketballCourtProps) {
  const interactive = Boolean(onCourtTap)
  const halfW = COURT_WIDTH / 2
  const padding = 2
  const svgCourtTop = BASELINE_Y
  const svgCourtBottom = HALFCOURT_Y
  const courtH = svgCourtBottom - svgCourtTop
  const courtCenterY = (svgCourtTop + svgCourtBottom) / 2
  const viewW = COURT_WIDTH + padding * 2
  const viewH = courtH + padding * 2
  const courtTransform = flipped ? `rotate(180 0 ${courtCenterY})` : undefined
  const orientation = flipped ? 'flipped' : 'standard'
  const tapHandlers = useCourtTapHandlers(onCourtTap ? point => {
    const canonical = orientBasketballCourtPoint(point, orientation)
    onCourtTap(canonical.x, canonical.y)
  } : undefined)

  return (
    <svg
      viewBox={`${-halfW - padding} ${svgCourtTop - padding} ${viewW} ${viewH}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <g transform={courtTransform}>
        <rect
          x={-halfW}
          y={svgCourtTop}
          width={COURT_WIDTH}
          height={courtH}
          fill={COURT_BG}
          stroke={LINE_COLOR}
          strokeWidth={LINE_WIDTH}
        />
        <BasketballCourtEndLines />
      </g>

      {interactive && onCourtTap && (
        <rect
          x={-halfW - padding}
          y={svgCourtTop - padding}
          width={viewW}
          height={viewH}
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
              point ? orientBasketballCourtPoint(point, orientation) : null
            ) : undefined}
          />
        ))}
      </g>

      {interactive && onCourtTap && shots.length === 0 && emptyHint && (
        <g pointerEvents="none" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
          <text
            x={0}
            y={(svgCourtTop + svgCourtBottom) / 2 - 0.9}
            textAnchor="middle"
            fill="rgb(var(--court-hint))"
            fontSize="1.15"
            fontWeight="600"
          >
            Tap the court
          </text>
          <text
            x={0}
            y={(svgCourtTop + svgCourtBottom) / 2 + 0.85}
            textAnchor="middle"
            fill="rgb(var(--court-hint))"
            fontSize="1.05"
            fontWeight="500"
          >
            to log an event
          </text>
        </g>
      )}
    </svg>
  )
}

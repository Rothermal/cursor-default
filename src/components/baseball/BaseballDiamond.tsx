import { Pencil } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { GameEventLocation } from '../../lib/gameEvents/types'
import {
  BASEBALL_BASE_POINTS,
  BASEBALL_FENCE,
  BASEBALL_FENCE_CONTROL,
  BASEBALL_FIELDER_SPOTS,
  BASEBALL_HOME_PLATE,
  BASEBALL_INFIELD_RADIUS,
  BASEBALL_RUBBER,
  baseballDiamondLocation,
  type BaseballBase,
  type BaseballDiamondView,
} from '../../lib/baseball'

interface BaseballDiamondProps {
  view: BaseballDiamondView
  /** Batting and fielding team names, for labels. */
  battingLabel: string
  fieldingLabel: string
  /** Set during play entry; without it the field ignores taps. */
  onLocation?: (location: GameEventLocation) => void
  onLocationUnknown?: () => void
  onRunner?: (base: BaseballBase) => void
  onFielder?: (position: number) => void
  /** A placed batted ball waiting for a result. */
  pendingLocation?: { x: number; y: number } | null
  /** Shows a pencil on the batter card (opponent slot labels). */
  onEditBatter?: () => void
}

const S = 100
const BASES: BaseballBase[] = ['first', 'second', 'third']
const BASE_NAMES: Record<BaseballBase, string> = { first: 'First', second: 'Second', third: 'Third' }
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']

/** Where each foul line leaves the infield dirt arc. */
function infieldArcEnds() {
  // Solve |home + t*d - rubber| = radius along each foul line (d at 45 degrees).
  const offset = BASEBALL_HOME_PLATE.y - BASEBALL_RUBBER.y
  const half = offset / Math.SQRT2
  const t = half + Math.sqrt(half * half - offset * offset + BASEBALL_INFIELD_RADIUS ** 2)
  const along = t / Math.SQRT2
  return {
    left: { x: BASEBALL_HOME_PLATE.x - along, y: BASEBALL_HOME_PLATE.y - along },
    right: { x: BASEBALL_HOME_PLATE.x + along, y: BASEBALL_HOME_PLATE.y - along },
  }
}

const ARC = infieldArcEnds()
const p = (point: { x: number; y: number }) => `${point.x * S} ${point.y * S}`

/** The painted field without players, shared with the Summary's spray chart (BSB-5B). */
export function BaseballFieldShapes() {
  return (
    <>
      <rect width={S} height={S} fill="rgb(var(--diamond-grass))" />
      {/* Warning track and fence. */}
      <path
        d={`M ${p(BASEBALL_FENCE.left)} Q ${p(BASEBALL_FENCE_CONTROL)} ${p(BASEBALL_FENCE.right)}`}
        fill="none" stroke="rgb(var(--diamond-dirt))" strokeWidth="2.4"
      />
      <path
        d={`M ${p(BASEBALL_FENCE.left)} Q ${p(BASEBALL_FENCE_CONTROL)} ${p(BASEBALL_FENCE.right)}`}
        fill="none" stroke="rgb(var(--diamond-line))" strokeWidth="0.5"
      />
      {/* Infield dirt: from home out along both lines to the arc around the rubber. */}
      <path
        d={`M ${p(BASEBALL_HOME_PLATE)} L ${p(ARC.right)} A ${BASEBALL_INFIELD_RADIUS * S} ${BASEBALL_INFIELD_RADIUS * S} 0 0 0 ${p(ARC.left)} Z`}
        fill="rgb(var(--diamond-dirt))"
      />
      {/* Infield grass inside the base paths. */}
      <path
        d={`M ${BASEBALL_HOME_PLATE.x * S} ${BASEBALL_HOME_PLATE.y * S - 4.2} L ${BASEBALL_BASE_POINTS.first.x * S - 3} ${BASEBALL_BASE_POINTS.first.y * S} L ${BASEBALL_BASE_POINTS.second.x * S} ${BASEBALL_BASE_POINTS.second.y * S + 3} L ${BASEBALL_BASE_POINTS.third.x * S + 3} ${BASEBALL_BASE_POINTS.third.y * S} Z`}
        fill="rgb(var(--diamond-grass))"
      />
      <circle cx={BASEBALL_RUBBER.x * S} cy={BASEBALL_RUBBER.y * S} r="2.6" fill="rgb(var(--diamond-dirt))" />
      <circle cx={BASEBALL_HOME_PLATE.x * S} cy={BASEBALL_HOME_PLATE.y * S} r="3.6" fill="rgb(var(--diamond-dirt))" />
      {/* Foul lines. */}
      <line x1={BASEBALL_HOME_PLATE.x * S} y1={BASEBALL_HOME_PLATE.y * S} x2={BASEBALL_FENCE.left.x * S} y2={BASEBALL_FENCE.left.y * S} stroke="rgb(var(--diamond-line))" strokeWidth="0.45" />
      <line x1={BASEBALL_HOME_PLATE.x * S} y1={BASEBALL_HOME_PLATE.y * S} x2={BASEBALL_FENCE.right.x * S} y2={BASEBALL_FENCE.right.y * S} stroke="rgb(var(--diamond-line))" strokeWidth="0.45" />
      <rect x={BASEBALL_RUBBER.x * S - 0.9} y={BASEBALL_RUBBER.y * S - 0.25} width="1.8" height="0.5" fill="rgb(var(--diamond-line))" />
      {/* Bases and home plate. */}
      {BASES.map(base => {
        const point = BASEBALL_BASE_POINTS[base]
        return (
          <rect
            key={base}
            x={point.x * S - 1.1} y={point.y * S - 1.1} width="2.2" height="2.2"
            transform={`rotate(45 ${point.x * S} ${point.y * S})`}
            fill="rgb(var(--diamond-line))"
          />
        )
      })}
      <path
        d={`M ${BASEBALL_HOME_PLATE.x * S - 1.2} ${BASEBALL_HOME_PLATE.y * S - 1} h 2.4 v 1.1 l -1.2 1.1 l -1.2 -1.1 Z`}
        fill="rgb(var(--diamond-line))"
      />
    </>
  )
}

/**
 * The fixed diamond (BSB-3A): home plate at the bottom, runners on the bases, the batter at
 * home and fielder markers. Taps only do something while a play is being entered.
 */
export default function BaseballDiamond({
  view,
  battingLabel,
  fieldingLabel,
  onLocation,
  onLocationUnknown,
  onRunner,
  onFielder,
  pendingLocation = null,
  onEditBatter,
}: BaseballDiamondProps) {
  const fieldingColor = view.fieldingSide === 'tracked' ? 'rgb(var(--diamond-tracked))' : 'rgb(var(--diamond-opponent))'
  const battingColor = view.fieldingSide === 'tracked' ? 'rgb(var(--diamond-opponent))' : 'rgb(var(--diamond-tracked))'
  const summary = [
    view.batter ? `${battingLabel} batting: ${view.batter.name}, ${ORDINALS[view.batter.slot - 1] ?? view.batter.slot} in the order.` : null,
    ...BASES.map(base => `${BASE_NAMES[base]} base: ${view.runners[base]?.name ?? 'empty'}.`),
  ].filter(Boolean).join(' ')

  return (
    <div className="space-y-2">
      <div className="relative mx-auto aspect-square w-full max-w-[22rem]">
        <svg
          viewBox={`0 0 ${S} ${S}`}
          className={`block h-full w-full rounded-md ${onLocation ? 'cursor-crosshair' : ''}`}
          role="group"
          aria-label={`Baseball diamond. ${summary}`}
          onClick={onLocation ? event => {
            const bounds = event.currentTarget.getBoundingClientRect()
            onLocation(baseballDiamondLocation(
              (event.clientX - bounds.left) / bounds.width,
              (event.clientY - bounds.top) / bounds.height
            ))
          } : undefined}
        >
          <BaseballFieldShapes />

          {view.fielders.map(fielder => {
            const spot = BASEBALL_FIELDER_SPOTS[fielder.position]
            if (!spot) return null
            return (
              <Target
                key={fielder.position}
                label={`${fieldingLabel} fielder ${fielder.position}${fielder.name ? `, ${fielder.name}` : ''}`}
                onSelect={onFielder ? () => onFielder(fielder.position) : undefined}
              >
                <circle cx={spot.x * S} cy={spot.y * S} r="3" fill="rgb(var(--diamond-ink))" fillOpacity="0.82" stroke={fieldingColor} strokeWidth="0.5" />
                <text
                  x={spot.x * S} y={spot.y * S} dy="0.35em" textAnchor="middle"
                  fontSize={fielder.label.length > 2 ? 2.6 : 3.2} fontWeight="700" fill={fieldingColor}
                >
                  {fielder.label}
                </text>
              </Target>
            )
          })}

          {BASES.map(base => {
            const runner = view.runners[base]
            if (!runner) return null
            const point = BASEBALL_BASE_POINTS[base]
            return (
              <Target
                key={`runner-${base}`}
                label={`Runner on ${base}: ${runner.name}`}
                onSelect={onRunner ? () => onRunner(base) : undefined}
              >
                <circle cx={point.x * S} cy={point.y * S} r="4.2" fill="rgb(var(--diamond-ink))" stroke={battingColor} strokeWidth="0.8" />
                <text
                  x={point.x * S} y={point.y * S} dy="0.35em" textAnchor="middle"
                  fontSize={runner.short.length > 2 ? 3 : 3.6} fontWeight="700" fill={battingColor}
                >
                  {runner.short}
                </text>
              </Target>
            )
          })}

          {view.batter && (
            <g aria-hidden="true">
              <circle cx={BASEBALL_HOME_PLATE.x * S - 5.4} cy={BASEBALL_HOME_PLATE.y * S - 1} r="3.6" fill="rgb(var(--diamond-ink))" stroke={battingColor} strokeWidth="0.8" />
              <text
                x={BASEBALL_HOME_PLATE.x * S - 5.4} y={BASEBALL_HOME_PLATE.y * S - 1} dy="0.35em" textAnchor="middle"
                fontSize={view.batter.short.length > 2 ? 2.6 : 3.2} fontWeight="700" fill={battingColor}
              >
                {view.batter.short}
              </text>
            </g>
          )}

          {pendingLocation && (
            <g aria-hidden="true">
              <circle cx={pendingLocation.x * S} cy={pendingLocation.y * S} r="2.4" fill="none" stroke="rgb(var(--diamond-line))" strokeWidth="0.8" />
              <circle cx={pendingLocation.x * S} cy={pendingLocation.y * S} r="0.8" fill="rgb(var(--diamond-line))" />
            </g>
          )}
        </svg>

        {view.batter && (
          <div
            className={`absolute bottom-1 left-1 flex max-w-[48%] items-center gap-1 rounded-md bg-surface/90 py-1 pl-2 text-left shadow-sm ${onEditBatter ? 'pr-0' : 'pointer-events-none pr-2'}`}
          >
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase text-content-muted">
                Batting {ORDINALS[view.batter.slot - 1] ?? view.batter.slot}
              </p>
              <p className="truncate text-sm font-semibold text-content">{view.batter.name}</p>
            </div>
            {onEditBatter && (
              <button
                type="button"
                className="grid h-10 w-10 shrink-0 place-items-center text-content-muted"
                aria-label={`Edit label for ${view.batter.name}`}
                title="Edit batter label"
                onClick={onEditBatter}
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      {onLocationUnknown && (
        <button type="button" className="btn-secondary w-full" onClick={onLocationUnknown}>
          Location unknown
        </button>
      )}
    </div>
  )
}

function Target({ label, onSelect, children }: { label: string; onSelect?: () => void; children: ReactNode }) {
  if (!onSelect) {
    return <g role="img" aria-label={label}>{children}</g>
  }
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onSelect()
  }
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-[rgb(var(--diamond-line))]"
      onClick={event => {
        event.stopPropagation()
        onSelect()
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </g>
  )
}

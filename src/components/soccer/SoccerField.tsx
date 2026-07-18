import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import type { GameEventLocation, GameEventTeamSide } from '../../lib/gameEvents/types'
import type { SoccerAttackingDirection } from '../../lib/soccer'
import { soccerFieldLocation } from '../../lib/soccer/field'

export type SoccerFieldMarkerOutcome = 'goal' | 'saved' | 'blocked' | 'off_target' | 'woodwork' | 'own_goal'

export interface SoccerFieldMarker {
  id: string
  x: number
  y: number
  teamSide: GameEventTeamSide
  outcome: SoccerFieldMarkerOutcome
  label: string
}

interface SoccerFieldProps {
  trackedDirection: SoccerAttackingDirection
  captureSide: GameEventTeamSide
  flipped: boolean
  disabled: boolean
  markers?: SoccerFieldMarker[]
  onFlip: () => void
  onLocation: (location: GameEventLocation) => void
  onMarker?: (markerId: string) => void
}

export default function SoccerField({
  trackedDirection,
  captureSide,
  flipped,
  disabled,
  markers = [],
  onFlip,
  onLocation,
  onMarker,
}: SoccerFieldProps) {
  const captureDirection = captureSide === 'tracked'
    ? trackedDirection
    : oppositeDirection(trackedDirection)
  const displayDirection = flipped ? oppositeDirection(captureDirection) : captureDirection

  return (
    <div>
      <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase text-slate-600">
          {displayDirection === 'left_to_right' ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
          <span className="truncate">{captureSide === 'tracked' ? 'Tracked' : 'Opponent'} attack</span>
        </div>
        <button
          type="button"
          onClick={onFlip}
          className="h-9 w-9 shrink-0 grid place-items-center rounded-md border border-slate-300 bg-white text-slate-600"
          aria-label="Flip field view"
          title="Flip field view"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="relative aspect-[100/64] w-full overflow-hidden rounded-md border-2 border-white bg-emerald-700 shadow-sm">
        <svg
          viewBox="0 0 100 64"
          className={`block h-full w-full origin-center transition-transform motion-reduce:transition-none ${flipped ? 'rotate-180' : ''} ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
          role="group"
          aria-label="Soccer field"
          onClick={event => {
            if (disabled) return
            const bounds = event.currentTarget.getBoundingClientRect()
            const displayX = (event.clientX - bounds.left) / bounds.width
            const displayY = (event.clientY - bounds.top) / bounds.height
            onLocation(soccerFieldLocation(displayX, displayY, flipped, captureDirection))
          }}
        >
          <rect x="0" y="0" width="100" height="64" fill="#23845a" />
          <rect x="2" y="2" width="96" height="60" fill="none" stroke="#f8fafc" strokeWidth="0.65" />
          <line x1="50" y1="2" x2="50" y2="62" stroke="#f8fafc" strokeWidth="0.55" />
          <circle cx="50" cy="32" r="9.15" fill="none" stroke="#f8fafc" strokeWidth="0.55" />
          <circle cx="50" cy="32" r="0.7" fill="#f8fafc" />

          <rect x="2" y="12" width="16.5" height="40" fill="none" stroke="#f8fafc" strokeWidth="0.55" />
          <rect x="2" y="22.8" width="5.5" height="18.4" fill="none" stroke="#f8fafc" strokeWidth="0.55" />
          <circle cx="13" cy="32" r="0.65" fill="#f8fafc" />
          <path d="M18.5 25.9 A9.15 9.15 0 0 1 18.5 38.1" fill="none" stroke="#f8fafc" strokeWidth="0.55" />
          <path d="M2 3.2 A1.2 1.2 0 0 1 3.2 2" fill="none" stroke="#f8fafc" strokeWidth="0.45" />
          <path d="M2 60.8 A1.2 1.2 0 0 0 3.2 62" fill="none" stroke="#f8fafc" strokeWidth="0.45" />
          <rect x="0.3" y="27.8" width="1.7" height="8.4" fill="none" stroke="#f8fafc" strokeWidth="0.5" />

          <rect x="81.5" y="12" width="16.5" height="40" fill="none" stroke="#f8fafc" strokeWidth="0.55" />
          <rect x="92.5" y="22.8" width="5.5" height="18.4" fill="none" stroke="#f8fafc" strokeWidth="0.55" />
          <circle cx="87" cy="32" r="0.65" fill="#f8fafc" />
          <path d="M81.5 25.9 A9.15 9.15 0 0 0 81.5 38.1" fill="none" stroke="#f8fafc" strokeWidth="0.55" />
          <path d="M98 3.2 A1.2 1.2 0 0 0 96.8 2" fill="none" stroke="#f8fafc" strokeWidth="0.45" />
          <path d="M98 60.8 A1.2 1.2 0 0 1 96.8 62" fill="none" stroke="#f8fafc" strokeWidth="0.45" />
          <rect x="98" y="27.8" width="1.7" height="8.4" fill="none" stroke="#f8fafc" strokeWidth="0.5" />

          {markers.map(marker => (
            <SoccerMarker
              key={marker.id}
              marker={marker}
              onSelect={onMarker ? () => onMarker(marker.id) : undefined}
            />
          ))}
        </svg>
        {disabled && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <span className="rounded-md bg-slate-950/75 px-3 py-1.5 text-xs font-bold text-white">Review only</span>
          </div>
        )}
      </div>
      {markers.length > 0 && <MarkerLegend />}
    </div>
  )
}

function MarkerLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-600" aria-label="Field marker legend">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-400" />Tracked</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" />Opponent</span>
      <span className="flex items-center gap-1"><LegendGlyph outcome="goal" />Goal</span>
      <span className="flex items-center gap-1"><LegendGlyph outcome="saved" />Saved</span>
      <span className="flex items-center gap-1"><LegendGlyph outcome="blocked" />Blocked</span>
      <span className="flex items-center gap-1"><LegendGlyph outcome="off_target" />Off</span>
      <span className="flex items-center gap-1"><LegendGlyph outcome="woodwork" />Woodwork</span>
      <span className="flex items-center gap-1"><LegendGlyph outcome="own_goal" />Own goal</span>
    </div>
  )
}

function LegendGlyph({ outcome }: { outcome: SoccerFieldMarkerOutcome }) {
  const base = 'inline-grid h-2.5 w-2.5 place-items-center border border-slate-500 text-[9px] leading-none'
  if (outcome === 'goal') return <span className={`${base} rounded-full bg-slate-500`} />
  if (outcome === 'saved') return <span className={`${base} rounded-full`} />
  if (outcome === 'blocked') return <span className={base} />
  if (outcome === 'off_target') return <span className="inline-grid h-2.5 w-2.5 place-items-center text-[10px] leading-none">x</span>
  if (outcome === 'woodwork') return <span className={`${base} rotate-45 scale-75`} />
  return <span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-slate-500" />
}

function SoccerMarker({ marker, onSelect }: { marker: SoccerFieldMarker; onSelect?: () => void }) {
  const x = marker.x * 100
  const y = marker.y * 64
  const color = marker.teamSide === 'tracked' ? '#facc15' : '#38bdf8'
  const common = {
    fill: marker.outcome === 'goal' ? color : '#0f172a',
    stroke: color,
    strokeWidth: 0.85,
  }
  return (
    <g
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={marker.label}
      className={onSelect ? 'cursor-pointer outline-none' : undefined}
      onClick={event => {
        event.stopPropagation()
        onSelect?.()
      }}
      onKeyDown={event => {
        if (!onSelect || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
    >
      <circle cx={x} cy={y} r="2.6" fill="#0f172a" fillOpacity="0.72" stroke="#f8fafc" strokeWidth="0.45" />
      {marker.outcome === 'blocked' ? (
        <rect x={x - 1.35} y={y - 1.35} width="2.7" height="2.7" {...common} />
      ) : marker.outcome === 'off_target' ? (
        <g stroke={color} strokeWidth="0.9" strokeLinecap="round">
          <line x1={x - 1.35} y1={y - 1.35} x2={x + 1.35} y2={y + 1.35} />
          <line x1={x + 1.35} y1={y - 1.35} x2={x - 1.35} y2={y + 1.35} />
        </g>
      ) : marker.outcome === 'woodwork' ? (
        <path d={`M ${x} ${y - 1.7} L ${x + 1.7} ${y} L ${x} ${y + 1.7} L ${x - 1.7} ${y} Z`} {...common} />
      ) : marker.outcome === 'own_goal' ? (
        <path d={`M ${x} ${y - 1.8} L ${x + 1.8} ${y + 1.5} L ${x - 1.8} ${y + 1.5} Z`} {...common} />
      ) : (
        <circle cx={x} cy={y} r={marker.outcome === 'saved' ? 1.45 : 1.6} {...common} />
      )}
    </g>
  )
}

function oppositeDirection(direction: SoccerAttackingDirection): SoccerAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

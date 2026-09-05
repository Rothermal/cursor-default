import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import type { GameEventLocation } from '../../lib/gameEvents/types'
import type { SoccerAttackingDirection, SoccerTeamSide } from '../../lib/soccer'
import type { SoccerFieldReviewFamily } from '../../lib/soccer/summaryField'
import { clusterSoccerMarkerPoints, soccerFieldLocation } from '../../lib/soccer/field'

export type SoccerFieldMarkerKind =
  | 'goal' | 'saved' | 'blocked' | 'off_target' | 'woodwork' | 'own_goal'
  | 'tackle_won' | 'tackle_lost' | 'interception' | 'clearance' | 'recovery'
  | 'foul' | 'yellow_card' | 'red_card'
  | 'corner' | 'throw_in' | 'goal_kick' | 'offside'

export interface SoccerFieldMarker {
  id: string
  x: number
  y: number
  teamSide: SoccerTeamSide
  kind: SoccerFieldMarkerKind
  label: string
}

interface SoccerFieldProps {
  trackedDirection: SoccerAttackingDirection
  captureSide: SoccerTeamSide
  flipped: boolean
  disabled: boolean
  markers?: SoccerFieldMarker[]
  onFlip: () => void
  onLocation: (location: GameEventLocation) => void
  onMarker?: (markerId: string) => void
  onCluster?: (markerIds: string[]) => void
  presentation?: 'capture' | 'review'
  legendFamilies?: readonly SoccerFieldReviewFamily[]
  activeCaptureLabel?: string
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
  onCluster,
  presentation = 'capture',
  legendFamilies,
  activeCaptureLabel,
}: SoccerFieldProps) {
  const captureDirection = captureSide === 'tracked'
    ? trackedDirection
    : oppositeDirection(trackedDirection)
  const displayDirection = flipped ? oppositeDirection(captureDirection) : captureDirection

  return (
    <div>
      {presentation === 'capture' && (
        <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase text-slate-600">
            {displayDirection === 'left_to_right' ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
            <span className="truncate">
              {activeCaptureLabel ?? `${captureSide === 'tracked' ? 'Tracked' : 'Opponent'} attack`}
            </span>
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
      )}

      <div className={`relative aspect-[100/64] w-full overflow-hidden rounded-md border-2 border-white bg-emerald-700 shadow-sm ${activeCaptureLabel ? 'ring-4 ring-amber-300 ring-offset-2' : ''}`}>
        <svg
          viewBox="0 0 100 64"
          className={`block h-full w-full origin-center transition-transform motion-reduce:transition-none ${flipped ? 'rotate-180' : ''} ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
          role="group"
          aria-label={activeCaptureLabel ? `Soccer field, ${activeCaptureLabel} armed` : 'Soccer field'}
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

          {clusterSoccerMarkerPoints(markers).map(cluster => cluster.length === 1 ? (
            <SoccerMarker
              key={cluster[0].id}
              marker={cluster[0]}
              flipped={flipped}
              onSelect={onMarker ? () => onMarker(cluster[0].id) : undefined}
            />
          ) : (
            <SoccerMarkerCluster
              key={cluster.map(marker => marker.id).join(':')}
              markers={cluster}
              flipped={flipped}
              onSelect={onCluster ? () => onCluster(cluster.map(marker => marker.id)) : undefined}
            />
          ))}
        </svg>
        {disabled && presentation === 'capture' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <span className="rounded-md bg-slate-950/75 px-3 py-1.5 text-xs font-bold text-white">Review only</span>
          </div>
        )}
      </div>
      {markers.length > 0 && (
        <MarkerLegend families={legendFamilies} />
      )}
    </div>
  )
}

function MarkerLegend({
  families = ['attack', 'defense', 'restarts', 'discipline'],
}: {
  families?: readonly SoccerFieldReviewFamily[]
}) {
  const visible = new Set(families)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-600" aria-label="Field marker legend">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-400" />Tracked</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" />Opponent</span>
      {visible.has('attack') && (
        <>
          <span className="flex items-center gap-1"><LegendGlyph kind="goal" />Goal</span>
          <span className="flex items-center gap-1"><LegendGlyph kind="saved" />Shot</span>
        </>
      )}
      {visible.has('defense') && <span className="flex items-center gap-1"><LegendGlyph kind="interception" />Defense</span>}
      {visible.has('restarts') && (
        <>
          <span className="flex items-center gap-1"><LegendGlyph kind="foul" />Foul</span>
          <span className="flex items-center gap-1"><LegendGlyph kind="corner" />Restart</span>
        </>
      )}
      {visible.has('discipline') && <span className="flex items-center gap-1"><LegendGlyph kind="yellow_card" />Card</span>}
    </div>
  )
}

function LegendGlyph({ kind }: { kind: SoccerFieldMarkerKind }) {
  const base = 'inline-grid h-2.5 w-2.5 place-items-center border border-slate-500 text-[9px] leading-none'
  if (kind === 'goal') return <span className={`${base} rounded-full bg-slate-500`} />
  if (kind === 'saved') return <span className={`${base} rounded-full`} />
  if (kind === 'interception') return <span className={`${base} rotate-45 scale-75`} />
  if (kind === 'foul') return <span className={`${base} rounded-sm`}>!</span>
  if (kind === 'yellow_card') return <span className={`${base} bg-yellow-300`} />
  if (kind === 'corner') return <span className="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-slate-500" />
  return <span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-slate-500" />
}

function SoccerMarker({
  marker,
  flipped,
  onSelect,
}: {
  marker: SoccerFieldMarker
  flipped: boolean
  onSelect?: () => void
}) {
  const x = marker.x * 100
  const y = marker.y * 64
  const color = marker.teamSide === 'tracked' ? '#facc15' : '#38bdf8'
  const common = {
    fill: marker.kind === 'goal' || marker.kind === 'tackle_won'
      ? color
      : marker.kind === 'tackle_lost' ? 'none' : '#0f172a',
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
      {marker.kind === 'blocked' || marker.kind === 'tackle_won' || marker.kind === 'tackle_lost' ? (
        <rect x={x - 1.35} y={y - 1.35} width="2.7" height="2.7" {...common} />
      ) : marker.kind === 'off_target' ? (
        <g stroke={color} strokeWidth="0.9" strokeLinecap="round">
          <line x1={x - 1.35} y1={y - 1.35} x2={x + 1.35} y2={y + 1.35} />
          <line x1={x + 1.35} y1={y - 1.35} x2={x - 1.35} y2={y + 1.35} />
        </g>
      ) : marker.kind === 'woodwork' || marker.kind === 'interception' ? (
        <path d={`M ${x} ${y - 1.7} L ${x + 1.7} ${y} L ${x} ${y + 1.7} L ${x - 1.7} ${y} Z`} {...common} />
      ) : marker.kind === 'own_goal' ||
        marker.kind === 'corner' ||
        marker.kind === 'throw_in' ||
        marker.kind === 'goal_kick' ? (
        <path d={`M ${x} ${y - 1.8} L ${x + 1.8} ${y + 1.5} L ${x - 1.8} ${y + 1.5} Z`} {...common} />
      ) : marker.kind === 'clearance' ? (
        <path d={`M ${x - 1.8} ${y + 1.4} L ${x + 1.8} ${y} L ${x - 1.8} ${y - 1.4} Z`} {...common} />
      ) : marker.kind === 'recovery' ? (
        <g stroke={color} strokeWidth="0.9" strokeLinecap="round"><line x1={x - 1.5} y1={y} x2={x + 1.5} y2={y} /><line x1={x} y1={y - 1.5} x2={x} y2={y + 1.5} /></g>
      ) : marker.kind === 'foul' ? (
        <text x={x} y={y + 1.25} transform={uprightMarkerGlyphTransform(flipped, x, y)} textAnchor="middle" fill={color} fontSize="3.7" fontWeight="700">!</text>
      ) : marker.kind === 'yellow_card' || marker.kind === 'red_card' ? (
        <rect x={x - 1.05} y={y - 1.55} width="2.1" height="3.1" rx="0.25" fill={marker.kind === 'yellow_card' ? '#fde047' : '#ef4444'} stroke={color} strokeWidth="0.55" />
      ) : marker.kind === 'offside' ? (
        <g transform={uprightMarkerGlyphTransform(flipped, x, y)} stroke={color} strokeWidth="0.8"><line x1={x - 1.4} y1={y - 1.4} x2={x + 1.4} y2={y + 1.4} /><line x1={x + 1.4} y1={y - 1.4} x2={x - 1.4} y2={y + 1.4} /><line x1={x - 1.8} y1={y + 1.8} x2={x + 1.8} y2={y + 1.8} /></g>
      ) : (
        <circle cx={x} cy={y} r={marker.kind === 'saved' ? 1.45 : 1.6} {...common} />
      )}
    </g>
  )
}

function SoccerMarkerCluster({
  markers,
  flipped,
  onSelect,
}: {
  markers: SoccerFieldMarker[]
  flipped: boolean
  onSelect?: () => void
}) {
  const x = markers.reduce((total, marker) => total + marker.x, 0) / markers.length * 100
  const y = markers.reduce((total, marker) => total + marker.y, 0) / markers.length * 64
  return (
    <g role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${markers.length} events at this location`} className={onSelect ? 'cursor-pointer outline-none' : undefined} onClick={event => { event.stopPropagation(); onSelect?.() }} onKeyDown={event => { if (!onSelect || (event.key !== 'Enter' && event.key !== ' ')) return; event.preventDefault(); event.stopPropagation(); onSelect() }}>
      <circle cx={x} cy={y} r="4.2" fill="#0f172a" stroke="#f8fafc" strokeWidth="0.65" />
      <text x={x} y={y + 1.35} transform={uprightMarkerGlyphTransform(flipped, x, y)} textAnchor="middle" fill="#f8fafc" fontSize="4" fontWeight="700">{markers.length}</text>
    </g>
  )
}

function uprightMarkerGlyphTransform(flipped: boolean, x: number, y: number): string | undefined {
  return flipped ? `rotate(180 ${x} ${y})` : undefined
}

function oppositeDirection(direction: SoccerAttackingDirection): SoccerAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

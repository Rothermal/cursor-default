import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import type { GameEventLocation, GameEventTeamSide } from '../../lib/gameEvents/types'
import type { SoccerAttackingDirection } from '../../lib/soccer'
import { soccerFieldLocation } from '../../lib/soccer/field'

interface SoccerFieldProps {
  trackedDirection: SoccerAttackingDirection
  captureSide: GameEventTeamSide
  flipped: boolean
  disabled: boolean
  onFlip: () => void
  onLocation: (location: GameEventLocation) => void
}

export default function SoccerField({
  trackedDirection,
  captureSide,
  flipped,
  disabled,
  onFlip,
  onLocation,
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
          role="img"
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
        </svg>
        {disabled && <div className="absolute inset-0 grid place-items-center bg-slate-950/35"><span className="rounded-md bg-white/95 px-3 py-2 text-xs font-bold text-slate-700">Field capture unavailable</span></div>}
      </div>
    </div>
  )
}

function oppositeDirection(direction: SoccerAttackingDirection): SoccerAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

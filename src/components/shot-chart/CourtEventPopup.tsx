import { useEffect } from 'react'

/** Stat-only events the popup can record (no court location stored). */
export const COURT_STAT_EVENTS = [
  { statId: 'oreb', label: 'Off Reb' },
  { statId: 'dreb', label: 'Def Reb' },
  { statId: 'stl', label: 'Steal' },
  { statId: 'blk', label: 'Block' },
  { statId: 'ast', label: 'Assist' },
] as const

export type CourtStatEventId = (typeof COURT_STAT_EVENTS)[number]['statId']

/** Choice made in the popup: a located shot, or a stat-only increment. */
export type CourtEvent =
  | { kind: 'shot'; made: boolean }
  | { kind: 'stat'; statId: CourtStatEventId }

interface CourtEventPopupProps {
  /** Display label for the player the event will be attributed to (e.g. "#23 Jordan"). */
  playerLabel: string
  /** Detected from the tap location via `isThreePointer` (override is F5, later). */
  shotType: '2pt' | '3pt'
  onPick: (event: CourtEvent) => void
  /** Cancel button, tap-outside, and Escape all dismiss with no change (D8). */
  onCancel: () => void
}

/**
 * Court Event Capture popup (F1 Option A): opened by a confirmed court tap; resolves
 * the event for the currently selected player. Made/Missed store the tapped location
 * (shot marker); the stat-only buttons increment the stat with no location.
 */
export default function CourtEventPopup({
  playerLabel,
  shotType,
  onPick,
  onCancel,
}: CourtEventPopupProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-bold text-slate-800 truncate">{playerLabel}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Detected: <span className="font-semibold">{shotType === '3pt' ? '3-pointer' : '2-pointer'}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onPick({ kind: 'shot', made: true })}
            className="py-4 rounded-xl text-base font-bold text-white bg-emerald-600
                       active:bg-emerald-700 active:scale-95 transition-transform"
          >
            Made
          </button>
          <button
            type="button"
            onClick={() => onPick({ kind: 'shot', made: false })}
            className="py-4 rounded-xl text-base font-bold text-white bg-rose-600
                       active:bg-rose-700 active:scale-95 transition-transform"
          >
            Missed
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {COURT_STAT_EVENTS.map(({ statId, label }) => (
            <button
              key={statId}
              type="button"
              onClick={() => onPick({ kind: 'stat', statId })}
              className="py-3 px-1 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100
                         border border-slate-200 active:bg-slate-200 active:scale-95 transition-transform"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          Shots save the tapped court location. The other events only add the stat — same as
          tapping its button below the court.
        </p>

        <button
          type="button"
          onClick={onCancel}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-300
                     active:scale-95 transition-transform"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

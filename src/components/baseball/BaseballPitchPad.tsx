import { useState } from 'react'
import {
  BASEBALL_PITCH_PAD_MIN,
  BASEBALL_PITCH_PAD_SPAN,
  baseballPitchPadDisplay,
  baseballPitchPadLocation,
  BASEBALL_MORE_PITCH_RESULTS,
  BASEBALL_PRIMARY_PITCH_RESULTS,
  type BaseballPitchLocation,
  type BaseballPitchResult,
} from '../../lib/baseball'

interface BaseballPitchPadProps {
  /** "Track pitch location" preference; when off, the zone is hidden. */
  showZone: boolean
  pendingLocation: BaseballPitchLocation | null
  onLocation: (location: BaseballPitchLocation | null) => void
  /** Without it the result buttons are shown but disabled, with `disabledReason`. */
  onResult?: (result: BaseballPitchResult) => void
  disabledReason?: string
  /** The "Runners moved" chip: armed, the next result opens runner resolution first. */
  runnersMoved?: { armed: boolean; onToggle: () => void }
}

const V = 100
/** Zone rectangle in the pad's 0..100 display frame. */
const ZONE = {
  x: ((0 - BASEBALL_PITCH_PAD_MIN) / BASEBALL_PITCH_PAD_SPAN) * V,
  size: (1 / BASEBALL_PITCH_PAD_SPAN) * V,
}

/**
 * The pitch pad (BSB-3A, results live in BSB-3B): a catcher's-view strike zone with a
 * ball area around it, the pitch results and the "Runners moved" chip. A location is
 * optional and waits for a result before anything is written.
 */
export default function BaseballPitchPad({
  showZone,
  pendingLocation,
  onLocation,
  onResult,
  disabledReason,
  runnersMoved,
}: BaseballPitchPadProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const pending = pendingLocation ? baseballPitchPadDisplay(pendingLocation) : null
  const disabled = !onResult

  return (
    <section className="rounded-md border border-line bg-surface p-3" aria-label="Pitch pad">
      <div className={showZone ? 'grid grid-cols-[minmax(0,9.5rem)_1fr] gap-3' : ''}>
        {showZone && (
          <div className="space-y-1">
            <svg
              viewBox={`0 0 ${V} ${V}`}
              className="block aspect-square w-full cursor-crosshair rounded-md bg-surface-muted"
              role="group"
              aria-label={pendingLocation ? 'Strike zone, catcher view. A pitch location is placed.' : 'Strike zone, catcher view. Tap to place the pitch.'}
              onClick={event => {
                const bounds = event.currentTarget.getBoundingClientRect()
                onLocation(baseballPitchPadLocation(
                  (event.clientX - bounds.left) / bounds.width,
                  (event.clientY - bounds.top) / bounds.height
                ))
              }}
            >
              <rect
                x={ZONE.x} y={ZONE.x} width={ZONE.size} height={ZONE.size}
                fill="rgb(var(--surface))" stroke="rgb(var(--content))" strokeWidth="0.8"
              />
              {[1, 2].map(line => (
                <g key={line} stroke="rgb(var(--content-subtle))" strokeWidth="0.4" strokeDasharray="1.5 1.5">
                  <line x1={ZONE.x + (ZONE.size * line) / 3} y1={ZONE.x} x2={ZONE.x + (ZONE.size * line) / 3} y2={ZONE.x + ZONE.size} />
                  <line x1={ZONE.x} y1={ZONE.x + (ZONE.size * line) / 3} x2={ZONE.x + ZONE.size} y2={ZONE.x + (ZONE.size * line) / 3} />
                </g>
              ))}
              {/* Home plate below the zone, as the catcher sees it. */}
              <path
                d={`M ${ZONE.x + 4} ${V - 9} h ${ZONE.size - 8} v 2.5 l ${-(ZONE.size - 8) / 2} 4 l ${-(ZONE.size - 8) / 2} -4 Z`}
                fill="rgb(var(--content-subtle))"
              />
              {pending && (
                <g aria-hidden="true">
                  <circle cx={pending.x * V} cy={pending.y * V} r="4.2" fill="rgb(var(--accent))" fillOpacity="0.25" stroke="rgb(var(--accent))" strokeWidth="1" />
                  <circle cx={pending.x * V} cy={pending.y * V} r="1.2" fill="rgb(var(--accent))" />
                </g>
              )}
            </svg>
            <div className="flex min-h-8 items-center justify-between gap-2 text-xs text-content-muted">
              <span>Catcher's view</span>
              {pendingLocation && (
                <button type="button" className="font-semibold text-content underline" onClick={() => onLocation(null)}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {runnersMoved && !disabled && (
            <button
              type="button"
              aria-pressed={runnersMoved.armed}
              className={`${runnersMoved.armed ? 'btn-primary' : 'btn-secondary'} min-h-11 w-full px-1 text-sm leading-tight`}
              onClick={runnersMoved.onToggle}
            >
              {runnersMoved.armed ? 'Runners moved: on' : 'Runners moved'}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Pitch result">
            {BASEBALL_PRIMARY_PITCH_RESULTS.map(entry => (
              <button
                key={entry.result}
                type="button"
                className={`${entry.result === 'in_play' ? 'btn-primary' : 'btn-secondary'} min-h-11 px-1 text-sm leading-tight`}
                disabled={disabled}
                onClick={() => onResult?.(entry.result)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary w-full text-sm"
            aria-expanded={moreOpen}
            disabled={disabled}
            onClick={() => setMoreOpen(open => !open)}
          >
            {moreOpen ? 'Fewer' : 'More'}
          </button>
          {moreOpen && !disabled && (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="More pitch results">
              {BASEBALL_MORE_PITCH_RESULTS.map(entry => (
                <button
                  key={entry.result}
                  type="button"
                  className="btn-secondary min-h-11 px-1 text-sm leading-tight"
                  onClick={() => onResult?.(entry.result)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {disabled && disabledReason && (
        <p className="mt-2 text-xs text-content-muted">{disabledReason}</p>
      )}
    </section>
  )
}

import { useState } from 'react'
import type { HockeyAttackingDirection, HockeySide } from '../../lib/hockey'
import HockeyRink, { type HockeyRinkMarkerKind } from './HockeyRink'
import { Group } from './hockeyFields'

interface HockeyLocationFieldProps {
  value: { x: number; y: number } | null
  onChange: (value: { x: number; y: number } | null) => void
  /** The tracked side's attacking direction in the event's period. */
  trackedDirection: HockeyAttackingDirection
  side: HockeySide
  kind: HockeyRinkMarkerKind
  trapezoid: boolean
  trackedLabel: string
  opponentLabel: string
}

/**
 * Edit-mode location (HKY-4B): a rink with the event's point. A tap moves it; Clear makes the
 * event unlocated. Coordinates stay canonical, so flipping the view changes nothing stored.
 */
export default function HockeyLocationField({
  value,
  onChange,
  trackedDirection,
  side,
  kind,
  trapezoid,
  trackedLabel,
  opponentLabel,
}: HockeyLocationFieldProps) {
  const [flipped, setFlipped] = useState(false)
  return (
    <Group label="Location">
      <HockeyRink
        trackedDirection={trackedDirection}
        captureSide={side}
        flipped={flipped}
        trapezoid={trapezoid}
        trackedLabel={trackedLabel}
        opponentLabel={opponentLabel}
        markers={value ? [{ id: 'location', x: value.x, y: value.y, teamSide: side, kind, label: 'This event' }] : []}
        onFlip={() => setFlipped(current => !current)}
        onLocation={location => onChange({ x: location.x, y: location.y })}
      />
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-content-muted">
        <span>{value ? 'Tap the rink to move it.' : 'No location. Tap the rink to add one.'}</span>
        {value && (
          <button type="button" className="btn-secondary px-3 text-sm" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
    </Group>
  )
}

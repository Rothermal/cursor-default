import type { ShotRecord } from '../../types'
import type { BasketballShotCourtDraft } from '../../lib/basketball/shotEditCommands'
import { basketballFullCourtFeet } from '../../lib/basketball/fullCourtView'
import type { BasketballAttackingDirection } from '../../lib/basketball/types'
import BasketballFullCourt from '../shot-chart/BasketballFullCourt'
import { BasketballEditorSegmentedControl } from './BasketballShotEditor'

/** The full court with the draft's marker; a tap moves the marker, never the basket. */
export function BasketballFullCourtPlacement({
  court,
  made,
  value,
  flipped,
  onPoint,
}: {
  court: BasketballShotCourtDraft
  made: boolean
  value: 1 | 2 | 3
  flipped: boolean
  onPoint: (point: { x: number; y: number }) => void
}) {
  const marker: ShotRecord[] = court.point ? [{
    id: 'draft',
    ...basketballFullCourtFeet(court.point),
    made,
    shotType: value === 3 ? '3pt' : '2pt',
    zone: value === 3 ? 'three' : 'mid_range',
    playerId: '',
    timestamp: 0,
  }] : []
  return (
    <BasketballFullCourt
      shots={marker}
      onCourtTap={onPoint}
      flipped={flipped}
      className="w-full"
      emptyHint
    />
  )
}

/**
 * "Shot at: Left basket / Right basket" (BKE-7 §3.4), in the court's current view. With
 * no basket yet (a period that used both ends) nothing is selected and saving waits.
 */
export function BasketballShotAtControl({
  direction,
  flipped,
  onChange,
}: {
  direction: BasketballAttackingDirection | null
  flipped: boolean
  onChange: (direction: BasketballAttackingDirection) => void
}) {
  const shownRight = direction ? (direction === 'left_to_right') !== flipped : null
  return (
    <div className="space-y-1">
      <BasketballEditorSegmentedControl
        label="Shot at"
        value={shownRight === null ? '' : shownRight ? 'right' : 'left'}
        options={[{ value: 'left', label: 'Left basket' }, { value: 'right', label: 'Right basket' }]}
        onChange={value => onChange((value === 'right') !== flipped ? 'left_to_right' : 'right_to_left')}
      />
      {!direction && (
        <p className="text-xs font-semibold text-warning-content">
          The teams switched ends in this period. Choose the basket this shot was taken at.
        </p>
      )}
    </div>
  )
}

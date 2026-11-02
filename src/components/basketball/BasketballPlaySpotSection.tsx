import { useState } from 'react'
import { Check, LocateFixed, MapPinOff } from 'lucide-react'
import type { ShotRecord } from '../../types'
import { basketballFullCourtFeet } from '../../lib/basketball/fullCourtView'
import {
  basketballPlaySpotLocation,
  basketballPlaySpotText,
  type BasketballPlaySpotDraft,
} from '../../lib/basketball/playLocations'
import BasketballFullCourt from '../shot-chart/BasketballFullCourt'
import { BasketballEditorSection } from './BasketballShotEditor'

/**
 * "Court spot" for a located play (BKE-7C): Move places it on the full court as shown, Remove
 * clears it. The stored direction never changes here (§3.4).
 */
export default function BasketballPlaySpotSection({
  spot,
  flipped,
  onChange,
}: {
  spot: BasketballPlaySpotDraft
  flipped: boolean
  onChange: (spot: BasketballPlaySpotDraft) => void
}) {
  const [placing, setPlacing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const location = basketballPlaySpotLocation(spot)
  const text = location
    ? basketballPlaySpotText(location, flipped ? 'flipped' : 'standard')
    : 'No court spot'
  const marker: ShotRecord[] = spot.point ? [{
    id: 'play-spot',
    ...basketballFullCourtFeet(spot.point),
    made: true,
    shotType: '2pt',
    zone: 'mid_range',
    playerId: '',
    timestamp: 0,
  }] : []

  return (
    <BasketballEditorSection title="Court spot">
      <p className="text-sm font-medium text-content">{text}</p>
      {placing ? (
        <>
          <BasketballFullCourt
            shots={marker}
            onCourtTap={point => onChange({ ...spot, point })}
            markerLabel={() => 'Court spot'}
            flipped={flipped}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => setPlacing(false)}
            disabled={!spot.point}
            className="btn-primary flex min-h-11 w-full items-center justify-center gap-2 disabled:bg-control-disabled disabled:text-content-disabled"
          >
            <Check size={17} aria-hidden />
            Done
          </button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setConfirmRemove(false); setPlacing(true) }}
            className="btn-secondary flex min-h-11 items-center justify-center gap-2"
          >
            <LocateFixed size={17} aria-hidden />
            {spot.point ? 'Move' : 'Locate'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            disabled={!spot.point}
            className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-danger-content disabled:bg-control-disabled disabled:text-content-disabled"
          >
            <MapPinOff size={17} aria-hidden />
            Remove
          </button>
        </div>
      )}
      {confirmRemove && spot.point && !placing && (
        <div className="rounded-md border border-danger-line bg-danger p-3">
          <p className="text-sm font-semibold text-danger-content">Remove this play's court spot?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirmRemove(false)} className="btn-secondary min-h-10 flex-1">Keep</button>
            <button
              type="button"
              onClick={() => { onChange({ ...spot, point: null }); setConfirmRemove(false) }}
              className="min-h-10 flex-1 rounded-md border border-danger-line bg-surface text-sm font-bold text-danger-content"
            >
              Remove spot
            </button>
          </div>
        </div>
      )}
    </BasketballEditorSection>
  )
}

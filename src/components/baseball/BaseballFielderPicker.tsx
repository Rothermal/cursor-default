import { baseballFieldingPositionCode } from '../../lib/baseball'

interface BaseballFielderPickerProps {
  label: string
  hint?: string
  fielderCount: number
  /** Fielding numbers in the order they handled the ball. */
  sequence: number[]
  onChange: (sequence: number[]) => void
}

/** A fielder sequence ("6, 4, 3") built from number buttons, with Clear. */
export default function BaseballFielderPicker({ label, hint, fielderCount, sequence, onChange }: BaseballFielderPickerProps) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold uppercase text-content-muted">{label}</legend>
      <div className="flex min-h-9 items-center gap-2">
        <p className="flex-1 text-sm font-semibold tabular-nums text-content" aria-live="polite">
          {sequence.length > 0 ? sequence.join('-') : <span className="font-normal text-content-muted">{hint ?? 'None yet.'}</span>}
        </p>
        {sequence.length > 0 && (
          <button type="button" className="text-sm font-semibold text-content underline" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: fielderCount }, (_, index) => index + 1).map(position => (
          <button
            key={position}
            type="button"
            className="btn-secondary min-h-11 px-1 text-sm leading-tight"
            aria-label={`Add fielder ${position}${baseballFieldingPositionCode(position) ? `, ${baseballFieldingPositionCode(position)}` : ''}`}
            onClick={() => onChange([...sequence, position])}
          >
            {position}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

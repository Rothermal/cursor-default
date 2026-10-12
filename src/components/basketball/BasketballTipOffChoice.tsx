import type { BasketballAttackingDirection } from '../../lib/basketball/types'

interface BasketballTipOffChoiceProps {
  teamName: string
  /** The court opens flipped, so left and right are swapped on screen. */
  flipped: boolean
  value: BasketballAttackingDirection
  onChange: (direction: BasketballAttackingDirection) => void
  disabled?: boolean
}

/** "Tip-off basket for <Team>: Left basket / Right basket", in the court's opening view. */
export default function BasketballTipOffChoice({
  teamName,
  flipped,
  value,
  onChange,
  disabled = false,
}: BasketballTipOffChoiceProps) {
  const shownRight = (value === 'left_to_right') !== flipped
  const choose = (right: boolean) => onChange(right !== flipped ? 'left_to_right' : 'right_to_left')
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-content">Tip-off basket for {teamName}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-md bg-control p-1">
        {([false, true] as const).map(right => (
          <button
            key={String(right)}
            type="button"
            disabled={disabled}
            aria-pressed={shownRight === right}
            onClick={() => choose(right)}
            className={`min-h-10 rounded text-sm font-bold disabled:text-content-disabled ${shownRight === right
              ? 'bg-accent text-accent-content shadow-sm'
              : 'text-content-muted'}`}
          >
            {right ? 'Right basket' : 'Left basket'}
          </button>
        ))}
      </div>
      <p className="text-xs text-content-subtle">The ends switch at halftime. Use Switch ends in Actions if they change.</p>
    </fieldset>
  )
}

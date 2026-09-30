import { useState } from 'react'
import { BASEBALL_QUICK_RESULT_OPTIONS, type BaseballQuickPlateAppearanceResult } from '../../lib/baseball'
import BaseballChip from './BaseballChip'

interface BaseballQuickPlateAppearanceProps {
  /** Balls and strikes that end a plate appearance under these rules; bound the final count. */
  ballsForWalk: number
  strikesForStrikeout: number
  onCancel: () => void
  onContinue: (choice: { result: BaseballQuickPlateAppearanceResult; finalBalls: number | null; finalStrikes: number | null }) => void
}

/**
 * Quick PA (BSB-3B): a plate appearance without its pitches, with an optional final
 * count. The engine counts its pitches as a lower bound.
 */
export default function BaseballQuickPlateAppearance({
  ballsForWalk,
  strikesForStrikeout,
  onCancel,
  onContinue,
}: BaseballQuickPlateAppearanceProps) {
  const [result, setResult] = useState<BaseballQuickPlateAppearanceResult | null>(null)
  const [balls, setBalls] = useState<number | null>(null)
  const [strikes, setStrikes] = useState<number | null>(null)
  // The engine stores a final count only as a pair.
  const partialCount = (balls === null) !== (strikes === null)

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Quick plate appearance">
      <h2 className="font-bold text-content">Quick PA</h2>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">Result</legend>
        <div className="grid grid-cols-2 gap-2">
          {BASEBALL_QUICK_RESULT_OPTIONS.map(option => (
            <BaseballChip
              key={option.result}
              label={option.label}
              selected={result === option.result}
              onClick={() => setResult(option.result)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">Final count (optional)</legend>
        <CountRow label="Balls" max={ballsForWalk} value={balls} onChange={setBalls} />
        <CountRow label="Strikes" max={strikesForStrikeout} value={strikes} onChange={setStrikes} />
        {partialCount && <p className="text-sm text-content-muted">Set both balls and strikes, or neither.</p>}
      </fieldset>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!result || partialCount}
          onClick={() => result && onContinue({ result, finalBalls: balls, finalStrikes: strikes })}
        >
          {result === 'in_play' ? 'Ball in play' : 'Save'}
        </button>
      </div>
    </section>
  )
}

function CountRow({ label, max, value, onChange }: { label: string; max: number; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`Final ${label.toLowerCase()}`}>
      <span className="w-14 shrink-0 text-sm text-content-muted">{label}</span>
      <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${max + 1}, minmax(0, 1fr))` }}>
        {Array.from({ length: max + 1 }, (_, count) => (
          <BaseballChip
            key={count}
            label={String(count)}
            selected={value === count}
            onClick={() => onChange(value === count ? null : count)}
          />
        ))}
      </div>
    </div>
  )
}

import {
  BASEBALL_BATTED_BALL_OPTIONS,
  BASEBALL_IN_PLAY_RESULT_OPTIONS,
  buildBaseballBattedBall,
  type BaseballBattedBall,
  type BaseballInPlayDraft,
} from '../../lib/baseball'
import BaseballChip from './BaseballChip'
import BaseballFielderPicker from './BaseballFielderPicker'

interface BaseballInPlaySheetProps {
  draft: BaseballInPlayDraft
  onChange: (draft: BaseballInPlayDraft) => void
  /** "Track batted-ball location"; when off, the spray step is skipped. */
  trackLocation: boolean
  /** Fielding positions on the field (9, or 10 for slowpitch). */
  fielderCount: number
  onCancel: () => void
  onContinue: (battedBall: BaseballBattedBall) => void
}

/**
 * The in-play sheet (BSB-3B): result, batted-ball type, spray location and the fielder
 * sequence. Spray and fielder taps also land on the diamond above it.
 */
export default function BaseballInPlaySheet({
  draft,
  onChange,
  trackLocation,
  fielderCount,
  onCancel,
  onContinue,
}: BaseballInPlaySheetProps) {
  const built = buildBaseballBattedBall(draft)
  const set = (patch: Partial<BaseballInPlayDraft>) => onChange({ ...draft, ...patch })

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Ball in play">
      <h2 className="font-bold text-content">Ball in play</h2>

      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">Result</legend>
        <div className="grid grid-cols-4 gap-2">
          {BASEBALL_IN_PLAY_RESULT_OPTIONS.map(option => (
            <BaseballChip
              key={option.result}
              label={option.label}
              selected={draft.result === option.result}
              wide={option.label.length > 6}
              onClick={() => set({ result: option.result, errorBy: option.result === 'error' ? draft.errorBy : null })}
            />
          ))}
        </div>
        {draft.result === 'home_run' && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-content">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[rgb(var(--accent))]"
              checked={draft.insideThePark}
              onChange={event => set({ insideThePark: event.target.checked })}
            />
            Inside the park
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">Batted ball</legend>
        <div className="grid grid-cols-3 gap-2">
          {BASEBALL_BATTED_BALL_OPTIONS.map(option => (
            <BaseballChip
              key={option.type}
              label={option.label}
              selected={draft.battedBallType === option.type}
              onClick={() => set({ battedBallType: option.type })}
            />
          ))}
        </div>
      </fieldset>

      {trackLocation && (
        <p className="text-sm text-content-muted" aria-live="polite">
          {draft.location
            ? 'Spray location placed. Tap the field again to move it.'
            : 'Tap the field where the ball went, or leave it unknown.'}
          {draft.location && (
            <button type="button" className="ml-2 font-semibold text-content underline" onClick={() => set({ location: null })}>
              Clear
            </button>
          )}
        </p>
      )}

      <BaseballFielderPicker
        label="Fielders, in order"
        hint="Tap the fielders on the diamond, or their position numbers."
        fielderCount={fielderCount}
        sequence={draft.fielders}
        onChange={fielders => set({ fielders })}
      />

      {draft.result === 'error' && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase text-content-muted">Error by</legend>
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: fielderCount }, (_, index) => index + 1).map(position => (
              <BaseballChip
                key={position}
                label={String(position)}
                selected={draft.errorBy === position}
                onClick={() => set({ errorBy: position })}
              />
            ))}
          </div>
        </fieldset>
      )}

      {!built.ok && draft.result && <p className="text-sm text-content-muted">{built.message}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!built.ok}
          onClick={() => built.ok && onContinue(built.battedBall)}
        >
          Runners
        </button>
      </div>
    </section>
  )
}

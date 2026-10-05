import { AlertTriangle } from 'lucide-react'
import {
  baseballPersonLabel,
  type BaseballDecisionsView,
  type BaseballPitcherDecisions,
  type BaseballSideDecisions,
  type BaseballSportGameState,
  type BaseballTeamNames,
  type BaseballTeamSide,
} from '../../lib/baseball'

type Role = 'win' | 'loss' | 'save'

const ROLE_LABELS: Record<Role, string> = { win: 'Win (W)', loss: 'Loss (L)', save: 'Save (SV)' }

/**
 * Set pitcher decisions (BSB-5D). Seeded with the stored decisions or the suggestion; W and SV
 * for the winners, L for the losers and holds for either team. Problems show as they happen
 * and block saving; the recorder's choice always wins over the suggestion.
 */
export default function BaseballDecisionsSheet({
  sport,
  view,
  names,
  draft,
  issues,
  error,
  onChange,
  onUseSuggestion,
  onCancel,
  onSave,
}: {
  sport: BaseballSportGameState
  view: BaseballDecisionsView
  names: BaseballTeamNames
  draft: BaseballPitcherDecisions
  issues: string[]
  error: string | null
  onChange: (draft: BaseballPitcherDecisions) => void
  onUseSuggestion: () => void
  onCancel: () => void
  onSave: () => void
}) {
  const name = (id: string) => baseballPersonLabel(sport, id).name
  const winner = view.winner
  const loser: BaseballTeamSide | null = winner === 'tracked' ? 'opponent' : winner === 'opponent' ? 'tracked' : null
  const setSide = (side: BaseballTeamSide, patch: Partial<Pick<BaseballSideDecisions, Role | 'holds'>>) => {
    const next: BaseballSideDecisions = { ...draft[side], ...(patch as BaseballSideDecisions) }
    onChange(side === 'tracked' ? { ...draft, tracked: next } : { ...draft, opponent: next })
  }

  const roleSelect = (side: BaseballTeamSide, role: Role) => (
    <label className="block min-w-0 text-xs font-semibold text-content-muted">
      {ROLE_LABELS[role]}
      <select
        className="input-field mt-1 min-h-11 w-full min-w-0 px-2 py-2 text-sm"
        value={draft[side][role] ?? ''}
        onChange={event => setSide(side, { [role]: event.target.value || null })}
      >
        <option value="">None</option>
        {view.pitchers[side].map(id => (
          <option key={id} value={id}>{name(id)}</option>
        ))}
      </select>
    </label>
  )

  return (
    <section className="max-h-[85vh] space-y-3 overflow-y-auto rounded-md border border-line bg-surface p-3" aria-label="Pitcher decisions">
      <div>
        <h2 className="font-bold text-content">Pitcher decisions</h2>
        <p className="text-sm text-content-muted">
          The suggestion follows official scoring in a simplified form. Your choice always counts.
        </p>
      </div>

      {view.suggestion.notes.length > 0 && (
        <ul className="space-y-1 rounded-md bg-surface-muted p-2 text-sm text-content-muted">
          {view.suggestion.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      )}

      {(['tracked', 'opponent'] as const).map(side => (
        <fieldset key={side} className="space-y-2">
          <legend className="truncate text-sm font-bold text-content">{names[side]}</legend>
          {view.pitchers[side].length === 0 ? (
            <p className="text-sm text-content-muted">No pitcher appeared.</p>
          ) : (
            <>
              {(side === winner || side === loser) && (
                <div className="grid grid-cols-2 gap-2">
                  {side === winner ? <>{roleSelect(side, 'win')}{roleSelect(side, 'save')}</> : roleSelect(side, 'loss')}
                </div>
              )}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-content-muted">Holds (HLD)</p>
                <div className="flex flex-wrap gap-x-4">
                  {view.pitchers[side].map(id => (
                    <label key={id} className="flex min-h-11 items-center gap-2 text-sm text-content">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={draft[side].holds.includes(id)}
                        onChange={event => setSide(side, {
                          holds: event.target.checked
                            ? view.pitchers[side].filter(other => other === id || draft[side].holds.includes(other))
                            : draft[side].holds.filter(other => other !== id),
                        })}
                      />
                      {name(id)}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </fieldset>
      ))}
      {!winner && <p className="text-sm text-content-muted">This game has no winner, so only holds can be set.</p>}

      {issues.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-warning-line bg-warning p-2 text-sm text-warning-content">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <ul className="space-y-0.5">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
        </div>
      )}
      {error && <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>}

      <button type="button" className="btn-secondary w-full" onClick={onUseSuggestion}>Use the suggestion</button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={issues.length > 0} onClick={onSave}>Save decisions</button>
      </div>
    </section>
  )
}

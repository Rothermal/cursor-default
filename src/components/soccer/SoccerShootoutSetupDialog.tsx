import { useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  soccerShootoutSetupDefaults,
  startSoccerShootout,
  type SoccerLiveResult,
} from '../../lib/soccer'
import type { GameState } from '../../types'
import { gameSideDisplayName } from '../../lib/display'

interface SoccerShootoutSetupDialogProps {
  state: GameState
  recorderUserId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onClose: () => void
}

export default function SoccerShootoutSetupDialog({
  state,
  recorderUserId,
  busy,
  onApply,
  onClose,
}: SoccerShootoutSetupDialogProps) {
  const projection = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState.projection
    : null
  const defaults = useMemo(
    () => projection ? soccerShootoutSetupDefaults(projection) : null,
    [projection]
  )
  const [firstSide, setFirstSide] = useState<'tracked' | 'opponent'>('tracked')
  const [eligibleIds, setEligibleIds] = useState<string[]>(defaults?.trackedEligibleParticipantIds ?? [])
  const [opponentCount, setOpponentCount] = useState(defaults?.opponentEligibleCount ?? 1)
  const [goalkeeperId, setGoalkeeperId] = useState(defaults?.trackedGoalkeeperParticipantId ?? '')
  const [opponentGoalkeeper, setOpponentGoalkeeper] = useState('Unknown')
  const [error, setError] = useState<string | null>(null)
  const trackedLabel = gameSideDisplayName(state.gameInfo, 'tracked')
  const opponentLabel = gameSideDisplayName(state.gameInfo, 'opponent')

  if (!projection || !defaults) return null
  const finalIds = defaults.trackedEligibleParticipantIds
  const participants = finalIds.map(id => projection.participants[id]).filter(Boolean)
  const goalkeeperCandidates = participants.filter(participant =>
    eligibleIds.includes(participant.participantId) && participant.role.group === 'goalkeeper'
  )
  const excludedIds = finalIds.filter(id => !eligibleIds.includes(id))
  const valid = eligibleIds.length > 0 &&
    eligibleIds.length === opponentCount &&
    eligibleIds.includes(goalkeeperId) &&
    goalkeeperCandidates.some(participant => participant.participantId === goalkeeperId)

  const toggleEligible = (participantId: string) => {
    setEligibleIds(current => current.includes(participantId)
      ? current.filter(id => id !== participantId)
      : [...current, participantId])
  }

  const submit = () => {
    if (!valid) {
      setError('Tracked and opponent eligibility counts must match, with an eligible goalkeeper selected.')
      return
    }
    const result = startSoccerShootout(state, {
      firstKickingSide: firstSide,
      trackedEligibleParticipantIds: eligibleIds,
      trackedExcludedParticipantIds: excludedIds,
      opponentEligibleCount: opponentCount,
      trackedGoalkeeperParticipantId: goalkeeperId,
      opponentGoalkeeperLabel: opponentGoalkeeper,
    }, { recorderUserId })
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (onApply(result)) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.45] sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="shootout-setup-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-lg sm:rounded-lg" onClick={event => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex min-h-14 items-center border-b border-line bg-surface px-4">
          <h2 id="shootout-setup-title" className="flex-1 font-bold text-content">Start Shootout</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Close" title="Close"><X size={20} /></button>
        </header>
        <div className="space-y-5 p-4">
          <Field label="First kicking side">
            <div className="grid grid-cols-2 rounded-md bg-control p-1">
              <Choice active={firstSide === 'tracked'} label={trackedLabel} onClick={() => setFirstSide('tracked')} />
              <Choice active={firstSide === 'opponent'} label={opponentLabel} onClick={() => setFirstSide('opponent')} />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kicks per side"><div className="input-field bg-canvas text-center font-bold">{projection.currentRules.shootoutInitialKicksPerSide}</div></Field>
            <Field label="Opponent eligible">
              <input type="number" min="1" max={finalIds.length} value={opponentCount} onChange={event => setOpponentCount(Math.min(finalIds.length, Math.max(1, Number(event.target.value) || 1)))} className="input-field text-center" />
            </Field>
          </div>

          <Field label={`Tracked eligibility (${eligibleIds.length}/${opponentCount})`}>
            <div className="divide-y divide-line border-y border-line">
              {participants.map(participant => (
                <label key={participant.participantId} className="flex min-h-11 items-center gap-3 py-2 text-sm font-medium text-content">
                  <input type="checkbox" checked={eligibleIds.includes(participant.participantId)} onChange={() => toggleEligible(participant.participantId)} className="bg-surface h-5 w-5 accent-accent" />
                  <span className="min-w-0 flex-1 truncate">{participant.number ? `#${participant.number} ` : ''}{participant.displayName}</span>
                  <span className="text-xs capitalize text-content-subtle">{participant.role.label ?? participant.role.group}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Tracked goalkeeper">
            <select value={goalkeeperId} onChange={event => setGoalkeeperId(event.target.value)} className="input-field">
              <option value="">Select goalkeeper</option>
              {goalkeeperCandidates.map(participant => <option key={participant.participantId} value={participant.participantId}>{participant.displayName}</option>)}
            </select>
          </Field>
          <Field label="Opponent goalkeeper">
            <input value={opponentGoalkeeper} onChange={event => setOpponentGoalkeeper(event.target.value)} placeholder="Unknown or goalkeeper name" className="input-field" />
          </Field>

          {error && <p className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>}
          <button type="button" onClick={submit} disabled={busy || !valid} className="min-h-12 w-full rounded-md bg-success px-4 text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled">Start Shootout</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <section><h3 className="mb-2 text-xs font-bold uppercase text-content-muted">{label}</h3>{children}</section>
}

function Choice({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`h-9 rounded text-xs font-bold ${active ? 'bg-surface text-content shadow-sm' : 'text-content-muted'}`}>{label}</button>
}

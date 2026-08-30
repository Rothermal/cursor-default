import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import { useGame } from '../../context/GameContext'
import {
  applyBasketballLineupCorrection,
  basketballLineupCorrectionDraft,
  previewBasketballLineupCorrection,
  type BasketballLineupCorrectionDraft,
  type BasketballLineupCorrectionPreview,
} from '../../lib/basketball/lineupCorrectionCommands'
import { BASKETBALL_SUBSTITUTION_REASON_OPTIONS } from '../../lib/basketball/lineupTransitions'
import type {
  BasketballEqualPlayViolationCode,
  BasketballRoleChange,
  BasketballSubstitutionMode,
  BasketballSubstitutionReasonCode,
} from '../../lib/basketball/types'
import BasketballHistoricalTimeField from './BasketballHistoricalTimeField'
import {
  BasketballEditorErrorMessage,
  BasketballEditorFrame,
  BasketballEditorSection,
  BasketballEditorSelectField,
} from './BasketballShotEditor'

interface Props {
  eventId: string
  onClose: () => void
  onApplied: (eventId: string) => void
}

const MODE_OPTIONS: Array<{ value: BasketballSubstitutionMode; label: string }> = [
  { value: 'balanced', label: 'Balanced substitution' },
  { value: 'exit_only', label: 'Exit only' },
  { value: 'entry_only', label: 'Entry only' },
  { value: 'mixed', label: 'Mixed entries and exits' },
  { value: 'boundary', label: 'Period boundary' },
  { value: 'current_lineup_recovery', label: 'Current lineup recovery' },
]

const VIOLATION_OPTIONS: Array<{ value: BasketballEqualPlayViolationCode; label: string }> = [
  { value: 'minimum_periods', label: 'Minimum periods' },
  { value: 'maximum_consecutive_periods', label: 'Maximum consecutive periods' },
  { value: 'maximum_period_imbalance', label: 'Maximum period imbalance' },
]

export default function BasketballLineupCorrectionEditor({ eventId, onClose, onApplied }: Props) {
  const { state, dispatch } = useGame()
  const initial = useMemo(() => basketballLineupCorrectionDraft(state, eventId), [eventId, state])
  const [draft, setDraft] = useState<BasketballLineupCorrectionDraft | null>(() =>
    initial.ok ? initial.value : null
  )
  const [preview, setPreview] = useState<BasketballLineupCorrectionPreview | null>(null)
  const [error, setError] = useState<string | null>(() => initial.ok ? null : initial.message)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => closeRef.current?.focus(), [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (preview) setPreview(null)
      else onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, preview])

  if (!draft) {
    return (
      <BasketballEditorFrame title="Edit lineup history" onClose={onClose} closeRef={closeRef}>
        <div className="p-4">
          <BasketballEditorErrorMessage message={error ?? 'This lineup event is unavailable.'} />
        </div>
      </BasketballEditorFrame>
    )
  }

  const sportState = state.sportGameState?.sportId === 'basketball' ? state.sportGameState : null
  const participants = Object.values(sportState?.projection.participants ?? {})
    .filter(participant => participant.teamSide === draft.teamSide)
  const participantIds = draft.eventType === 'basketball.substitution' ||
    draft.eventType === 'basketball.lineup_confirmed'
    ? draft.participantIds
    : draft.eventType === 'basketball.equal_play_override'
      ? draft.candidateParticipantIds
      : null

  const update = (changes: Partial<BasketballLineupCorrectionDraft>) => {
    setDraft(current => current ? { ...current, ...changes } as BasketballLineupCorrectionDraft : current)
    setPreview(null)
    setError(null)
  }

  const toggleParticipant = (participantId: string) => {
    if (!participantIds) return
    const next = participantIds.includes(participantId)
      ? participantIds.filter(id => id !== participantId)
      : [...participantIds, participantId]
    if (draft.eventType === 'basketball.substitution' || draft.eventType === 'basketball.lineup_confirmed') {
      update({ participantIds: next })
    } else if (draft.eventType === 'basketball.equal_play_override') {
      update({ candidateParticipantIds: next })
    }
  }

  const requestPreview = () => {
    const result = previewBasketballLineupCorrection(state, draft)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setPreview(result.value)
  }

  const apply = () => {
    if (!preview) return
    const result = applyBasketballLineupCorrection(state, preview)
    if (!result.ok) {
      setError(result.message)
      setPreview(null)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    onApplied(preview.eventId)
  }

  if (preview) {
    return (
      <BasketballEditorFrame title="Review lineup changes" onClose={() => setPreview(null)} closeRef={closeRef}>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <ul className="space-y-2" aria-live="polite">
            {preview.consequenceLines.map(line => (
              <li key={line} className="flex gap-2 text-sm text-slate-700">
                <Check className="mt-0.5 shrink-0 text-emerald-600" size={16} aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={() => setPreview(null)} className="btn-secondary min-h-11">Back</button>
          <button type="button" onClick={apply} className="btn-primary min-h-11">Save changes</button>
        </footer>
      </BasketballEditorFrame>
    )
  }

  return (
    <BasketballEditorFrame title={`Edit ${editorTitle(draft)}`} onClose={onClose} closeRef={closeRef}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BasketballEditorSection title="Historical time">
          <BasketballHistoricalTimeField
            state={state}
            period={draft.period}
            elapsedMs={draft.elapsedMs}
            onChange={elapsedMs => update({ elapsedMs })}
          />
        </BasketballEditorSection>

        {participantIds && (
          <BasketballEditorSection title="Resulting lineup">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-700">
                Select one through five players
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {participants.map(participant => (
                  <label key={participant.participantId} className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={participantIds.includes(participant.participantId)}
                      onChange={() => toggleParticipant(participant.participantId)}
                      className="h-5 w-5"
                    />
                    <span>{participant.number ? `#${participant.number} ` : ''}{participant.displayName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </BasketballEditorSection>
        )}

        {draft.eventType === 'basketball.substitution' && (
          <BasketballEditorSection title="Transition authority">
            <BasketballEditorSelectField
              label="Transition"
              value={draft.mode}
              options={MODE_OPTIONS}
              onChange={mode => update({ mode: mode as BasketballSubstitutionMode })}
            />
            <BasketballEditorSelectField
              label="Reason"
              value={draft.reasonCode ?? ''}
              options={[
                { value: '', label: 'No reason' },
                ...BASKETBALL_SUBSTITUTION_REASON_OPTIONS,
              ]}
              onChange={reasonCode => update({
                reasonCode: reasonCode ? reasonCode as BasketballSubstitutionReasonCode : null,
                ...(!reasonCode ? { reasonNote: null } : {}),
              })}
            />
            {draft.reasonCode && (
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  {draft.reasonCode === 'other' ? 'Reason note (required)' : 'Reason note'}
                </span>
                <textarea
                  value={draft.reasonNote ?? ''}
                  onChange={event => update({ reasonNote: event.target.value.trim() ? event.target.value : null })}
                  maxLength={240}
                  rows={3}
                  className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
                />
              </label>
            )}
          </BasketballEditorSection>
        )}

        {draft.eventType === 'basketball.role_changed' && (
          <BasketballEditorSection title="Roles and captains">
            <div className="space-y-3">
              {draft.changes.map((change, index) => {
                const participant = sportState?.projection.participants[change.participantId]
                return (
                  <div key={change.participantId} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    <p className="mb-2 text-sm font-bold text-slate-800">
                      {participant?.number ? `#${participant.number} ` : ''}{participant?.displayName ?? 'Unknown participant'}
                    </p>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                      <label className="block">
                        <span className="mb-1 block text-sm font-semibold text-slate-700">Position</span>
                        <input
                          value={change.position ?? ''}
                          maxLength={80}
                          onChange={event => updateRole(index, { position: event.target.value.trim() ? event.target.value : null })}
                          className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800"
                        />
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={change.captain}
                          onChange={event => updateRole(index, { captain: event.target.checked })}
                          className="h-5 w-5"
                        />
                        Captain
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </BasketballEditorSection>
        )}

        {(draft.eventType === 'basketball.equal_play_override' ||
          draft.eventType === 'basketball.lineup_confirmed' && draft.violationCodes) && (
          <BasketballEditorSection title="Equal-play authority">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-700">Violation codes</legend>
              <div className="space-y-2">
                {VIOLATION_OPTIONS.map(option => {
                  const values = draft.violationCodes ?? []
                  return (
                    <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={values.includes(option.value)}
                        onChange={() => update({
                          violationCodes: values.includes(option.value)
                            ? values.filter(value => value !== option.value)
                            : [...values, option.value],
                        })}
                        className="h-5 w-5"
                      />
                      {option.label}
                    </label>
                  )
                })}
              </div>
            </fieldset>
            {draft.eventType === 'basketball.equal_play_override' && (
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Override reason</span>
                <textarea
                  value={draft.reason}
                  onChange={event => update({ reason: event.target.value })}
                  maxLength={240}
                  rows={3}
                  className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
                />
              </label>
            )}
          </BasketballEditorSection>
        )}

        {error && <div className="px-4 pb-4"><BasketballEditorErrorMessage message={error} /></div>}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={onClose} className="btn-secondary min-h-11">Cancel</button>
        <button type="button" onClick={requestPreview} className="btn-primary flex min-h-11 items-center justify-center gap-2">
          <Pencil size={16} aria-hidden />
          Review
        </button>
      </footer>
    </BasketballEditorFrame>
  )

  function updateRole(index: number, changes: Partial<BasketballRoleChange>) {
    if (!draft || draft.eventType !== 'basketball.role_changed') return
    update({
      changes: draft.changes.map((change, candidateIndex) =>
        candidateIndex === index ? {
          participantId: change.participantId,
          position: changes.position === undefined ? change.position : changes.position,
          captain: changes.captain === undefined ? change.captain : changes.captain,
        } : change
      ),
    })
  }
}

function editorTitle(draft: BasketballLineupCorrectionDraft): string {
  switch (draft.eventType) {
    case 'basketball.substitution': return draft.mode === 'current_lineup_recovery'
      ? 'current lineup recovery'
      : 'substitution'
    case 'basketball.role_changed': return 'player roles'
    case 'basketball.equal_play_override': return 'equal-play override'
    case 'basketball.lineup_confirmed': return 'lineup confirmation'
  }
}

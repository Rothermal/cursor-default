import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { GameEventActor } from '../../lib/gameEvents/types'
import {
  recordSoccerShootoutCard,
  recordSoccerShootoutEligibility,
  recordSoccerShootoutGoalkeeperChange,
  type SoccerCaptureActorSelection,
  type SoccerCardSanction,
  type SoccerDisciplineReason,
  type SoccerLiveResult,
  type SoccerShootoutEligibilityChangeReason,
  type SoccerShootoutGoalkeeperChangeReason,
} from '../../lib/soccer'
import type { GameState } from '../../types'

export type SoccerShootoutManagementKind = 'card' | 'goalkeeper' | 'eligibility'

interface Props {
  kind: SoccerShootoutManagementKind
  state: GameState
  recorderUserId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onClose: () => void
}

const REASONS: Array<{ value: SoccerDisciplineReason; label: string }> = [
  { value: 'dissent', label: 'Dissent' },
  { value: 'unsporting_behavior', label: 'Unsporting behavior' },
  { value: 'delaying_restart', label: 'Delaying restart' },
  { value: 'violent_conduct', label: 'Violent conduct' },
  { value: 'abusive_language', label: 'Abusive language' },
  { value: 'second_caution', label: 'Second caution' },
  { value: 'other_not_recorded', label: 'Other' },
]

export default function SoccerShootoutManagementDialog(props: Props) {
  const title = props.kind === 'card' ? 'Shootout Card' : props.kind === 'goalkeeper' ? 'Change Goalkeeper' : 'Shootout Eligibility'
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={props.onClose}><div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-lg sm:rounded-lg" onClick={event => event.stopPropagation()}><header className="sticky top-0 z-10 flex min-h-14 items-center border-b border-slate-200 bg-white px-4"><h2 className="flex-1 font-bold text-slate-900">{title}</h2><button type="button" onClick={props.onClose} className="grid h-9 w-9 place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button></header><div className="p-4">{props.kind === 'card' ? <CardForm {...props} /> : props.kind === 'goalkeeper' ? <GoalkeeperForm {...props} /> : <EligibilityForm {...props} />}</div></div></div>
}

function CardForm({ state, recorderUserId, busy, onApply, onClose }: Props) {
  const projection = soccerProjection(state)
  const shootout = projection.shootout!
  const [side, setSide] = useState<'tracked' | 'opponent'>('tracked')
  const [recipientKind, setRecipientKind] = useState<'player' | 'staff'>('player')
  const [participantId, setParticipantId] = useState(shootout.trackedEligibleParticipantIds[0] ?? '')
  const [label, setLabel] = useState('Unknown opponent')
  const [sanction, setSanction] = useState<SoccerCardSanction>('yellow')
  const [reason, setReason] = useState<SoccerDisciplineReason>('unsporting_behavior')
  const [note, setNote] = useState('')
  const [excludeTrackedId, setExcludeTrackedId] = useState(shootout.trackedEligibleParticipantIds[0] ?? '')
  const [error, setError] = useState<string | null>(null)
  const red = sanction === 'straight_red' || sanction === 'second_yellow_red'
  const eligible = shootout.trackedEligibleParticipantIds.map(id => projection.participants[id]).filter(Boolean)

  const submit = () => {
    let recipient: GameEventActor
    if (recipientKind === 'staff') {
      if (!label.trim()) return setError('Enter the staff recipient.')
      recipient = { role: 'recipient', kind: 'staff', label: label.trim() }
    } else if (side === 'tracked') {
      const participant = projection.participants[participantId]
      if (!participant) return setError('Choose a tracked recipient.')
      recipient = participantActor('recipient', participant)
    } else {
      if (!label.trim()) return setError('Enter the opponent recipient or Unknown.')
      recipient = { role: 'recipient', kind: 'unknown', label: label.trim() }
    }

    let eligibility = null
    if (red && recipientKind === 'player') {
      if (shootout.opponentEligibleCount <= 1 || shootout.trackedEligibleParticipantIds.length <= 1) {
        return setError('The remaining eligibility cannot be equalized below one player per side.')
      }
      const removedId = side === 'tracked' ? participantId : excludeTrackedId
      if (!shootout.trackedEligibleParticipantIds.includes(removedId)) return setError('Choose the tracked player excluded for equalization.')
      eligibility = {
        reason: 'sent_off' as const,
        trackedEligibleParticipantIds: shootout.trackedEligibleParticipantIds.filter(id => id !== removedId),
        trackedExcludedParticipantIds: [...new Set([...shootout.trackedExcludedParticipantIds, removedId])],
        opponentEligibleCount: shootout.opponentEligibleCount - 1,
        actors: [participantActor('affected', projection.participants[removedId])],
      }
    }
    const result = recordSoccerShootoutCard(state, {
      teamSide: side,
      sanction,
      reason: sanction === 'second_yellow_red' ? 'second_caution' : reason,
      note,
      recipient,
      eligibility,
    }, { recorderUserId })
    finish(result, onApply, onClose, setError)
  }

  return <div className="space-y-4"><SideChoice side={side} onSide={value => { setSide(value); setLabel(value === 'tracked' ? 'Coach or staff' : 'Unknown opponent') }} /><Field label="Recipient type"><div className="grid grid-cols-2 rounded-md bg-slate-200 p-1"><Choice active={recipientKind === 'player'} label="Player" onClick={() => setRecipientKind('player')} /><Choice active={recipientKind === 'staff'} label="Staff" onClick={() => setRecipientKind('staff')} /></div></Field>{recipientKind === 'player' && side === 'tracked' ? <Field label="Recipient"><select value={participantId} onChange={event => setParticipantId(event.target.value)} className="input-field">{eligible.map(participant => <option key={participant.participantId} value={participant.participantId}>{participant.displayName}</option>)}</select></Field> : <Field label={recipientKind === 'staff' ? 'Staff name' : 'Opponent player'}><input value={label} onChange={event => setLabel(event.target.value)} className="input-field" /></Field>}<Field label="Sanction"><select value={sanction} onChange={event => setSanction(event.target.value as SoccerCardSanction)} className="input-field"><option value="yellow">Yellow</option><option value="straight_red">Straight red</option><option value="second_yellow_red">Second yellow + red</option></select></Field><Field label="Reason"><select value={sanction === 'second_yellow_red' ? 'second_caution' : reason} disabled={sanction === 'second_yellow_red'} onChange={event => setReason(event.target.value as SoccerDisciplineReason)} className="input-field">{REASONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>{red && recipientKind === 'player' && side === 'opponent' && <Field label="Tracked exclusion for equalization"><select value={excludeTrackedId} onChange={event => setExcludeTrackedId(event.target.value)} className="input-field">{eligible.map(participant => <option key={participant.participantId} value={participant.participantId}>{participant.displayName}</option>)}</select></Field>}<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Optional note" rows={2} className="input-field resize-none" />{error && <ErrorText>{error}</ErrorText>}<Submit busy={busy} label="Record Card" onClick={submit} /></div>
}

function GoalkeeperForm({ state, recorderUserId, busy, onApply, onClose }: Props) {
  const projection = soccerProjection(state)
  const shootout = projection.shootout!
  const [side, setSide] = useState<'tracked' | 'opponent'>('tracked')
  const [reason, setReason] = useState<SoccerShootoutGoalkeeperChangeReason>('tactical')
  const [incomingId, setIncomingId] = useState(shootout.trackedEligibleParticipantIds.find(id => `participant:${id}` !== shootout.currentGoalkeepers.tracked) ?? '')
  const [opponentLabel, setOpponentLabel] = useState('Opponent goalkeeper')
  const [error, setError] = useState<string | null>(null)
  const trackedCandidates = Object.values(projection.participants).filter(participant =>
    `participant:${participant.participantId}` !== shootout.currentGoalkeepers.tracked &&
    (shootout.trackedEligibleParticipantIds.includes(participant.participantId) ||
      (reason === 'unable_to_continue' && projection.currentRules.allowUnusedGoalkeeperShootoutReplacement))
  )

  const submit = () => {
    const outgoing = selectionFromKey(shootout.currentGoalkeepers[side])
    let incoming: SoccerCaptureActorSelection
    let eligibility = null
    if (side === 'tracked') {
      if (!incomingId) return setError('Choose the incoming tracked goalkeeper.')
      incoming = { kind: 'participant', participantId: incomingId }
      if (!shootout.trackedEligibleParticipantIds.includes(incomingId)) {
        if (reason !== 'unable_to_continue') return setError('Only an unable-to-continue change may add an unused participant.')
        const outgoingId = shootout.currentGoalkeepers.tracked.startsWith('participant:') ? shootout.currentGoalkeepers.tracked.slice(12) : null
        if (!outgoingId) return setError('The outgoing tracked goalkeeper cannot be resolved.')
        eligibility = {
          reason: 'goalkeeper_replacement' as const,
          trackedEligibleParticipantIds: shootout.trackedEligibleParticipantIds.map(id => id === outgoingId ? incomingId : id),
          trackedExcludedParticipantIds: [...new Set(shootout.trackedExcludedParticipantIds.filter(id => id !== incomingId).concat(outgoingId))],
          opponentEligibleCount: shootout.opponentEligibleCount,
        }
      }
    } else {
      if (!opponentLabel.trim()) return setError('Enter the incoming opponent goalkeeper.')
      incoming = { kind: 'unknown', label: opponentLabel.trim() }
    }
    const result = recordSoccerShootoutGoalkeeperChange(state, {
      teamSide: side,
      reason,
      goalkeeperOut: outgoing,
      goalkeeperIn: incoming,
      eligibility,
    }, { recorderUserId })
    finish(result, onApply, onClose, setError)
  }
  return <div className="space-y-4"><SideChoice side={side} onSide={setSide} /><Field label="Reason"><select value={reason} onChange={event => setReason(event.target.value as SoccerShootoutGoalkeeperChangeReason)} className="input-field"><option value="tactical">Tactical</option><option value="unable_to_continue">Unable to continue</option><option value="sent_off">Sent off</option></select></Field>{side === 'tracked' ? <Field label="Goalkeeper in"><select value={incomingId} onChange={event => setIncomingId(event.target.value)} className="input-field"><option value="">Select participant</option>{trackedCandidates.map(participant => <option key={participant.participantId} value={participant.participantId}>{participant.displayName}{shootout.trackedEligibleParticipantIds.includes(participant.participantId) ? '' : ' (unused substitute)'}</option>)}</select></Field> : <Field label="Goalkeeper in"><input value={opponentLabel} onChange={event => setOpponentLabel(event.target.value)} className="input-field" /></Field>}{error && <ErrorText>{error}</ErrorText>}<Submit busy={busy} label="Change Goalkeeper" onClick={submit} /></div>
}

function EligibilityForm({ state, recorderUserId, busy, onApply, onClose }: Props) {
  const projection = soccerProjection(state)
  const shootout = projection.shootout!
  const accountedIds = [...new Set([...shootout.trackedEligibleParticipantIds, ...shootout.trackedExcludedParticipantIds])]
  const [eligibleIds, setEligibleIds] = useState([...shootout.trackedEligibleParticipantIds])
  const [opponentCount, setOpponentCount] = useState(shootout.opponentEligibleCount)
  const [reason, setReason] = useState<SoccerShootoutEligibilityChangeReason>('equalization')
  const [error, setError] = useState<string | null>(null)
  const valid = eligibleIds.length === opponentCount && opponentCount > 0
  const submit = () => {
    if (!valid) return setError('Tracked and opponent eligible counts must match.')
    const result = recordSoccerShootoutEligibility(state, {
      reason,
      trackedEligibleParticipantIds: eligibleIds,
      trackedExcludedParticipantIds: accountedIds.filter(id => !eligibleIds.includes(id)),
      opponentEligibleCount: opponentCount,
    }, { recorderUserId })
    finish(result, onApply, onClose, setError)
  }
  return <div className="space-y-4"><Field label="Reason"><select value={reason} onChange={event => setReason(event.target.value as SoccerShootoutEligibilityChangeReason)} className="input-field"><option value="equalization">Equalization</option><option value="sent_off">Sent off</option><option value="unable_to_continue">Unable to continue</option><option value="goalkeeper_replacement">Goalkeeper replacement</option></select></Field><Field label="Opponent eligible"><input type="number" min="1" max={accountedIds.length} value={opponentCount} onChange={event => setOpponentCount(Math.max(1, Number(event.target.value) || 1))} className="input-field" /></Field><Field label={`Tracked eligible (${eligibleIds.length}/${opponentCount})`}><div className="divide-y divide-slate-200 border-y border-slate-200">{accountedIds.map(id => { const participant = projection.participants[id]; return <label key={id} className="flex min-h-11 items-center gap-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={eligibleIds.includes(id)} onChange={() => setEligibleIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} className="h-5 w-5 accent-emerald-700" /><span>{participant?.displayName ?? id}</span></label> })}</div></Field>{error && <ErrorText>{error}</ErrorText>}<Submit busy={busy || !valid} label="Save Eligibility" onClick={submit} /></div>
}

function soccerProjection(state: GameState) { if (state.sportGameState?.sportId !== 'soccer' || !state.sportGameState.projection.shootout) throw new Error('Shootout unavailable'); return state.sportGameState.projection }
function SideChoice({ side, onSide }: { side: 'tracked' | 'opponent'; onSide: (side: 'tracked' | 'opponent') => void }) { return <Field label="Side"><div className="grid grid-cols-2 rounded-md bg-slate-200 p-1"><Choice active={side === 'tracked'} label="Tracked" onClick={() => onSide('tracked')} /><Choice active={side === 'opponent'} label="Opponent" onClick={() => onSide('opponent')} /></div></Field> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <section><h3 className="mb-2 text-xs font-bold uppercase text-slate-500">{label}</h3>{children}</section> }
function Choice({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`h-9 rounded text-xs font-bold ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{label}</button> }
function Submit({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) { return <button type="button" disabled={busy} onClick={onClick} className="min-h-12 w-full rounded-md bg-emerald-700 text-sm font-bold text-white disabled:opacity-40">{label}</button> }
function ErrorText({ children }: { children: ReactNode }) { return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p> }
function participantActor(role: string, participant: ReturnType<typeof soccerProjection>['participants'][string]): GameEventActor { return participant.playerId ? { role, kind: 'player', participantId: participant.participantId, playerId: participant.playerId, label: participant.displayName } : { role, kind: 'unknown', participantId: participant.participantId, label: participant.displayName } }
function selectionFromKey(key: string): SoccerCaptureActorSelection { if (key.startsWith('participant:')) return { kind: 'participant', participantId: key.slice(12) }; const split = key.indexOf(':'); return { kind: 'unknown', label: split >= 0 ? key.slice(split + 1) : 'Unknown' } }
function finish(result: SoccerLiveResult, onApply: (result: SoccerLiveResult) => boolean, onClose: () => void, setError: (message: string | null) => void) { if (!result.ok) return setError(result.message); if (onApply(result)) onClose() }

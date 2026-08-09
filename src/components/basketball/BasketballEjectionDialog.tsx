import { useEffect, useMemo, useState } from 'react'
import { UserX, X } from 'lucide-react'
import type {
  BasketballEjectionFoulCandidate,
  BasketballEjectionSubject,
  BasketballOfficialEjectionOptions,
} from '../../lib/basketball/ejectionCommands'
import type { BasketballTeamSide } from '../../lib/basketball/types'

export interface BasketballEjectionCandidate {
  playerId: string
  teamSide: BasketballTeamSide
  label: string
}

export type BasketballEjectionDialogInput = Pick<
  BasketballOfficialEjectionOptions,
  'teamSide' | 'subject' | 'reason' | 'relatedFoulEventId'
>

interface BasketballEjectionDialogProps {
  trackedTeamName: string
  opponentName: string
  candidates: BasketballEjectionCandidate[]
  foulCandidates: BasketballEjectionFoulCandidate[]
  defaultSide: BasketballTeamSide
  defaultPlayerId?: string | null
  errorMessage?: string | null
  onSubmit: (input: BasketballEjectionDialogInput) => void
  onClose: () => void
}

export default function BasketballEjectionDialog({
  trackedTeamName,
  opponentName,
  candidates,
  foulCandidates,
  defaultSide,
  defaultPlayerId = null,
  errorMessage,
  onSubmit,
  onClose,
}: BasketballEjectionDialogProps) {
  const defaultPlayer = candidates.find(candidate =>
    candidate.playerId === defaultPlayerId && candidate.teamSide === defaultSide
  )
  const [teamSide, setTeamSide] = useState<BasketballTeamSide>(defaultSide)
  const [subjectSelection, setSubjectSelection] = useState(
    defaultPlayer ? `player:${defaultPlayer.playerId}` : 'staff'
  )
  const [staffLabel, setStaffLabel] = useState('')
  const [reason, setReason] = useState('')
  const [relatedFoulEventId, setRelatedFoulEventId] = useState('')

  const sideCandidates = useMemo(
    () => candidates.filter(candidate => candidate.teamSide === teamSide),
    [candidates, teamSide]
  )
  const selectedSubject = useMemo<BasketballEjectionSubject | null>(
    () => subjectSelection === 'staff'
      ? staffLabel.trim() ? { kind: 'staff', label: staffLabel.trim() } : null
      : { kind: 'player', playerId: subjectSelection.slice('player:'.length) },
    [staffLabel, subjectSelection]
  )
  const matchingFouls = useMemo(() => {
    if (!selectedSubject) return []
    return foulCandidates.filter(candidate =>
      candidate.teamSide === teamSide && subjectsMatch(candidate.subject, selectedSubject)
    )
  }, [foulCandidates, selectedSubject, teamSide])

  useEffect(() => {
    if (!matchingFouls.some(candidate => candidate.eventId === relatedFoulEventId)) {
      setRelatedFoulEventId('')
    }
  }, [matchingFouls, relatedFoulEventId])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const chooseSide = (side: BasketballTeamSide) => {
    setTeamSide(side)
    const playerId = subjectSelection.startsWith('player:')
      ? subjectSelection.slice('player:'.length)
      : null
    if (!candidates.some(candidate => candidate.playerId === playerId && candidate.teamSide === side)) {
      setSubjectSelection('staff')
    }
    setRelatedFoulEventId('')
  }

  const valid = Boolean(selectedSubject && reason.trim())
  const submit = () => {
    if (!selectedSubject || !reason.trim()) return
    onSubmit({
      teamSide,
      subject: selectedSubject,
      reason: reason.trim(),
      relatedFoulEventId: relatedFoulEventId || null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 pt-12 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-ejection-title"
        className="max-h-[calc(100dvh-3.75rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-ejection-title" className="text-base font-bold text-slate-800">Official ejection</h2>
            <p className="text-xs text-slate-500">Record the official ruling separately from foul-limit disqualification.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500" aria-label="Close ejection sheet">
            <X size={18} aria-hidden />
          </button>
        </header>

        <form className="space-y-4 px-4 py-4" onSubmit={event => { event.preventDefault(); submit() }}>
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="group" aria-label="Ejected side">
            {([['tracked', trackedTeamName], ['opponent', opponentName]] as const).map(([side, name]) => (
              <button key={side} type="button" onClick={() => chooseSide(side)} aria-pressed={teamSide === side} className={`min-h-11 rounded-md px-2 py-1 text-sm font-semibold ${teamSide === side ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
                <span className="line-clamp-2 break-words">{name}</span>
              </button>
            ))}
          </div>

          <label className="block text-sm font-semibold text-slate-700">
            Ejected person
            <select value={subjectSelection} onChange={event => setSubjectSelection(event.target.value)} className="input-field mt-1">
              {sideCandidates.map(candidate => <option key={candidate.playerId} value={`player:${candidate.playerId}`}>{candidate.label}</option>)}
              <option value="staff">Coach or staff</option>
            </select>
          </label>

          {subjectSelection === 'staff' && (
            <label className="block text-sm font-semibold text-slate-700">
              Staff label
              <input autoFocus value={staffLabel} onChange={event => setStaffLabel(event.target.value)} className="input-field mt-1" maxLength={80} placeholder="Coach or staff name" />
            </label>
          )}

          <label className="block text-sm font-semibold text-slate-700">
            Reason
            <textarea autoFocus={subjectSelection !== 'staff'} value={reason} onChange={event => setReason(event.target.value)} className="input-field mt-1 min-h-20 resize-y" maxLength={240} placeholder="Official ruling" />
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Related foul <span className="font-normal text-slate-500">(optional)</span>
            <select value={relatedFoulEventId} onChange={event => setRelatedFoulEventId(event.target.value)} className="input-field mt-1" disabled={matchingFouls.length === 0}>
              <option value="">No foul link</option>
              {matchingFouls.map(candidate => <option key={candidate.eventId} value={candidate.eventId}>{candidate.label}</option>)}
            </select>
          </label>

          {errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{errorMessage}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={!valid} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40">
              <UserX size={16} aria-hidden />
              Record ejection
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function subjectsMatch(left: BasketballEjectionSubject, right: BasketballEjectionSubject): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'player' && right.kind === 'player') return left.playerId === right.playerId
  return left.kind === 'staff' && right.kind === 'staff' &&
    left.label.trim().toLocaleLowerCase() === right.label.trim().toLocaleLowerCase()
}

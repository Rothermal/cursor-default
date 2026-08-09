import { useEffect, useMemo, useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import type {
  BasketballFoulCaptureOptions,
  BasketballFoulDrawnBy,
  BasketballFoulOffender,
  BasketballFreeThrowAward,
} from '../../lib/basketball/foulFreeThrowCommands'
import type {
  BasketballFoulClass,
  BasketballFoulContext,
  BasketballFoulCountingOverride,
  BasketballTeamSide,
} from '../../lib/basketball/types'

export interface BasketballFoulCandidate {
  playerId: string
  teamSide: BasketballTeamSide
  label: string
}

export type BasketballFoulDialogInput = Pick<
  BasketballFoulCaptureOptions,
  | 'teamSide'
  | 'offender'
  | 'class'
  | 'context'
  | 'teamControlSide'
  | 'drawnBy'
  | 'countingOverride'
  | 'freeThrows'
>

interface BasketballFoulDialogProps {
  trackedTeamName: string
  opponentName: string
  candidates: BasketballFoulCandidate[]
  defaultSide: BasketballTeamSide
  defaultPlayerId?: string | null
  defaultClass?: BasketballFoulClass
  defaultContext?: BasketballFoulContext
  errorMessage?: string | null
  onSubmit: (input: BasketballFoulDialogInput) => void
  onClose: () => void
}

const FOUL_CLASSES: Array<{ value: BasketballFoulClass; label: string }> = [
  { value: 'personal', label: 'Personal' },
  { value: 'technical', label: 'Technical' },
  { value: 'flagrant', label: 'Flagrant' },
  { value: 'intentional', label: 'Intentional' },
  { value: 'double', label: 'Double' },
]

const FOUL_CONTEXTS: Array<{ value: BasketballFoulContext; label: string }> = [
  { value: 'common', label: 'Common' },
  { value: 'shooting', label: 'Shooting' },
  { value: 'offensive', label: 'Offensive' },
  { value: 'loose_ball', label: 'Loose ball' },
  { value: 'away_from_play', label: 'Away from play' },
  { value: 'administrative', label: 'Administrative' },
]

type AwardSelection = 'none' | 'one' | 'two' | 'three' | 'one_and_one'

export default function BasketballFoulDialog({
  trackedTeamName,
  opponentName,
  candidates,
  defaultSide,
  defaultPlayerId = null,
  defaultClass = 'personal',
  defaultContext = 'common',
  errorMessage,
  onSubmit,
  onClose,
}: BasketballFoulDialogProps) {
  const defaultPlayer = candidates.find(candidate =>
    candidate.playerId === defaultPlayerId && candidate.teamSide === defaultSide
  )
  const [teamSide, setTeamSide] = useState<BasketballTeamSide>(defaultSide)
  const [offenderSelection, setOffenderSelection] = useState(
    defaultPlayer ? `player:${defaultPlayer.playerId}` : 'team'
  )
  const [staffLabel, setStaffLabel] = useState('')
  const [foulClass, setFoulClass] = useState<BasketballFoulClass>(defaultClass)
  const [context, setContext] = useState<BasketballFoulContext>(defaultContext)
  const [drawnBySelection, setDrawnBySelection] = useState('none')
  const [unknownDrawnByLabel, setUnknownDrawnByLabel] = useState('Unknown player')
  const [teamControlSide, setTeamControlSide] = useState<'none' | BasketballTeamSide>('none')
  const [awardSelection, setAwardSelection] = useState<AwardSelection>('none')
  const [possessionRetained, setPossessionRetained] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [personalFoul, setPersonalFoul] = useState(defaultPlayer !== undefined)
  const [teamFoul, setTeamFoul] = useState(true)
  const [technical, setTechnical] = useState(defaultClass === 'technical')
  const [overrideReason, setOverrideReason] = useState('')

  const sideCandidates = useMemo(
    () => candidates.filter(candidate => candidate.teamSide === teamSide),
    [candidates, teamSide]
  )
  const oppositeSide: BasketballTeamSide = teamSide === 'tracked' ? 'opponent' : 'tracked'
  const drawnByCandidates = useMemo(
    () => candidates.filter(candidate => candidate.teamSide === oppositeSide),
    [candidates, oppositeSide]
  )
  const committingTeamName = teamSide === 'tracked' ? trackedTeamName : opponentName
  const drawnByTeamName = oppositeSide === 'tracked' ? trackedTeamName : opponentName

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const chooseSide = (side: BasketballTeamSide) => {
    setTeamSide(side)
    const selectedPlayerId = offenderSelection.startsWith('player:')
      ? offenderSelection.slice('player:'.length)
      : null
    if (!candidates.some(candidate => candidate.playerId === selectedPlayerId && candidate.teamSide === side)) {
      setOffenderSelection('team')
    }
    setDrawnBySelection('none')
    setTeamControlSide('none')
  }

  const derivedTechnical = advanced ? technical : foulClass === 'technical'
  const valid = offenderSelection !== 'staff' || staffLabel.trim().length > 0
  const drawnByValid = drawnBySelection !== 'unknown' || unknownDrawnByLabel.trim().length > 0
  const overrideValid = !advanced || overrideReason.trim().length > 0

  const submit = () => {
    if (!valid || !drawnByValid || !overrideValid) return
    let offender: BasketballFoulOffender
    if (offenderSelection === 'team') offender = { kind: 'team' }
    else if (offenderSelection === 'staff') offender = { kind: 'staff', label: staffLabel.trim() }
    else offender = { kind: 'player', playerId: offenderSelection.slice('player:'.length) }

    let drawnBy: BasketballFoulDrawnBy | null = null
    if (drawnBySelection === 'unknown') {
      drawnBy = { kind: 'unknown', label: unknownDrawnByLabel.trim() }
    } else if (drawnBySelection.startsWith('player:')) {
      drawnBy = { kind: 'player', playerId: drawnBySelection.slice('player:'.length) }
    }

    const countingOverride: BasketballFoulCountingOverride | null = advanced
      ? {
          personalFoul,
          teamFoul,
          technical,
          reason: overrideReason.trim(),
        }
      : null
    let freeThrows: BasketballFreeThrowAward | null = null
    if (awardSelection !== 'none') {
      freeThrows = {
        maximumAttempts: awardSelection === 'one' ? 1 : awardSelection === 'three' ? 3 : 2,
        oneAndOne: awardSelection === 'one_and_one',
        technical: derivedTechnical,
        possessionRetained,
      }
    }

    onSubmit({
      teamSide,
      offender,
      class: foulClass,
      context,
      teamControlSide: context === 'offensive'
        ? teamSide
        : teamControlSide === 'none' ? null : teamControlSide,
      drawnBy,
      countingOverride,
      freeThrows,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 pt-12 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-foul-title"
        className="max-h-[calc(100dvh-3.75rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-foul-title" className="text-base font-bold text-slate-800">Record foul</h2>
            <p className="truncate text-xs text-slate-500">{committingTeamName}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500" aria-label="Close foul sheet">
            <X size={18} aria-hidden />
          </button>
        </header>

        <form className="space-y-4 px-4 py-4" onSubmit={event => { event.preventDefault(); submit() }}>
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="group" aria-label="Committing team">
            {([['tracked', trackedTeamName], ['opponent', opponentName]] as const).map(([side, name]) => (
              <button key={side} type="button" onClick={() => chooseSide(side)} aria-pressed={teamSide === side} className={`min-h-11 rounded-md px-2 py-1 text-sm font-semibold ${teamSide === side ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
                <span className="line-clamp-2 break-words">{name}</span>
              </button>
            ))}
          </div>

          <label className="block text-sm font-semibold text-slate-700">
            Foul charged to
            <select value={offenderSelection} onChange={event => setOffenderSelection(event.target.value)} className="input-field mt-1">
              <option value="team">{committingTeamName} team</option>
              {sideCandidates.map(candidate => <option key={candidate.playerId} value={`player:${candidate.playerId}`}>{candidate.label}</option>)}
              <option value="staff">Coach or staff</option>
            </select>
          </label>

          {offenderSelection === 'staff' && (
            <label className="block text-sm font-semibold text-slate-700">
              Staff label
              <input autoFocus value={staffLabel} onChange={event => setStaffLabel(event.target.value)} className="input-field mt-1" maxLength={80} placeholder="Coach or staff name" />
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-slate-700">
              Class
              <select value={foulClass} onChange={event => setFoulClass(event.target.value as BasketballFoulClass)} className="input-field mt-1">
                {FOUL_CLASSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Context
              <select value={context} onChange={event => setContext(event.target.value as BasketballFoulContext)} className="input-field mt-1">
                {FOUL_CONTEXTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <label className="block text-sm font-semibold text-slate-700">
            Drawn by
            <select value={drawnBySelection} onChange={event => setDrawnBySelection(event.target.value)} className="input-field mt-1">
              <option value="none">Not recorded</option>
              {drawnByCandidates.map(candidate => <option key={candidate.playerId} value={`player:${candidate.playerId}`}>{candidate.label}</option>)}
              <option value="unknown">Unknown {drawnByTeamName} player</option>
            </select>
          </label>

          {drawnBySelection === 'unknown' && (
            <label className="block text-sm font-semibold text-slate-700">
              Drawn-by label
              <input value={unknownDrawnByLabel} onChange={event => setUnknownDrawnByLabel(event.target.value)} className="input-field mt-1" maxLength={80} />
            </label>
          )}

          {context !== 'offensive' && (
            <label className="block text-sm font-semibold text-slate-700">
              Team control
              <select value={teamControlSide} onChange={event => setTeamControlSide(event.target.value as 'none' | BasketballTeamSide)} className="input-field mt-1">
                <option value="none">Not recorded</option>
                <option value="tracked">{trackedTeamName}</option>
                <option value="opponent">{opponentName}</option>
              </select>
            </label>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <label className="block text-sm font-semibold text-slate-700">
              Awarded free throws
              <select value={awardSelection} onChange={event => setAwardSelection(event.target.value as AwardSelection)} className="input-field mt-1">
                <option value="none">None</option>
                <option value="one">1 shot</option>
                <option value="two">2 shots</option>
                <option value="three">3 shots</option>
                <option value="one_and_one">One-and-one</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={possessionRetained} onChange={event => setPossessionRetained(event.target.checked)} disabled={awardSelection === 'none'} />
              Retain ball
            </label>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={advanced}
                onChange={event => {
                  const checked = event.target.checked
                  if (checked) {
                    setPersonalFoul(offenderSelection.startsWith('player:'))
                    setTeamFoul(true)
                    setTechnical(foulClass === 'technical')
                  }
                  setAdvanced(checked)
                }}
              />
              Advanced counting override
            </label>
            {advanced && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-slate-700">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={personalFoul} onChange={event => setPersonalFoul(event.target.checked)} /> Personal</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={teamFoul} onChange={event => setTeamFoul(event.target.checked)} /> Team</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={technical} onChange={event => setTechnical(event.target.checked)} /> Technical</label>
                </div>
                <label className="block text-sm font-semibold text-slate-700">
                  Override reason
                  <input value={overrideReason} onChange={event => setOverrideReason(event.target.value)} className="input-field mt-1" maxLength={160} placeholder="Official ruling" />
                </label>
              </div>
            )}
          </div>

          {errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{errorMessage}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={!valid || !drawnByValid || !overrideValid} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40">
              <ShieldAlert size={16} aria-hidden />
              Record foul
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

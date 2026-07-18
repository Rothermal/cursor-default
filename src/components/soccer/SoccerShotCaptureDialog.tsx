import { MapPin, MapPinOff, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { GameEventLocation, GameEventTeamSide } from '../../lib/gameEvents/types'
import {
  recordSoccerOwnGoal,
  recordSoccerShot,
  type SoccerCaptureActorSelection,
  type SoccerLiveResult,
  type SoccerShotOutcome,
  type SoccerShotSituation,
} from '../../lib/soccer'
import type { GameState } from '../../types'

export interface SoccerCaptureDraft {
  teamSide: GameEventTeamSide
  location: GameEventLocation | null
  outcome?: SoccerShotOutcome
  preferTeamAttribution?: boolean
}

interface SoccerShotCaptureDialogProps {
  draft: SoccerCaptureDraft | null
  state: GameState
  recorderUserId: string | null
  selectedParticipantId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onTrackedParticipantUsed: (participantId: string) => void
  onClose: () => void
}

const OUTCOMES: Array<{ value: SoccerShotOutcome; label: string }> = [
  { value: 'goal', label: 'Goal' },
  { value: 'saved', label: 'Saved' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'off_target', label: 'Off target' },
  { value: 'woodwork', label: 'Woodwork' },
]

const SITUATIONS: Array<{ value: SoccerShotSituation; label: string }> = [
  { value: 'open_play', label: 'Open play' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'direct_free_kick', label: 'Direct free kick' },
  { value: 'corner_sequence', label: 'Corner sequence' },
  { value: 'other_set_piece', label: 'Other set piece' },
]

export default function SoccerShotCaptureDialog({
  draft,
  state,
  recorderUserId,
  selectedParticipantId,
  busy,
  onApply,
  onTrackedParticipantUsed,
  onClose,
}: SoccerShotCaptureDialogProps) {
  const projection = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState.projection
    : null
  const onField = useMemo(
    () => projection
      ? Object.values(projection.participants).filter(participant => participant.status === 'on_field')
      : [],
    [projection]
  )
  const recentOpponentLabels = useMemo(() => opponentLabels(state), [state])
  const goalkeeper = onField.find(participant => participant.role.group === 'goalkeeper') ?? null
  const [outcome, setOutcome] = useState<SoccerShotOutcome | null>(null)
  const [situation, setSituation] = useState<SoccerShotSituation>('open_play')
  const [ownGoal, setOwnGoal] = useState(false)
  const [location, setLocation] = useState<GameEventLocation | null>(null)
  const [trackedShooterId, setTrackedShooterId] = useState('__team__')
  const [opponentShooterMode, setOpponentShooterMode] = useState<'unknown' | 'team'>('unknown')
  const [opponentShooterLabel, setOpponentShooterLabel] = useState('Unknown opponent')
  const [primaryCreatorId, setPrimaryCreatorId] = useState('')
  const [secondaryCreatorId, setSecondaryCreatorId] = useState('')
  const [opponentCreatorLabel, setOpponentCreatorLabel] = useState('')
  const [opponentSecondaryLabel, setOpponentSecondaryLabel] = useState('')
  const [showSecondary, setShowSecondary] = useState(false)
  const [trackedBlockerId, setTrackedBlockerId] = useState('__team__')
  const [opponentBlockerLabel, setOpponentBlockerLabel] = useState('')
  const [opponentGoalkeeperLabel, setOpponentGoalkeeperLabel] = useState('')
  const [ownGoalParticipantId, setOwnGoalParticipantId] = useState('')
  const [opponentOwnGoalLabel, setOpponentOwnGoalLabel] = useState('Unknown opponent')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draft) return
    const selectedIsOnField = onField.some(participant => participant.participantId === selectedParticipantId)
    const defaultParticipantId = selectedIsOnField
      ? selectedParticipantId ?? ''
      : onField.find(participant => participant.role.group !== 'goalkeeper')?.participantId ?? onField[0]?.participantId ?? ''
    setOutcome(draft.outcome ?? null)
    setSituation('open_play')
    setOwnGoal(false)
    setLocation(draft.location)
    setTrackedShooterId(draft.preferTeamAttribution ? '__team__' : defaultParticipantId || '__team__')
    setOpponentShooterMode('unknown')
    setOpponentShooterLabel('Unknown opponent')
    setPrimaryCreatorId('')
    setSecondaryCreatorId('')
    setOpponentCreatorLabel('')
    setOpponentSecondaryLabel('')
    setShowSecondary(false)
    setTrackedBlockerId('__team__')
    setOpponentBlockerLabel('')
    setOpponentGoalkeeperLabel('')
    setOwnGoalParticipantId(defaultParticipantId)
    setOpponentOwnGoalLabel('Unknown opponent')
    setError(null)
  }, [draft, onField, selectedParticipantId])

  if (!draft || !projection) return null

  const creatorsAllowed = !ownGoal && situation !== 'penalty' && situation !== 'direct_free_kick'
  const ownGoalNeedsGoalkeeper = ownGoal && draft.teamSide === 'opponent'
  const saveDisabled = busy || outcome === null || (
    ownGoal && draft.teamSide === 'opponent' && !ownGoalParticipantId
  ) || (ownGoalNeedsGoalkeeper && !goalkeeper)

  const save = () => {
    if (!outcome) return
    const options = { recorderUserId }
    let result: SoccerLiveResult
    if (ownGoal) {
      const ownGoalBy: SoccerCaptureActorSelection = draft.teamSide === 'opponent'
        ? { kind: 'participant', participantId: ownGoalParticipantId }
        : { kind: 'unknown', label: opponentOwnGoalLabel || 'Unknown opponent' }
      result = recordSoccerOwnGoal(state, {
        teamSide: draft.teamSide,
        location,
        ownGoalBy,
        goalkeeper: draft.teamSide === 'opponent' && goalkeeper
          ? { kind: 'participant', participantId: goalkeeper.participantId }
          : null,
      }, options)
    } else {
      const shooter: SoccerCaptureActorSelection = draft.teamSide === 'tracked'
        ? trackedShooterId === '__team__'
          ? { kind: 'team', label: state.gameInfo?.teamName ?? 'Tracked team' }
          : { kind: 'participant', participantId: trackedShooterId }
        : opponentShooterMode === 'team'
          ? { kind: 'team', label: state.gameInfo?.opponentName ?? 'Opponent' }
          : { kind: 'unknown', label: opponentShooterLabel || 'Unknown opponent' }
      const goalkeeperSelection = draft.teamSide === 'opponent'
        ? goalkeeper && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty')
          ? { kind: 'participant' as const, participantId: goalkeeper.participantId }
          : null
        : opponentGoalkeeperLabel.trim() && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty')
          ? { kind: 'unknown' as const, label: opponentGoalkeeperLabel }
          : null
      result = recordSoccerShot(state, {
        teamSide: draft.teamSide,
        outcome,
        situation,
        location,
        shooter,
        primaryCreator: creatorsAllowed
          ? draft.teamSide === 'tracked'
            ? primaryCreatorId ? { kind: 'participant', participantId: primaryCreatorId } : null
            : opponentCreatorLabel.trim() ? { kind: 'unknown', label: opponentCreatorLabel } : null
          : null,
        secondaryCreator: creatorsAllowed && outcome === 'goal' && showSecondary
          ? draft.teamSide === 'tracked'
            ? secondaryCreatorId ? { kind: 'participant', participantId: secondaryCreatorId } : null
            : opponentSecondaryLabel.trim() ? { kind: 'unknown', label: opponentSecondaryLabel } : null
          : null,
        goalkeeper: goalkeeperSelection,
        blocker: outcome === 'blocked'
          ? draft.teamSide === 'opponent'
            ? trackedBlockerId === '__team__'
              ? { kind: 'team', label: state.gameInfo?.teamName ?? 'Tracked team' }
              : trackedBlockerId === '__unknown__'
                ? { kind: 'unknown', label: 'Unknown tracked blocker' }
                : { kind: 'participant', participantId: trackedBlockerId }
            : opponentBlockerLabel.trim()
              ? { kind: 'unknown', label: opponentBlockerLabel }
              : null
          : null,
      }, options)
    }

    if (!result.ok) {
      setError(result.message)
      onApply(result)
      return
    }
    if (!onApply(result)) return
    if (!ownGoal && draft.teamSide === 'tracked' && trackedShooterId !== '__team__') {
      onTrackedParticipantUsed(trackedShooterId)
    }
    onClose()
  }

  const captureDirection = draft.teamSide === 'tracked'
    ? projection.attackingDirection
    : oppositeDirection(projection.attackingDirection)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-capture-title"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-lg sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="min-w-0 flex-1">
            <h2 id="soccer-capture-title" className="font-bold text-slate-900">{draft.teamSide === 'tracked' ? state.gameInfo?.teamName : state.gameInfo?.opponentName}</h2>
            <p className="text-xs text-slate-500">{location ? `${Math.round(location.x * 100)}, ${Math.round(location.y * 100)}` : 'Location unknown'}</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button>
        </header>

        <div className="space-y-5 p-4">
          <FieldGroup label="Outcome">
            <div className="grid grid-cols-3 gap-2">
              {OUTCOMES.map(option => (
                <ChoiceButton
                  key={option.value}
                  active={outcome === option.value}
                  label={option.label}
                  onClick={() => {
                    setOutcome(option.value)
                    if (option.value !== 'goal') setOwnGoal(false)
                  }}
                />
              ))}
            </div>
          </FieldGroup>

          {outcome === 'goal' && (
            <label className="flex min-h-11 items-center justify-between border-y border-slate-200 py-2 text-sm font-semibold text-slate-700">
              Own goal
              <input type="checkbox" checked={ownGoal} onChange={event => setOwnGoal(event.target.checked)} className="h-5 w-5 accent-emerald-700" />
            </label>
          )}

          {!ownGoal && (
            <FieldGroup label="Shooter">
              {draft.teamSide === 'tracked' ? (
                <select value={trackedShooterId} onChange={event => setTrackedShooterId(event.target.value)} className="input-field">
                  {onField.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
                  <option value="__team__">Team - unattributed</option>
                </select>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1">
                    <ChoiceButton active={opponentShooterMode === 'unknown'} label="Player / unknown" onClick={() => setOpponentShooterMode('unknown')} compact />
                    <ChoiceButton active={opponentShooterMode === 'team'} label="Team" onClick={() => setOpponentShooterMode('team')} compact />
                  </div>
                  {opponentShooterMode === 'unknown' && <OpponentInput value={opponentShooterLabel} onChange={setOpponentShooterLabel} recent={recentOpponentLabels} placeholder="Opponent player" />}
                </div>
              )}
            </FieldGroup>
          )}

          {ownGoal ? (
            <FieldGroup label="Own goal by">
              {draft.teamSide === 'opponent' ? (
                <select value={ownGoalParticipantId} onChange={event => setOwnGoalParticipantId(event.target.value)} className="input-field">
                  {onField.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
                </select>
              ) : (
                <OpponentInput value={opponentOwnGoalLabel} onChange={setOpponentOwnGoalLabel} recent={recentOpponentLabels} placeholder="Opponent player" />
              )}
            </FieldGroup>
          ) : (
            <FieldGroup label="Situation">
              <select
                value={situation}
                onChange={event => {
                  const next = event.target.value as SoccerShotSituation
                  setSituation(next)
                  if (next === 'penalty' && location === null) setLocation(penaltyMark(captureDirection))
                  if (next === 'penalty' || next === 'direct_free_kick') {
                    setPrimaryCreatorId('')
                    setSecondaryCreatorId('')
                    setOpponentCreatorLabel('')
                    setOpponentSecondaryLabel('')
                  }
                }}
                className="input-field"
              >
                {SITUATIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FieldGroup>
          )}

          {ownGoalNeedsGoalkeeper && !goalkeeper && (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              An on-field tracked goalkeeper is required for this own goal.
            </p>
          )}

          {!ownGoal && creatorsAllowed && (
            <FieldGroup label={outcome === 'goal' ? 'Primary assist' : 'Creator'}>
              {draft.teamSide === 'tracked' ? (
                <select value={primaryCreatorId} onChange={event => { setPrimaryCreatorId(event.target.value); if (event.target.value === secondaryCreatorId) setSecondaryCreatorId('') }} className="input-field">
                  <option value="">None</option>
                  {onField.filter(participant => participant.participantId !== trackedShooterId).map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
                </select>
              ) : (
                <OpponentInput value={opponentCreatorLabel} onChange={setOpponentCreatorLabel} recent={recentOpponentLabels} placeholder="None" />
              )}
              {outcome === 'goal' && !showSecondary && (
                <button type="button" onClick={() => setShowSecondary(true)} className="mt-2 min-h-9 text-xs font-bold text-emerald-700 flex items-center gap-1"><Plus size={15} /> Secondary assist</button>
              )}
              {outcome === 'goal' && showSecondary && (
                <div className="mt-2">
                  {draft.teamSide === 'tracked' ? (
                    <select value={secondaryCreatorId} onChange={event => setSecondaryCreatorId(event.target.value)} className="input-field">
                      <option value="">No secondary assist</option>
                      {onField.filter(participant => participant.participantId !== trackedShooterId && participant.participantId !== primaryCreatorId).map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
                    </select>
                  ) : (
                    <OpponentInput value={opponentSecondaryLabel} onChange={setOpponentSecondaryLabel} recent={recentOpponentLabels} placeholder="No secondary assist" />
                  )}
                </div>
              )}
            </FieldGroup>
          )}

          {!ownGoal && outcome === 'blocked' && (
            <FieldGroup label="Blocked by">
              {draft.teamSide === 'opponent' ? (
                <select value={trackedBlockerId} onChange={event => setTrackedBlockerId(event.target.value)} className="input-field">
                  <option value="__team__">Team</option>
                  {onField.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
                  <option value="__unknown__">Unknown</option>
                </select>
              ) : (
                <OpponentInput value={opponentBlockerLabel} onChange={setOpponentBlockerLabel} recent={recentOpponentLabels} placeholder="Opponent blocker (optional)" />
              )}
            </FieldGroup>
          )}

          {!ownGoal && draft.teamSide === 'tracked' && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty') && (
            <FieldGroup label="Opponent goalkeeper">
              <OpponentInput value={opponentGoalkeeperLabel} onChange={setOpponentGoalkeeperLabel} recent={recentOpponentLabels} placeholder="Optional label" />
            </FieldGroup>
          )}

          {(situation === 'penalty' || location !== null) && (
            <div className="grid grid-cols-2 gap-2">
              {situation === 'penalty' && <button type="button" onClick={() => setLocation(penaltyMark(captureDirection))} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 flex items-center justify-center gap-2"><MapPin size={16} /> Penalty mark</button>}
              <button type="button" onClick={() => setLocation(null)} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 flex items-center justify-center gap-2"><MapPinOff size={16} /> Location unknown</button>
            </div>
          )}

          {draft.teamSide === 'opponent' && !ownGoal && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty') && (
            <p className="text-xs font-medium text-slate-500">Goalkeeper: {goalkeeper ? participantLabel(goalkeeper) : 'Unavailable'}</p>
          )}
          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="button" onClick={save} disabled={saveDisabled} className="min-h-12 w-full rounded-md bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">
            {ownGoal ? 'Log Own Goal' : outcome ? `Log ${OUTCOMES.find(option => option.value === outcome)?.label}` : 'Choose Outcome'}
          </button>
        </div>
        <datalist id="soccer-opponent-labels">{recentOpponentLabels.map(label => <option key={label} value={label} />)}</datalist>
      </div>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="mb-2 text-xs font-bold uppercase text-slate-500">{label}</p>{children}</div>
}

function ChoiceButton({ active, label, onClick, compact = false }: { active: boolean; label: string; onClick: () => void; compact?: boolean }) {
  return <button type="button" onClick={onClick} className={`${compact ? 'min-h-8' : 'min-h-11'} rounded-md px-2 text-xs font-bold ${active ? 'bg-emerald-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>{label}</button>
}

function OpponentInput({ value, onChange, recent, placeholder }: { value: string; onChange: (value: string) => void; recent: string[]; placeholder: string }) {
  return <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} list={recent.length ? 'soccer-opponent-labels' : undefined} className="input-field" />
}

function participantLabel(participant: { displayName: string; number: string | null }): string {
  return `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`
}

function penaltyMark(direction: 'left_to_right' | 'right_to_left'): GameEventLocation {
  return { x: direction === 'left_to_right' ? 0.87 : 0.13, y: 0.5, attackingDirection: direction }
}

function oppositeDirection(direction: 'left_to_right' | 'right_to_left'): 'left_to_right' | 'right_to_left' {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

function opponentLabels(state: GameState): string[] {
  const labels: string[] = []
  for (const raw of [...(state.eventStream?.events ?? [])].reverse()) {
    if (!raw || typeof raw !== 'object' || !('actors' in raw) || !Array.isArray(raw.actors)) continue
    for (const actor of raw.actors) {
      if (!actor || typeof actor !== 'object' || !('kind' in actor) || !('label' in actor)) continue
      if (actor.kind !== 'unknown' || typeof actor.label !== 'string' || 'participantId' in actor) continue
      const label = actor.label.trim()
      if (label && !labels.includes(label)) labels.push(label)
      if (labels.length >= 6) return labels
    }
  }
  return labels
}

import { MapPin, MapPinOff, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { GameEventActor, GameEventLocation } from '../../lib/gameEvents/types'
import {
  inspectSoccerHistory,
  recordHistoricalSoccerOwnGoal,
  recordHistoricalSoccerShot,
  recordSoccerOwnGoal,
  recordSoccerShot,
  resolveSoccerCaptureSaveOperation,
  reviseSoccerOwnGoal,
  reviseSoccerShot,
  soccerAttackingDirectionAt,
  soccerParticipantRoleAt,
  soccerParticipantWasOnFieldAt,
  soccerPeriodTimings,
  soccerShotSourceCandidates,
  sortSoccerActorParticipants,
  type SoccerCaptureActorSelection,
  type SoccerEventMoment,
  type SoccerLiveResult,
  type SoccerMatchEvent,
  type SoccerOwnGoalEvent,
  type SoccerShotOutcome,
  type SoccerShotEvent,
  type SoccerShotSituation,
  type SoccerTeamSide,
} from '../../lib/soccer'
import type { GameState } from '../../types'
import { useStableSoccerCorrectionDraft } from '../../hooks/useStableSoccerCorrectionDraft'
import SoccerField from './SoccerField'

export interface SoccerCaptureDraft {
  teamSide: SoccerTeamSide
  location: GameEventLocation | null
  outcome?: SoccerShotOutcome
  preferTeamAttribution?: boolean
  mode?: 'live' | 'historical' | 'edit'
  event?: SoccerShotEvent | SoccerOwnGoalEvent
}

interface SoccerShotCaptureDialogProps {
  draft: SoccerCaptureDraft | null
  state: GameState
  recorderUserId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
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
  busy,
  onApply,
  onClose,
}: SoccerShotCaptureDialogProps) {
  const initializationDraft = useStableSoccerCorrectionDraft(draft)
  const sportState = state.sportGameState?.sportId === 'soccer' ? state.sportGameState : null
  const projection = sportState?.projection ?? null
  const onField = useMemo(
    () => projection
      ? Object.values(projection.participants).filter(participant => participant.status === 'on_field')
      : [],
    [projection]
  )
  const allParticipants = useMemo(
    () => projection ? Object.values(projection.participants) : [],
    [projection]
  )
  const initialRoles = useMemo(
    () => new Map(sportState?.setup?.participants.map(participant => [participant.id, participant.initialRole]) ?? []),
    [sportState?.setup?.participants]
  )
  const periodTimings = useMemo(() => soccerPeriodTimings(state), [state])
  const recentOpponentLabels = useMemo(() => opponentLabels(state), [state])
  const mode = draft?.mode ?? (draft?.event ? 'edit' : 'live')
  const [teamSide, setTeamSide] = useState<SoccerTeamSide>('tracked')
  const [outcome, setOutcome] = useState<SoccerShotOutcome | null>(null)
  const [situation, setSituation] = useState<SoccerShotSituation>('open_play')
  const [sourceEventId, setSourceEventId] = useState('')
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
  const [trackedGoalkeeperId, setTrackedGoalkeeperId] = useState('')
  const [ownGoalParticipantId, setOwnGoalParticipantId] = useState('')
  const [opponentOwnGoalLabel, setOpponentOwnGoalLabel] = useState('Unknown opponent')
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
  const [periodElapsedMs, setPeriodElapsedMs] = useState(0)
  const [locationEditorOpen, setLocationEditorOpen] = useState(false)
  const [locationFieldFlipped, setLocationFieldFlipped] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTiming = periodTimings.find(item => item.period.id === selectedPeriodId)
    ?? periodTimings[periodTimings.length - 1]
    ?? null
  const moment: SoccerEventMoment | null = useMemo(
    () => selectedTiming
      ? {
          period: selectedTiming.period,
          elapsedMs: selectedTiming.startElapsedMs + periodElapsedMs,
        }
      : null,
    [periodElapsedMs, selectedTiming]
  )
  const historicalParticipants = useMemo(
    () => moment
      ? allParticipants.filter(participant =>
          soccerParticipantWasOnFieldAt(participant, moment.period.id, moment.elapsedMs)
        )
      : [],
    [allParticipants, moment]
  )
  const selectableParticipants = useMemo(() => sortSoccerActorParticipants(
    mode === 'live' ? onField : historicalParticipants,
    participant => mode === 'live' || !moment
      ? participant.role
      : soccerParticipantRoleAt(
          participant,
          moment.period.id,
          moment.elapsedMs,
          initialRoles.get(participant.participantId)
        )
  ), [historicalParticipants, initialRoles, mode, moment, onField])
  const selectableGoalkeepers = selectableParticipants.filter(participant => (
    mode === 'live' || !moment
      ? participant.role
      : soccerParticipantRoleAt(
          participant,
          moment.period.id,
          moment.elapsedMs,
          initialRoles.get(participant.participantId)
        )
  ).group === 'goalkeeper')
  const goalkeeper = selectableGoalkeepers[0] ?? null
  const historicalGoalkeeper = mode === 'live' ? null : goalkeeper

  useEffect(() => {
    if (!initializationDraft) return
    const event = initializationDraft.event
    const defaultParticipantId = selectableParticipants.find(participant => (
      mode === 'live' || !moment
        ? participant.role
        : soccerParticipantRoleAt(
            participant,
            moment.period.id,
            moment.elapsedMs,
            initialRoles.get(participant.participantId)
          )
    ).group !== 'goalkeeper')?.participantId ?? selectableParticipants[0]?.participantId ?? ''
    const shot = event?.eventType === 'soccer.shot' ? event : null
    const ownGoalEvent = event?.eventType === 'soccer.own_goal' ? event : null
    const shooter = shot ? actorForRole(shot, 'shooter') : null
    const primary = shot ? actorForRole(shot, 'creator_primary') : null
    const secondary = shot ? actorForRole(shot, 'creator_secondary') : null
    const blocker = shot ? actorForRole(shot, 'blocker') : null
    const linkedGoalkeeper = event ? actorForRole(event, 'goalkeeper') : null
    const ownGoalBy = ownGoalEvent ? actorForRole(ownGoalEvent, 'own_goal_by') : null
    const initialTiming = periodTimings.find(item => item.period.id === event?.period.id)
      ?? periodTimings[periodTimings.length - 1]
      ?? null
    setTeamSide(event?.teamSide ?? initializationDraft.teamSide)
    setOutcome(shot?.payload.outcome ?? (ownGoalEvent ? 'goal' : initializationDraft.outcome ?? null))
    setSituation(shot?.payload.situation ?? 'open_play')
    setSourceEventId(shot?.payload.sourceEventId ?? '')
    setOwnGoal(Boolean(ownGoalEvent))
    setLocation(event?.location ?? initializationDraft.location)
    setTrackedShooterId(shooter?.participantId ?? (shooter?.kind === 'team' || initializationDraft.preferTeamAttribution ? '__team__' : defaultParticipantId || '__team__'))
    setOpponentShooterMode(shooter?.kind === 'team' ? 'team' : 'unknown')
    setOpponentShooterLabel(opponentLabel(shooter, 'Unknown opponent'))
    setPrimaryCreatorId(primary?.participantId ?? '')
    setSecondaryCreatorId(secondary?.participantId ?? '')
    setOpponentCreatorLabel(opponentLabel(primary, ''))
    setOpponentSecondaryLabel(opponentLabel(secondary, ''))
    setShowSecondary(Boolean(secondary))
    setTrackedBlockerId(blocker?.participantId ?? (blocker?.kind === 'unknown' ? '__unknown__' : '__team__'))
    setOpponentBlockerLabel(opponentLabel(blocker, ''))
    setOpponentGoalkeeperLabel(opponentLabel(linkedGoalkeeper, ''))
    setTrackedGoalkeeperId(linkedGoalkeeper?.participantId ?? (mode === 'live'
      ? onField.find(participant => participant.role.group === 'goalkeeper')?.participantId ?? ''
      : ''))
    setOwnGoalParticipantId(ownGoalBy?.participantId ?? defaultParticipantId)
    setOpponentOwnGoalLabel(opponentLabel(ownGoalBy, 'Unknown opponent'))
    setSelectedPeriodId(initialTiming?.period.id ?? '')
    setPeriodElapsedMs(initialTiming
      ? Math.max(0, (event?.elapsedMs ?? initialTiming.endElapsedMs) - initialTiming.startElapsedMs)
      : 0)
    setLocationEditorOpen(false)
    setLocationFieldFlipped(false)
    setError(null)
  }, [initialRoles, initializationDraft, mode, moment, onField, periodTimings, selectableParticipants])

  useEffect(() => {
    if (initializationDraft && !trackedGoalkeeperId && goalkeeper) {
      setTrackedGoalkeeperId(goalkeeper.participantId)
    }
  }, [goalkeeper, initializationDraft, trackedGoalkeeperId])

  useEffect(() => {
    if (!initializationDraft || mode === 'live' || !moment) return
    const validIds = new Set(selectableParticipants.map(participant => participant.participantId))
    const fallbackId = selectableParticipants.find(participant => soccerParticipantRoleAt(
      participant,
      moment.period.id,
      moment.elapsedMs,
      initialRoles.get(participant.participantId)
    ).group !== 'goalkeeper')?.participantId ?? selectableParticipants[0]?.participantId ?? ''
    setTrackedShooterId(current => current === '__team__' || validIds.has(current) ? current : fallbackId || '__team__')
    setOwnGoalParticipantId(current => validIds.has(current) ? current : fallbackId)
    setPrimaryCreatorId(current => validIds.has(current) ? current : '')
    setSecondaryCreatorId(current => validIds.has(current) ? current : '')
    setTrackedBlockerId(current => current === '__team__' || current === '__unknown__' || validIds.has(current) ? current : '__team__')
    setTrackedGoalkeeperId(current => current && validIds.has(current) && current === historicalGoalkeeper?.participantId
      ? current
      : historicalGoalkeeper?.participantId ?? '')
  }, [historicalGoalkeeper, initialRoles, initializationDraft, mode, moment, selectableParticipants])

  if (!draft || !projection) return null

  const creatorsAllowed = !ownGoal && situation !== 'penalty' && situation !== 'direct_free_kick'
  const sourceAllowed = situation === 'penalty' ||
    situation === 'direct_free_kick' ||
    situation === 'corner_sequence'
  const sourceCandidates = moment
    ? soccerShotSourceCandidates(inspectSoccerHistory(state).activeEvents as SoccerMatchEvent[], {
        teamSide,
        situation,
        period: moment.period,
        elapsedMs: moment.elapsedMs,
        excludeEventId: draft.event?.id,
      })
    : []
  const ownGoalNeedsGoalkeeper = ownGoal && teamSide === 'opponent'
  const timingInvalid = mode !== 'live' && (
    !selectedTiming ||
    periodElapsedMs < 0 ||
    selectedTiming.startElapsedMs + periodElapsedMs > selectedTiming.endElapsedMs
  )
  const selectableParticipantIds = new Set(selectableParticipants.map(participant => participant.participantId))
  const historicalActorInvalid = mode !== 'live' && (
    (!ownGoal && teamSide === 'tracked' && trackedShooterId !== '__team__' && !selectableParticipantIds.has(trackedShooterId)) ||
    (ownGoal && teamSide === 'opponent' && !selectableParticipantIds.has(ownGoalParticipantId)) ||
    (primaryCreatorId !== '' && !selectableParticipantIds.has(primaryCreatorId)) ||
    (secondaryCreatorId !== '' && !selectableParticipantIds.has(secondaryCreatorId)) ||
    (trackedBlockerId !== '__team__' && trackedBlockerId !== '__unknown__' && !selectableParticipantIds.has(trackedBlockerId)) ||
    (trackedGoalkeeperId !== '' && !selectableParticipantIds.has(trackedGoalkeeperId))
  )
  const saveDisabled = busy || outcome === null || (
    ownGoal && teamSide === 'opponent' && !ownGoalParticipantId
  ) || (ownGoalNeedsGoalkeeper && !trackedGoalkeeperId) || timingInvalid || historicalActorInvalid
  const trackedDirection = moment
    ? soccerAttackingDirectionAt(state, moment)
    : projection.attackingDirection
  const captureDirection = teamSide === 'tracked'
    ? trackedDirection
    : oppositeDirection(trackedDirection)

  const save = () => {
    if (!outcome) return
    const intendedEventType = ownGoal ? 'soccer.own_goal' : 'soccer.shot'
    const operation = resolveSoccerCaptureSaveOperation(
      mode,
      intendedEventType,
      draft.event?.eventType ?? null,
      moment !== null
    )
    if (!operation.ok) {
      setError(operation.message)
      return
    }
    const options = { recorderUserId }
    const eventLocation = location ? { ...location, attackingDirection: captureDirection } : null
    let result: SoccerLiveResult
    if (ownGoal) {
      const ownGoalBy: SoccerCaptureActorSelection = teamSide === 'opponent'
        ? { kind: 'participant', participantId: ownGoalParticipantId }
        : { kind: 'unknown', label: opponentOwnGoalLabel || 'Unknown opponent' }
      const input = {
        teamSide,
        location: eventLocation,
        ownGoalBy,
        goalkeeper: teamSide === 'opponent' && trackedGoalkeeperId
          ? { kind: 'participant' as const, participantId: trackedGoalkeeperId }
          : null,
      }
      if (operation.operation === 'revise') {
        if (!draft.event || !moment) return setError('The event correction context is unavailable.')
        result = reviseSoccerOwnGoal(state, draft.event.id, input, moment)
      } else if (operation.operation === 'record_historical') {
        if (!moment) return setError('A recorded match time is required.')
        result = recordHistoricalSoccerOwnGoal(state, input, moment, options)
      } else {
        result = recordSoccerOwnGoal(state, input, options)
      }
    } else {
      const shooter: SoccerCaptureActorSelection = teamSide === 'tracked'
        ? trackedShooterId === '__team__'
          ? { kind: 'team', label: state.gameInfo?.teamName ?? 'Tracked team' }
          : { kind: 'participant', participantId: trackedShooterId }
        : opponentShooterMode === 'team'
          ? { kind: 'team', label: state.gameInfo?.opponentName ?? 'Opponent' }
          : { kind: 'unknown', label: opponentShooterLabel || 'Unknown opponent' }
      const goalkeeperSelection = teamSide === 'opponent'
        ? trackedGoalkeeperId && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty')
          ? { kind: 'participant' as const, participantId: trackedGoalkeeperId }
          : null
        : opponentGoalkeeperLabel.trim() && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty')
          ? { kind: 'unknown' as const, label: opponentGoalkeeperLabel }
          : null
      const input = {
        teamSide,
        outcome,
        situation,
        sourceEventId: sourceAllowed ? sourceEventId || null : null,
        location: eventLocation,
        shooter,
        primaryCreator: creatorsAllowed
          ? teamSide === 'tracked'
            ? primaryCreatorId ? { kind: 'participant', participantId: primaryCreatorId } : null
            : opponentCreatorLabel.trim() ? { kind: 'unknown', label: opponentCreatorLabel } : null
          : null,
        secondaryCreator: creatorsAllowed && outcome === 'goal' && showSecondary
          ? teamSide === 'tracked'
            ? secondaryCreatorId ? { kind: 'participant', participantId: secondaryCreatorId } : null
            : opponentSecondaryLabel.trim() ? { kind: 'unknown', label: opponentSecondaryLabel } : null
          : null,
        goalkeeper: goalkeeperSelection,
        blocker: outcome === 'blocked'
          ? teamSide === 'opponent'
            ? trackedBlockerId === '__team__'
              ? { kind: 'team', label: state.gameInfo?.teamName ?? 'Tracked team' }
              : trackedBlockerId === '__unknown__'
                ? { kind: 'unknown', label: 'Unknown tracked blocker' }
                : { kind: 'participant', participantId: trackedBlockerId }
            : opponentBlockerLabel.trim()
              ? { kind: 'unknown', label: opponentBlockerLabel }
              : null
          : null,
      } satisfies Parameters<typeof recordSoccerShot>[1]
      if (operation.operation === 'revise') {
        if (!draft.event || !moment) return setError('The event correction context is unavailable.')
        result = reviseSoccerShot(state, draft.event.id, input, moment)
      } else if (operation.operation === 'record_historical') {
        if (!moment) return setError('A recorded match time is required.')
        result = recordHistoricalSoccerShot(state, input, moment, options)
      } else {
        result = recordSoccerShot(state, input, options)
      }
    }

    if (!result.ok) {
      setError(result.message)
      onApply(result)
      return
    }
    if (!onApply(result)) return
    onClose()
  }

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
            <h2 id="soccer-capture-title" className="font-bold text-slate-900">{teamSide === 'tracked' ? state.gameInfo?.teamName : state.gameInfo?.opponentName}</h2>
            <p className="text-xs text-slate-500">{location ? `${Math.round(location.x * 100)}, ${Math.round(location.y * 100)}` : 'Location unknown'}</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button>
        </header>

        <div className="space-y-5 p-4">
          {mode !== 'live' && (
            <>
              <FieldGroup label="Side">
                <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1">
                  <ChoiceButton active={teamSide === 'tracked'} label="Tracked" onClick={() => { setTeamSide('tracked'); if (teamSide !== 'tracked') setSourceEventId('') }} compact />
                  <ChoiceButton active={teamSide === 'opponent'} label="Opponent" onClick={() => { setTeamSide('opponent'); if (teamSide !== 'opponent') setSourceEventId('') }} compact />
                </div>
              </FieldGroup>
              <FieldGroup label="Match time">
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2">
                  <select
                    value={selectedTiming?.period.id ?? ''}
                    onChange={event => {
                      const next = periodTimings.find(item => item.period.id === event.target.value)
                      setSelectedPeriodId(event.target.value)
                      setPeriodElapsedMs(next ? next.endElapsedMs - next.startElapsedMs : 0)
                      setSourceEventId('')
                    }}
                    className="input-field"
                  >
                    {periodTimings.map(item => <option key={item.period.id} value={item.period.id}>{item.label}</option>)}
                  </select>
                  <label className="text-[11px] font-bold uppercase text-slate-500">Min<input type="number" min="0" value={Math.floor(periodElapsedMs / 60_000)} onChange={event => { setPeriodElapsedMs(Math.max(0, Number(event.target.value) || 0) * 60_000 + Math.floor(periodElapsedMs / 1_000) % 60 * 1_000); setSourceEventId('') }} className="input-field mt-1" /></label>
                  <label className="text-[11px] font-bold uppercase text-slate-500">Sec<input type="number" min="0" max="59" value={Math.floor(periodElapsedMs / 1_000) % 60} onChange={event => { setPeriodElapsedMs(Math.floor(periodElapsedMs / 60_000) * 60_000 + Math.min(59, Math.max(0, Number(event.target.value) || 0)) * 1_000); setSourceEventId('') }} className="input-field mt-1" /></label>
                </div>
                {timingInvalid && <p className="mt-2 text-xs font-medium text-amber-700">Choose a time inside the recorded period.</p>}
              </FieldGroup>
            </>
          )}
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

          {outcome === 'goal' && mode !== 'edit' && (
            <label className="flex min-h-11 items-center justify-between border-y border-slate-200 py-2 text-sm font-semibold text-slate-700">
              Own goal
              <input type="checkbox" checked={ownGoal} onChange={event => setOwnGoal(event.target.checked)} className="h-5 w-5 accent-emerald-700" />
            </label>
          )}

          {!ownGoal && (
            <FieldGroup label="Shooter">
              {teamSide === 'tracked' ? (
                <select value={trackedShooterId} onChange={event => setTrackedShooterId(event.target.value)} className="input-field">
                  {selectableParticipants.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
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
              {teamSide === 'opponent' ? (
                <select value={ownGoalParticipantId} onChange={event => setOwnGoalParticipantId(event.target.value)} className="input-field">
                  {selectableParticipants.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
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
                  if (next === 'open_play' || next === 'other_set_piece') {
                    setSourceEventId('')
                  } else if (moment) {
                    setSourceEventId(soccerShotSourceCandidates(
                      inspectSoccerHistory(state).activeEvents as SoccerMatchEvent[],
                      {
                        teamSide,
                        situation: next,
                        period: moment.period,
                        elapsedMs: moment.elapsedMs,
                        excludeEventId: draft.event?.id,
                      }
                    )[0]?.eventId ?? '')
                  }
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

          {!ownGoal && sourceAllowed && (
            <FieldGroup label="Restart source (optional)">
              <select value={sourceEventId} onChange={event => setSourceEventId(event.target.value)} className="input-field">
                <option value="">No linked source</option>
                {sourceEventId && !sourceCandidates.some(candidate => candidate.eventId === sourceEventId) && (
                  <option value={sourceEventId}>Current source (needs review)</option>
                )}
                {sourceCandidates.map(candidate => (
                  <option key={candidate.eventId} value={candidate.eventId}>
                    {candidate.label} at {Math.floor(candidate.elapsedMs / 60_000)}:{String(Math.floor(candidate.elapsedMs / 1_000) % 60).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </FieldGroup>
          )}

          {ownGoalNeedsGoalkeeper && (
            <FieldGroup label="Tracked goalkeeper">
              <select value={trackedGoalkeeperId} onChange={event => setTrackedGoalkeeperId(event.target.value)} className="input-field">
                <option value="">Select goalkeeper</option>
                {selectableGoalkeepers.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
              </select>
              {!trackedGoalkeeperId && <p role="alert" className="mt-2 text-xs font-medium text-amber-700">A tracked goalkeeper is required for this own goal.</p>}
            </FieldGroup>
          )}

          {!ownGoal && creatorsAllowed && (
            <FieldGroup label={outcome === 'goal' ? 'Primary assist' : 'Creator'}>
              {teamSide === 'tracked' ? (
                <select value={primaryCreatorId} onChange={event => { setPrimaryCreatorId(event.target.value); if (event.target.value === secondaryCreatorId) setSecondaryCreatorId('') }} className="input-field">
                  <option value="">None</option>
                  {selectableParticipants.filter(participant => participant.participantId !== trackedShooterId).map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
                </select>
              ) : (
                <OpponentInput value={opponentCreatorLabel} onChange={setOpponentCreatorLabel} recent={recentOpponentLabels} placeholder="None" />
              )}
              {outcome === 'goal' && !showSecondary && (
                <button type="button" onClick={() => setShowSecondary(true)} className="mt-2 min-h-9 text-xs font-bold text-emerald-700 flex items-center gap-1"><Plus size={15} /> Secondary assist</button>
              )}
              {outcome === 'goal' && showSecondary && (
                <div className="mt-2">
                  {teamSide === 'tracked' ? (
                    <select value={secondaryCreatorId} onChange={event => setSecondaryCreatorId(event.target.value)} className="input-field">
                      <option value="">No secondary assist</option>
                      {selectableParticipants.filter(participant => participant.participantId !== trackedShooterId && participant.participantId !== primaryCreatorId).map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
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
              {teamSide === 'opponent' ? (
                <select value={trackedBlockerId} onChange={event => setTrackedBlockerId(event.target.value)} className="input-field">
                  <option value="__team__">Team</option>
                  {selectableParticipants.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
                  <option value="__unknown__">Unknown</option>
                </select>
              ) : (
                <OpponentInput value={opponentBlockerLabel} onChange={setOpponentBlockerLabel} recent={recentOpponentLabels} placeholder="Opponent blocker (optional)" />
              )}
            </FieldGroup>
          )}

          {!ownGoal && teamSide === 'tracked' && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty') && (
            <FieldGroup label="Opponent goalkeeper">
              <OpponentInput value={opponentGoalkeeperLabel} onChange={setOpponentGoalkeeperLabel} recent={recentOpponentLabels} placeholder="Optional label" />
            </FieldGroup>
          )}

          {teamSide === 'opponent' && !ownGoal && (outcome === 'goal' || outcome === 'saved' || situation === 'penalty') && (
            <FieldGroup label="Tracked goalkeeper">
              <select value={trackedGoalkeeperId} onChange={event => setTrackedGoalkeeperId(event.target.value)} className="input-field">
                <option value="">Select goalkeeper</option>
                {selectableGoalkeepers.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}
              </select>
            </FieldGroup>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setLocationEditorOpen(value => !value)} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 flex items-center justify-center gap-2"><MapPin size={16} /> {locationEditorOpen ? 'Hide field' : 'Set location'}</button>
            <button type="button" onClick={() => setLocation(null)} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 flex items-center justify-center gap-2"><MapPinOff size={16} /> Location unknown</button>
          </div>

          {situation === 'penalty' && !ownGoal && (
            <button type="button" onClick={() => setLocation(penaltyMark(captureDirection))} className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 flex items-center justify-center gap-2"><MapPin size={16} /> Use penalty mark</button>
          )}

          {locationEditorOpen && (
            <SoccerField
              trackedDirection={trackedDirection}
              captureSide={teamSide}
              flipped={locationFieldFlipped}
              disabled={false}
              onFlip={() => setLocationFieldFlipped(value => !value)}
              onLocation={nextLocation => {
                setLocation(nextLocation)
                setLocationEditorOpen(false)
              }}
            />
          )}
          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="button" onClick={save} disabled={saveDisabled} className="min-h-12 w-full rounded-md bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">
            {mode === 'edit'
              ? 'Save Correction'
              : ownGoal
                ? 'Log Own Goal'
                : outcome
                  ? `Log ${OUTCOMES.find(option => option.value === outcome)?.label}`
                  : 'Choose Outcome'}
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

function actorForRole(
  event: SoccerShotEvent | SoccerOwnGoalEvent,
  role: string
): GameEventActor | null {
  return event.actors.find(actor => actor.role === role) ?? null
}

function opponentLabel(actor: GameEventActor | null, fallback: string): string {
  return actor && !actor.participantId && actor.kind !== 'team' && actor.label
    ? actor.label
    : fallback
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

import { MapPin, MapPinOff, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  GameEventActor,
  GameEventLocation,
  GameEventPeriod,
  JsonObject,
} from '../../lib/gameEvents/types'
import {
  recordCheckedSoccerEvent,
  soccerAttackingDirectionAt,
  soccerDisciplineCaptureChoice,
  soccerParticipantRoleAt,
  soccerParticipantWasOnFieldAt,
  soccerPeriodTimings,
  updateSoccerHistoryEvent,
  type SoccerCardEvent,
  type SoccerCardSanction,
  type SoccerDefensiveAction,
  type SoccerDefensiveActionEvent,
  type SoccerDisciplineCaptureChoice,
  type SoccerDisciplineLineupResolution,
  type SoccerDisciplineReason,
  type SoccerFoulEvent,
  type SoccerFoulRestart,
  type SoccerLiveResult,
  type SoccerProjectedParticipant,
  type SoccerRole,
  type SoccerSanction,
  type SoccerTeamEventEvent,
  type SoccerTeamEventKind,
  type SoccerTackleOutcome,
  type SoccerTeamSide,
} from '../../lib/soccer'
import {
  normalizeSoccerIncidentActorSelection,
  type SoccerIncidentAttribution,
} from '../../lib/soccer/incidentAttribution'
import type { GameState } from '../../types'
import { useStableSoccerCorrectionDraft } from '../../hooks/useStableSoccerCorrectionDraft'
import SoccerField from './SoccerField'

export type SoccerIncidentKind = 'defense' | 'foul' | 'card' | 'team_event'
export type SoccerIncidentEvent =
  | SoccerDefensiveActionEvent
  | SoccerFoulEvent
  | SoccerCardEvent
  | SoccerTeamEventEvent

export interface SoccerIncidentDraft {
  kind: SoccerIncidentKind
  teamSide: SoccerTeamSide
  location: GameEventLocation | null
  mode?: 'live' | 'historical' | 'edit'
  event?: SoccerIncidentEvent
}

interface SoccerIncidentCaptureDialogProps {
  draft: SoccerIncidentDraft | null
  state: GameState
  recorderUserId: string | null
  selectedParticipantId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onTrackedParticipantUsed: (participantId: string) => void
  onClose: () => void
}

type Attribution = SoccerIncidentAttribution
const DEFENSIVE_ACTIONS: Array<{ value: SoccerDefensiveAction; label: string }> = [
  { value: 'tackle', label: 'Tackle' },
  { value: 'interception', label: 'Interception' },
  { value: 'clearance', label: 'Clearance' },
  { value: 'recovery', label: 'Recovery' },
]

const RESTARTS: Array<{ value: SoccerFoulRestart; label: string }> = [
  { value: 'direct_free_kick', label: 'Direct free kick' },
  { value: 'indirect_free_kick', label: 'Indirect free kick' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'advantage', label: 'Advantage' },
  { value: 'none', label: 'None' },
]

const REASONS: Array<{ value: SoccerDisciplineReason; label: string }> = [
  { value: 'dissent', label: 'Dissent' },
  { value: 'unsporting_behavior', label: 'Unsporting behavior' },
  { value: 'persistent_offenses', label: 'Persistent offenses' },
  { value: 'delaying_restart', label: 'Delaying restart' },
  { value: 'failure_to_respect_distance', label: 'Failure to respect distance' },
  { value: 'unauthorized_entry_exit', label: 'Unauthorized entry or exit' },
  { value: 'serious_foul_play', label: 'Serious foul play' },
  { value: 'violent_conduct', label: 'Violent conduct' },
  { value: 'dogso', label: 'Denying a goal-scoring opportunity' },
  { value: 'abusive_language', label: 'Abusive language' },
  { value: 'second_caution', label: 'Second caution' },
  { value: 'other_not_recorded', label: 'Other' },
]

export default function SoccerIncidentCaptureDialog({
  draft,
  state,
  recorderUserId,
  selectedParticipantId,
  busy,
  onApply,
  onTrackedParticipantUsed,
  onClose,
}: SoccerIncidentCaptureDialogProps) {
  const initializationDraft = useStableSoccerCorrectionDraft(draft)
  const sportState = state.sportGameState?.sportId === 'soccer' ? state.sportGameState : null
  const projection = sportState?.projection ?? null
  const periodTimings = useMemo(() => soccerPeriodTimings(state), [state])
  const participants = useMemo(
    () => projection ? Object.values(projection.participants) : [],
    [projection]
  )
  const initialRoles = useMemo(
    () => new Map(sportState?.setup?.participants.map(participant => [participant.id, participant.initialRole]) ?? []),
    [sportState?.setup?.participants]
  )
  const recentLabels = useMemo(() => recentOpponentLabels(state), [state])
  const mode = draft?.mode ?? (draft?.event ? 'edit' : 'live')
  const [teamSide, setTeamSide] = useState<SoccerTeamSide>('tracked')
  const [location, setLocation] = useState<GameEventLocation | null>(null)
  const [attribution, setAttribution] = useState<Attribution>('participant')
  const [participantId, setParticipantId] = useState('')
  const [actorLabel, setActorLabel] = useState('Unknown opponent')
  const [action, setAction] = useState<SoccerDefensiveAction>('interception')
  const [tackleOutcome, setTackleOutcome] = useState<SoccerTackleOutcome>('won')
  const [restart, setRestart] = useState<SoccerFoulRestart>('direct_free_kick')
  const [sanction, setSanction] = useState<SoccerSanction>('none')
  const [reason, setReason] = useState<SoccerDisciplineReason>('unsporting_behavior')
  const [note, setNote] = useState('')
  const [fouledAttribution, setFouledAttribution] = useState<'none' | 'participant' | 'team' | 'unknown'>('none')
  const [fouledParticipantId, setFouledParticipantId] = useState('')
  const [fouledLabel, setFouledLabel] = useState('Unknown opponent')
  const [teamEventKind, setTeamEventKind] = useState<SoccerTeamEventKind>('corner')
  const [offsideActorRecorded, setOffsideActorRecorded] = useState(false)
  const [disciplineChoice, setDisciplineChoice] = useState<SoccerDisciplineCaptureChoice>('stay')
  const [replacementInId, setReplacementInId] = useState('')
  const [replacementOutId, setReplacementOutId] = useState('')
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
  const [periodElapsedMs, setPeriodElapsedMs] = useState(0)
  const [locationEditorOpen, setLocationEditorOpen] = useState(false)
  const [fieldFlipped, setFieldFlipped] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTiming = periodTimings.find(item => item.period.id === selectedPeriodId)
    ?? periodTimings[periodTimings.length - 1]
    ?? null
  const moment = selectedTiming
    ? {
        period: selectedTiming.period,
        elapsedMs: selectedTiming.startElapsedMs + periodElapsedMs,
      }
    : null
  const eligibleParticipants = participants.filter(participant =>
    mode === 'live'
      ? participant.status === 'on_field'
      : moment !== null && soccerParticipantWasOnFieldAt(participant, moment.period.id, moment.elapsedMs)
  )
  const selectedParticipant = participants.find(item => item.participantId === participantId) ?? null
  const selectedRole = selectedParticipant && moment
    ? soccerParticipantRoleAt(
        selectedParticipant,
        moment.period.id,
        moment.elapsedMs,
        initialRoles.get(selectedParticipant.participantId)
      )
    : selectedParticipant?.role ?? null
  const existingResolution = draft?.event?.eventType === 'soccer.card' || draft?.event?.eventType === 'soccer.foul'
    ? draft.event.payload.lineupResolution
    : null
  const existingReplacementInId = existingResolution?.replacementChanges[0]?.playerInParticipantId ?? null
  const currentOrHistoricalBench = participants.filter(participant => {
    if (mode === 'edit' && participant.participantId === existingReplacementInId) return true
    return mode === 'live'
      ? participant.status !== 'on_field' && participant.status !== 'left'
      : moment !== null && !soccerParticipantWasOnFieldAt(participant, moment.period.id, moment.elapsedMs)
  })
  const goalkeeperBench = currentOrHistoricalBench.filter(participant =>
    moment !== null && soccerParticipantRoleAt(
      participant,
      moment.period.id,
      moment.elapsedMs,
      initialRoles.get(participant.participantId)
    ).group === 'goalkeeper'
  )
  const fieldPlayers = eligibleParticipants.filter(participant =>
    !moment || soccerParticipantRoleAt(
      participant,
      moment.period.id,
      moment.elapsedMs,
      initialRoles.get(participant.participantId)
    ).group !== 'goalkeeper'
  )
  const nonGoalkeeperBench = currentOrHistoricalBench.filter(participant =>
    !moment || soccerParticipantRoleAt(
      participant,
      moment.period.id,
      moment.elapsedMs,
      initialRoles.get(participant.participantId)
    ).group !== 'goalkeeper'
  )
  const trackedDirection = moment
    ? soccerAttackingDirectionAt(state, moment)
    : projection?.attackingDirection ?? 'left_to_right'
  const captureDirection = teamSide === 'tracked' ? trackedDirection : oppositeDirection(trackedDirection)
  const timingInvalid = mode !== 'live' && (
    !selectedTiming ||
    periodElapsedMs < 0 ||
    selectedTiming.startElapsedMs + periodElapsedMs > selectedTiming.endElapsedMs
  )
  const disciplineApplies = (draft?.kind === 'card' || draft?.kind === 'foul') &&
    sanction !== 'none' && teamSide === 'tracked' && attribution === 'participant'
  const effectiveDisciplineChoice = disciplineApplies && selectedRole && projection
    ? soccerDisciplineCaptureChoice(
        sanction as SoccerCardSanction,
        projection.currentRules.yellowCardExitPolicy,
        selectedRole.group === 'goalkeeper',
        disciplineChoice
      )
    : disciplineChoice
  const replacementBench = selectedRole?.group === 'goalkeeper' ? goalkeeperBench : nonGoalkeeperBench
  const replacementInInvalid = (effectiveDisciplineChoice === 'replace' || effectiveDisciplineChoice === 'keeper_handoff') &&
    !replacementBench.some(participant => participant.participantId === replacementInId)
  const replacementOutInvalid = effectiveDisciplineChoice === 'keeper_handoff' &&
    !fieldPlayers.some(participant => participant.participantId === replacementOutId && participant.participantId !== participantId)

  const changeTeamSide = (nextSide: SoccerTeamSide) => {
    const main = normalizeSoccerIncidentActorSelection(
      nextSide,
      attribution,
      participantId
    )
    const fouled = normalizeSoccerIncidentActorSelection(
      oppositeTeamSide(nextSide),
      fouledAttribution === 'none' ? 'unknown' : fouledAttribution,
      fouledParticipantId
    )
    setTeamSide(nextSide)
    setAttribution(main.attribution)
    setParticipantId(main.participantId)
    if (fouledAttribution !== 'none') {
      setFouledAttribution(fouled.attribution)
      setFouledParticipantId(fouled.participantId)
    }
  }

  useEffect(() => {
    if (!initializationDraft || !projection) return
    const event = initializationDraft.event
    const mainActor = event ? primaryActor(event) : null
    const initialTiming = periodTimings.find(item => item.period.id === event?.period.id)
      ?? periodTimings[periodTimings.length - 1]
      ?? null
    const defaultParticipant = eligibleLiveParticipant(participants, selectedParticipantId)
    const eventSanction = event?.eventType === 'soccer.card'
      ? event.payload.sanction
      : event?.eventType === 'soccer.foul'
        ? event.payload.sanction
        : initializationDraft.kind === 'card' ? 'yellow' : 'none'
    const eventResolution = event?.eventType === 'soccer.card' || event?.eventType === 'soccer.foul'
      ? event.payload.lineupResolution
      : null
    const replacement = eventResolution?.replacementChanges[0]
    const fouled = event?.eventType === 'soccer.foul'
      ? event.actors.find(actor => actor.role === 'fouled') ?? null
      : null

    const initialTeamSide = event?.teamSide ?? initializationDraft.teamSide
    const initialAttribution = normalizeSoccerIncidentActorSelection(
      initialTeamSide,
      actorAttribution(mainActor, event?.eventType === 'soccer.card'),
      mainActor?.participantId ?? defaultParticipant?.participantId ?? ''
    )
    const initialFouledAttribution = fouled
      ? actorAttribution(fouled, false) as 'participant' | 'team' | 'unknown'
      : 'none'
    const normalizedFouled = normalizeSoccerIncidentActorSelection(
      oppositeTeamSide(initialTeamSide),
      initialFouledAttribution === 'none' ? 'unknown' : initialFouledAttribution,
      fouled?.participantId ?? ''
    )

    setTeamSide(initialTeamSide)
    setLocation(event?.location ?? initializationDraft.location)
    setAttribution(initialAttribution.attribution)
    setParticipantId(initialAttribution.participantId)
    setActorLabel(mainActor?.label ?? (initialTeamSide === 'tracked' ? 'Unknown tracked player' : 'Unknown opponent'))
    setAction(event?.eventType === 'soccer.defensive_action' ? event.payload.action : 'interception')
    setTackleOutcome(event?.eventType === 'soccer.defensive_action' && event.payload.tackleOutcome
      ? event.payload.tackleOutcome
      : 'won')
    setRestart(event?.eventType === 'soccer.foul' ? event.payload.restart : 'direct_free_kick')
    setSanction(eventSanction)
    setReason(event?.eventType === 'soccer.card'
      ? event.payload.reason
      : event?.eventType === 'soccer.foul' && event.payload.sanctionReason
        ? event.payload.sanctionReason
        : 'unsporting_behavior')
    setNote(event?.eventType === 'soccer.card' || event?.eventType === 'soccer.foul'
      ? event.payload.note ?? ''
      : '')
    setFouledAttribution(initialFouledAttribution === 'none'
      ? 'none'
      : normalizedFouled.attribution)
    setFouledParticipantId(initialFouledAttribution === 'none'
      ? ''
      : normalizedFouled.participantId)
    setFouledLabel(fouled?.label ?? 'Unknown opponent')
    setTeamEventKind(event?.eventType === 'soccer.team_event' ? event.payload.kind : 'corner')
    setOffsideActorRecorded(Boolean(event?.eventType === 'soccer.team_event' && mainActor))
    setDisciplineChoice(eventResolution
      ? eventResolution.exit === 'none'
        ? 'stay'
        : replacement?.playerOutParticipantId
          ? 'keeper_handoff'
          : replacement?.playerInParticipantId
            ? 'replace'
            : 'short'
      : 'stay')
    setReplacementInId(replacement?.playerInParticipantId ?? '')
    setReplacementOutId(replacement?.playerOutParticipantId ?? '')
    setSelectedPeriodId(initialTiming?.period.id ?? '')
    setPeriodElapsedMs(initialTiming
      ? Math.max(0, (event?.elapsedMs ?? initialTiming.endElapsedMs) - initialTiming.startElapsedMs)
      : 0)
    setLocationEditorOpen(false)
    setFieldFlipped(false)
    setError(null)
  }, [initializationDraft, periodTimings, participants, projection, selectedParticipantId])

  useEffect(() => {
    if (!disciplineApplies || !selectedRole) return
    setDisciplineChoice(current => soccerDisciplineCaptureChoice(
      sanction as SoccerCardSanction,
      sportState?.projection.currentRules.yellowCardExitPolicy ?? 'stay_on',
      selectedRole.group === 'goalkeeper',
      current
    ))
  }, [disciplineApplies, sanction, selectedRole, sportState?.projection.currentRules.yellowCardExitPolicy])

  if (!draft || !projection || !sportState) return null

  const actorRequired = draft.kind !== 'team_event' ||
    (teamEventKind === 'offside' && offsideActorRecorded)
  const participantActorInvalid = actorRequired && attribution === 'participant' &&
    !eligibleParticipants.some(participant => participant.participantId === participantId)
  const fouledParticipantInvalid = draft.kind === 'foul' && fouledAttribution === 'participant' &&
    !eligibleParticipants.some(participant => participant.participantId === fouledParticipantId)
  const saveDisabled = busy || timingInvalid ||
    (actorRequired && attribution === 'participant' && !participantId) ||
    (actorRequired && (attribution === 'unknown' || attribution === 'staff') && !actorLabel.trim()) ||
    participantActorInvalid || fouledParticipantInvalid ||
    (disciplineApplies && replacementInInvalid) ||
    (disciplineApplies && replacementOutInvalid)

  const save = () => {
    const eventType = kindEventType(draft.kind)
    if (mode === 'edit' && draft.event?.eventType !== eventType) {
      setError('The event family cannot change during correction.')
      return
    }
    const mainSelection = normalizeSoccerIncidentActorSelection(
      teamSide,
      attribution,
      participantId
    )
    const actor = actorRequired ? createActor(
        projection.participants,
        mainActorRole(draft.kind),
        mainSelection.attribution,
        mainSelection.participantId,
        actorLabel,
        teamSide === 'tracked' ? state.gameInfo?.teamName : state.gameInfo?.opponentName
      ) : null
    if (actorRequired && !actor) {
      setError('Choose a valid event actor.')
      return
    }
    const actors: GameEventActor[] = actor ? [actor] : []
    if (draft.kind === 'foul' && fouledAttribution !== 'none') {
      const fouledSelection = normalizeSoccerIncidentActorSelection(
        oppositeTeamSide(teamSide),
        fouledAttribution,
        fouledParticipantId
      )
      const fouled = createActor(
        projection.participants,
        'fouled',
        fouledSelection.attribution,
        fouledSelection.participantId,
        fouledLabel,
        teamSide === 'tracked' ? state.gameInfo?.opponentName : state.gameInfo?.teamName
      )
      if (!fouled) {
        setError('Choose a valid fouled actor.')
        return
      }
      actors.push(fouled)
    }
    const replacementParticipant = participants.find(item => item.participantId === replacementInId) ?? null
    const replacementRole = replacementParticipant && moment
      ? soccerParticipantRoleAt(
          replacementParticipant,
          moment.period.id,
          moment.elapsedMs,
          initialRoles.get(replacementParticipant.participantId)
        )
      : replacementParticipant?.role ?? null
    const lineupResolution = buildLineupResolution(
      disciplineApplies,
      participantId,
      sanction,
      effectiveDisciplineChoice,
      replacementInId,
      replacementOutId,
      replacementRole
    )
    const payload = draft.kind === 'defense'
      ? { action, tackleOutcome: action === 'tackle' ? tackleOutcome : null }
      : draft.kind === 'foul'
        ? {
            restart,
            sanction,
            sanctionReason: sanction === 'none' ? null : sanction === 'second_yellow_red' ? 'second_caution' : reason,
            note: note.trim() || null,
            lineupResolution,
          }
        : draft.kind === 'card'
          ? {
              sanction: sanction as SoccerCardSanction,
              reason: sanction === 'second_yellow_red' ? 'second_caution' : reason,
              note: note.trim() || null,
              lineupResolution,
            }
          : { kind: teamEventKind }
    const eventLocation = location ? { ...location, attackingDirection: captureDirection } : null
    const changes = {
      payload: payload as unknown as JsonObject,
      teamSide,
      location: eventLocation,
      actors: draft.kind === 'team_event' && teamEventKind === 'corner' ? [] : actors,
      ...(mode !== 'live' && moment ? { period: moment.period, elapsedMs: moment.elapsedMs } : {}),
    }
    const result = mode === 'edit' && draft.event
      ? updateSoccerHistoryEvent(state, draft.event.id, changes)
      : recordCheckedSoccerEvent(state, {
          eventType,
          ...changes,
        } as Parameters<typeof recordCheckedSoccerEvent>[1], { recorderUserId })
    if (!result.ok) {
      setError(result.message)
      onApply(result)
      return
    }
    if (!onApply(result)) return
    if (mode === 'live' && teamSide === 'tracked' && attribution === 'participant') {
      onTrackedParticipantUsed(participantId)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="soccer-incident-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-lg sm:rounded-lg" onClick={event => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="min-w-0 flex-1">
            <h2 id="soccer-incident-title" className="font-bold text-slate-900">{dialogTitle(draft.kind, mode)}</h2>
            <p className="truncate text-xs text-slate-500">{location ? 'Located event' : 'Location unknown'}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button>
        </header>

        <div className="space-y-5 p-4">
          {mode !== 'live' && (
            <MomentEditor
              teamSide={teamSide}
              onTeamSide={changeTeamSide}
              timings={periodTimings}
              selectedPeriodId={selectedPeriodId}
              onSelectedPeriodId={setSelectedPeriodId}
              periodElapsedMs={periodElapsedMs}
              onPeriodElapsedMs={setPeriodElapsedMs}
              invalid={timingInvalid}
            />
          )}

          {draft.kind === 'defense' && (
            <FieldGroup label="Action">
              <div className="grid grid-cols-2 gap-2">
                {DEFENSIVE_ACTIONS.map(option => <ChoiceButton key={option.value} active={action === option.value} label={option.label} onClick={() => setAction(option.value)} />)}
              </div>
              {action === 'tackle' && <div className="mt-2 grid grid-cols-2 rounded-md bg-slate-200 p-1"><ChoiceButton active={tackleOutcome === 'won'} label="Won" onClick={() => setTackleOutcome('won')} compact /><ChoiceButton active={tackleOutcome === 'lost'} label="Lost" onClick={() => setTackleOutcome('lost')} compact /></div>}
            </FieldGroup>
          )}

          {draft.kind === 'team_event' && (
            <FieldGroup label="Team event">
              <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1"><ChoiceButton active={teamEventKind === 'corner'} label="Corner" onClick={() => setTeamEventKind('corner')} compact /><ChoiceButton active={teamEventKind === 'offside'} label="Offside" onClick={() => setTeamEventKind('offside')} compact /></div>
              {teamEventKind === 'offside' && <label className="mt-2 flex min-h-10 items-center justify-between text-sm font-medium text-slate-700">Record offside player<input type="checkbox" checked={offsideActorRecorded} onChange={event => setOffsideActorRecorded(event.target.checked)} className="h-5 w-5 accent-emerald-700" /></label>}
            </FieldGroup>
          )}

          {(draft.kind !== 'team_event' || (teamEventKind === 'offside' && offsideActorRecorded)) && (
            <ActorEditor
              label={actorEditorLabel(draft.kind)}
              side={teamSide}
              allowStaff={draft.kind === 'card'}
              attribution={attribution}
              onAttribution={setAttribution}
              participantId={participantId}
              onParticipantId={setParticipantId}
              participants={eligibleParticipants}
              actorLabel={actorLabel}
              onActorLabel={setActorLabel}
              recentLabels={recentLabels}
            />
          )}

          {draft.kind === 'foul' && (
            <>
              <FieldGroup label="Restart">
                <select value={restart} onChange={event => setRestart(event.target.value as SoccerFoulRestart)} className="input-field">{RESTARTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              </FieldGroup>
              <OptionalFouledEditor
                committingSide={teamSide}
                attribution={fouledAttribution}
                onAttribution={setFouledAttribution}
                participantId={fouledParticipantId}
                onParticipantId={setFouledParticipantId}
                participants={eligibleParticipants}
                label={fouledLabel}
                onLabel={setFouledLabel}
                recentLabels={recentLabels}
              />
            </>
          )}

          {(draft.kind === 'foul' || draft.kind === 'card') && (
            <DisciplineEditor
              allowNone={draft.kind === 'foul'}
              sanction={sanction}
              onSanction={next => {
                setSanction(next)
                if (next === 'second_yellow_red') setReason('second_caution')
              }}
              reason={reason}
              onReason={setReason}
              note={note}
              onNote={setNote}
            />
          )}

          {disciplineApplies && selectedRole && (
            <LineupResolutionEditor
              sanction={sanction as SoccerCardSanction}
              yellowPolicy={projection.currentRules.yellowCardExitPolicy}
              goalkeeper={selectedRole.group === 'goalkeeper'}
              choice={disciplineChoice}
              onChoice={setDisciplineChoice}
              replacementInId={replacementInId}
              onReplacementInId={setReplacementInId}
              replacementOutId={replacementOutId}
              onReplacementOutId={setReplacementOutId}
              bench={selectedRole.group === 'goalkeeper'
                ? goalkeeperBench
                : nonGoalkeeperBench}
              fieldPlayers={fieldPlayers.filter(item => item.participantId !== participantId)}
            />
          )}

          {draft.kind === 'team_event' && teamEventKind === 'corner' && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setLocation(cornerLocation(captureDirection, 'left'))} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">Left corner</button>
              <button type="button" onClick={() => setLocation(cornerLocation(captureDirection, 'right'))} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">Right corner</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setLocationEditorOpen(value => !value)} className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700"><MapPin size={16} /> Set location</button>
            <button type="button" onClick={() => setLocation(null)} className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700"><MapPinOff size={16} /> Clear location</button>
          </div>
          {locationEditorOpen && <SoccerField trackedDirection={trackedDirection} captureSide={teamSide} flipped={fieldFlipped} disabled={false} onFlip={() => setFieldFlipped(value => !value)} onLocation={next => { setLocation(next); setLocationEditorOpen(false) }} />}

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button type="button" onClick={save} disabled={saveDisabled} className="min-h-12 w-full rounded-md bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">{mode === 'edit' ? 'Save Correction' : `Log ${kindLabel(draft.kind)}`}</button>
        </div>
        <datalist id="soccer-incident-opponents">{recentLabels.map(label => <option key={label} value={label} />)}</datalist>
      </div>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return <section><h3 className="mb-2 text-xs font-bold uppercase text-slate-500">{label}</h3>{children}</section>
}

function ChoiceButton({ active, label, onClick, compact = false }: { active: boolean; label: string; onClick: () => void; compact?: boolean }) {
  return <button type="button" onClick={onClick} className={`${compact ? 'min-h-8' : 'min-h-10'} rounded-md px-2 text-xs font-bold ${active ? 'bg-emerald-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>{label}</button>
}

function MomentEditor({ teamSide, onTeamSide, timings, selectedPeriodId, onSelectedPeriodId, periodElapsedMs, onPeriodElapsedMs, invalid }: {
  teamSide: SoccerTeamSide
  onTeamSide: (side: SoccerTeamSide) => void
  timings: Array<{ period: GameEventPeriod; label: string; startElapsedMs: number; endElapsedMs: number }>
  selectedPeriodId: string
  onSelectedPeriodId: (id: string) => void
  periodElapsedMs: number
  onPeriodElapsedMs: (value: number) => void
  invalid: boolean
}) {
  return <div className="space-y-4"><FieldGroup label="Side"><div className="grid grid-cols-2 rounded-md bg-slate-200 p-1"><ChoiceButton active={teamSide === 'tracked'} label="Tracked" onClick={() => onTeamSide('tracked')} compact /><ChoiceButton active={teamSide === 'opponent'} label="Opponent" onClick={() => onTeamSide('opponent')} compact /></div></FieldGroup><FieldGroup label="Match time"><div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2"><select value={selectedPeriodId} onChange={event => { const next = timings.find(item => item.period.id === event.target.value); onSelectedPeriodId(event.target.value); onPeriodElapsedMs(next ? next.endElapsedMs - next.startElapsedMs : 0) }} className="input-field">{timings.map(item => <option key={item.period.id} value={item.period.id}>{item.label}</option>)}</select><label className="text-[11px] font-bold uppercase text-slate-500">Min<input type="number" min="0" value={Math.floor(periodElapsedMs / 60_000)} onChange={event => onPeriodElapsedMs(Math.max(0, Number(event.target.value) || 0) * 60_000 + Math.floor(periodElapsedMs / 1_000) % 60 * 1_000)} className="input-field mt-1" /></label><label className="text-[11px] font-bold uppercase text-slate-500">Sec<input type="number" min="0" max="59" value={Math.floor(periodElapsedMs / 1_000) % 60} onChange={event => onPeriodElapsedMs(Math.floor(periodElapsedMs / 60_000) * 60_000 + Math.min(59, Math.max(0, Number(event.target.value) || 0)) * 1_000)} className="input-field mt-1" /></label></div>{invalid && <p className="mt-2 text-xs font-medium text-amber-700">Choose a time inside the recorded period.</p>}</FieldGroup></div>
}

function ActorEditor({ label, side, allowStaff, attribution, onAttribution, participantId, onParticipantId, participants, actorLabel, onActorLabel, recentLabels }: {
  label: string
  side: SoccerTeamSide
  allowStaff: boolean
  attribution: Attribution
  onAttribution: (value: Attribution) => void
  participantId: string
  onParticipantId: (value: string) => void
  participants: SoccerProjectedParticipant[]
  actorLabel: string
  onActorLabel: (value: string) => void
  recentLabels: string[]
}) {
  const options: Array<{ value: Attribution; label: string }> = side === 'tracked'
    ? [{ value: 'participant', label: 'Player' }, { value: 'team', label: 'Team' }, { value: 'unknown', label: 'Unknown' }]
    : [{ value: 'unknown', label: 'Player / unknown' }, { value: 'team', label: 'Team' }]
  if (allowStaff) options.push({ value: 'staff', label: 'Staff' })
  return <FieldGroup label={label}><div className={`grid gap-1 rounded-md bg-slate-200 p-1 ${options.length === 2 ? 'grid-cols-2' : options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{options.map(option => <ChoiceButton key={option.value} active={attribution === option.value} label={option.label} onClick={() => onAttribution(option.value)} compact />)}</div>{attribution === 'participant' && <select value={participantId} onChange={event => onParticipantId(event.target.value)} className="input-field mt-2"><option value="">Select player</option>{participants.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}</select>}{(attribution === 'unknown' || attribution === 'staff') && <input value={actorLabel} onChange={event => onActorLabel(event.target.value)} list={side === 'opponent' && recentLabels.length ? 'soccer-incident-opponents' : undefined} placeholder={attribution === 'staff' ? 'Coach or staff name' : 'Player label'} className="input-field mt-2" />}</FieldGroup>
}

function OptionalFouledEditor({ committingSide, attribution, onAttribution, participantId, onParticipantId, participants, label, onLabel, recentLabels }: {
  committingSide: SoccerTeamSide
  attribution: 'none' | 'participant' | 'team' | 'unknown'
  onAttribution: (value: 'none' | 'participant' | 'team' | 'unknown') => void
  participantId: string
  onParticipantId: (value: string) => void
  participants: SoccerProjectedParticipant[]
  label: string
  onLabel: (value: string) => void
  recentLabels: string[]
}) {
  const receivingSide = committingSide === 'tracked' ? 'opponent' : 'tracked'
  return <FieldGroup label="Fouled actor (optional)"><select value={attribution} onChange={event => onAttribution(event.target.value as typeof attribution)} className="input-field"><option value="none">Not recorded</option>{receivingSide === 'tracked' && <option value="participant">Tracked player</option>}<option value="team">Team</option><option value="unknown">Unknown / label</option></select>{attribution === 'participant' && <select value={participantId} onChange={event => onParticipantId(event.target.value)} className="input-field mt-2"><option value="">Select player</option>{participants.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}</select>}{attribution === 'unknown' && <input value={label} onChange={event => onLabel(event.target.value)} list={receivingSide === 'opponent' && recentLabels.length ? 'soccer-incident-opponents' : undefined} className="input-field mt-2" />}</FieldGroup>
}

function DisciplineEditor({ allowNone, sanction, onSanction, reason, onReason, note, onNote }: {
  allowNone: boolean
  sanction: SoccerSanction
  onSanction: (value: SoccerSanction) => void
  reason: SoccerDisciplineReason
  onReason: (value: SoccerDisciplineReason) => void
  note: string
  onNote: (value: string) => void
}) {
  return <FieldGroup label="Discipline"><select value={sanction} onChange={event => onSanction(event.target.value as SoccerSanction)} className="input-field">{allowNone && <option value="none">No card</option>}<option value="yellow">Yellow</option><option value="straight_red">Straight red</option><option value="second_yellow_red">Second yellow + red</option></select>{sanction !== 'none' && <><select value={sanction === 'second_yellow_red' ? 'second_caution' : reason} disabled={sanction === 'second_yellow_red'} onChange={event => onReason(event.target.value as SoccerDisciplineReason)} className="input-field mt-2">{REASONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><textarea value={note} onChange={event => onNote(event.target.value)} placeholder="Optional note" rows={2} className="input-field mt-2 resize-none" /></>}</FieldGroup>
}

function LineupResolutionEditor({ sanction, yellowPolicy, goalkeeper, choice, onChoice, replacementInId, onReplacementInId, replacementOutId, onReplacementOutId, bench, fieldPlayers }: {
  sanction: SoccerCardSanction
  yellowPolicy: 'stay_on' | 'must_leave_may_replace'
  goalkeeper: boolean
  choice: SoccerDisciplineCaptureChoice
  onChoice: (value: SoccerDisciplineCaptureChoice) => void
  replacementInId: string
  onReplacementInId: (value: string) => void
  replacementOutId: string
  onReplacementOutId: (value: string) => void
  bench: SoccerProjectedParticipant[]
  fieldPlayers: SoccerProjectedParticipant[]
}) {
  if (sanction === 'yellow' && yellowPolicy === 'stay_on') return <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Player remains on the field under this match's yellow-card rule.</p>
  if (sanction === 'yellow' && goalkeeper) return <FieldGroup label="Goalkeeper yellow card"><p className="mb-2 text-xs text-slate-600">Choose the goalkeeper entering immediately while the cautioned goalkeeper leaves.</p><select value={replacementInId} onChange={event => onReplacementInId(event.target.value)} className="input-field"><option value="">Goalkeeper in</option>{bench.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}</select></FieldGroup>
  if (sanction !== 'yellow' && !goalkeeper) return <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">Player is ejected and the team plays short.</p>
  if (sanction !== 'yellow' && goalkeeper) return <FieldGroup label="Goalkeeper ejection"><p className="mb-2 text-xs text-slate-600">Choose the field player leaving and the goalkeeper entering. The team remains one player short.</p><select value={replacementOutId} onChange={event => onReplacementOutId(event.target.value)} className="input-field"><option value="">Field player out</option>{fieldPlayers.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}</select><select value={replacementInId} onChange={event => onReplacementInId(event.target.value)} className="input-field mt-2"><option value="">Goalkeeper in</option>{bench.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}</select></FieldGroup>
  return <FieldGroup label="Yellow-card lineup"><div className="grid grid-cols-2 rounded-md bg-slate-200 p-1"><ChoiceButton active={choice === 'short'} label="Play short" onClick={() => onChoice('short')} compact /><ChoiceButton active={choice === 'replace'} label="Replace now" onClick={() => onChoice('replace')} compact /></div>{choice === 'replace' && <select value={replacementInId} onChange={event => onReplacementInId(event.target.value)} className="input-field mt-2"><option value="">Player entering</option>{bench.map(participant => <option key={participant.participantId} value={participant.participantId}>{participantLabel(participant)}</option>)}</select>}</FieldGroup>
}

function createActor(participants: Record<string, SoccerProjectedParticipant>, role: string, attribution: Attribution | 'none', participantId: string, label: string, teamLabel: string | undefined): GameEventActor | null {
  if (attribution === 'none') return null
  if (attribution === 'participant') {
    const participant = participants[participantId]
    if (!participant) return null
    return participant.playerId
      ? { role, kind: 'player', participantId, playerId: participant.playerId, label: participant.displayName }
      : { role, kind: 'unknown', participantId, label: participant.displayName }
  }
  const resolvedLabel = attribution === 'team' ? teamLabel?.trim() || 'Team' : label.trim()
  if (!resolvedLabel) return null
  return { role, kind: attribution, label: resolvedLabel }
}

function buildLineupResolution(applies: boolean, participantId: string, sanction: SoccerSanction, choice: SoccerDisciplineCaptureChoice, replacementInId: string, replacementOutId: string, replacementInRole: SoccerRole | null): SoccerDisciplineLineupResolution | null {
  if (!applies || sanction === 'none') return null
  const exit = sanction === 'yellow' ? choice === 'stay' ? 'none' : 'temporary' : 'ejected'
  const replacementChanges = choice === 'replace'
    ? [{ playerOutParticipantId: null, playerInParticipantId: replacementInId, playerInRole: replacementInRole }]
    : choice === 'keeper_handoff'
      ? [{ playerOutParticipantId: replacementOutId, playerInParticipantId: replacementInId, playerInRole: { group: 'goalkeeper' as const, label: null } }]
      : []
  return {
    cardedParticipantId: participantId,
    exit,
    replacementChanges,
    countsAsSubstitutionWindow: replacementChanges.length > 0,
  }
}

function primaryActor(event: SoccerIncidentEvent): GameEventActor | null {
  const role = event.eventType === 'soccer.defensive_action' ? 'defender' : event.eventType === 'soccer.foul' ? 'committed_by' : event.eventType === 'soccer.card' ? 'recipient' : 'offside_player'
  return event.actors.find(actor => actor.role === role) ?? null
}

function actorAttribution(actor: GameEventActor | null, allowStaff: boolean): Attribution {
  if (!actor) return 'participant'
  if (actor.participantId) return 'participant'
  if (actor.kind === 'team') return 'team'
  if (allowStaff && actor.kind === 'staff') return 'staff'
  return 'unknown'
}

function eligibleLiveParticipant(participants: SoccerProjectedParticipant[], selectedParticipantId: string | null): SoccerProjectedParticipant | null {
  return participants.find(item => item.participantId === selectedParticipantId && item.status === 'on_field')
    ?? participants.find(item => item.status === 'on_field' && item.role.group !== 'goalkeeper')
    ?? participants.find(item => item.status === 'on_field')
    ?? null
}

function recentOpponentLabels(state: GameState): string[] {
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

function kindEventType(kind: SoccerIncidentKind): SoccerIncidentEvent['eventType'] {
  if (kind === 'defense') return 'soccer.defensive_action'
  if (kind === 'foul') return 'soccer.foul'
  if (kind === 'card') return 'soccer.card'
  return 'soccer.team_event'
}

function mainActorRole(kind: SoccerIncidentKind): string {
  if (kind === 'defense') return 'defender'
  if (kind === 'foul') return 'committed_by'
  if (kind === 'card') return 'recipient'
  return 'offside_player'
}

function actorEditorLabel(kind: SoccerIncidentKind): string {
  if (kind === 'defense') return 'Defender'
  if (kind === 'foul') return 'Committed by'
  if (kind === 'card') return 'Recipient'
  return 'Offside player (optional)'
}

function kindLabel(kind: SoccerIncidentKind): string {
  if (kind === 'defense') return 'Defense'
  if (kind === 'team_event') return 'Team Event'
  return kind[0].toUpperCase() + kind.slice(1)
}

function dialogTitle(kind: SoccerIncidentKind, mode: 'live' | 'historical' | 'edit'): string {
  const prefix = mode === 'edit' ? 'Correct' : mode === 'historical' ? 'Add' : 'Log'
  return `${prefix} ${kindLabel(kind)}`
}

function participantLabel(participant: Pick<SoccerProjectedParticipant, 'displayName' | 'number'>): string {
  return `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`
}

function cornerLocation(direction: 'left_to_right' | 'right_to_left', side: 'left' | 'right'): GameEventLocation {
  return {
    x: direction === 'left_to_right' ? 0.98 : 0.02,
    y: side === 'left' ? 0.02 : 0.98,
    attackingDirection: direction,
  }
}

function oppositeDirection(direction: 'left_to_right' | 'right_to_left'): 'left_to_right' | 'right_to_left' {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

function oppositeTeamSide(side: SoccerTeamSide): SoccerTeamSide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

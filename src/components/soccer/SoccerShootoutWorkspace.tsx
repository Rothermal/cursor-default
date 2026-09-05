import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BadgeAlert, Pencil, Repeat2, Settings2 } from 'lucide-react'
import type { GameEventActor, GameEventInspection } from '../../lib/gameEvents/types'
import {
  endSoccerMatch,
  recordSoccerShootoutKick,
  reviseSoccerShootoutKick,
  soccerNextAnonymousKickerSlot,
  soccerShootoutPendingRetake,
  soccerShootoutUsedKickerKeys,
  type SoccerCaptureActorSelection,
  type SoccerLiveResult,
  type SoccerShootoutKickEvent,
  type SoccerShootoutKickOutcome,
} from '../../lib/soccer'
import type { GameState } from '../../types'
import { gameSideDisplayName } from '../../lib/display'

interface SoccerShootoutWorkspaceProps {
  state: GameState
  inspection: GameEventInspection
  recorderUserId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onCard: () => void
  onGoalkeeper: () => void
  onEligibility: () => void
}

const OUTCOMES: Array<{ value: SoccerShootoutKickOutcome; label: string; tone: string }> = [
  { value: 'scored', label: 'Goal', tone: 'bg-emerald-700 text-white' },
  { value: 'saved', label: 'Saved', tone: 'border border-blue-300 bg-blue-50 text-blue-800' },
  { value: 'missed', label: 'Missed', tone: 'border border-slate-300 bg-white text-slate-700' },
  { value: 'woodwork', label: 'Woodwork', tone: 'border border-amber-300 bg-amber-50 text-amber-800' },
  { value: 'retake', label: 'Retake', tone: 'border border-violet-300 bg-violet-50 text-violet-800' },
  { value: 'forfeited', label: 'Forfeit', tone: 'border border-red-300 bg-red-50 text-red-800' },
]

export default function SoccerShootoutWorkspace({
  state,
  inspection,
  recorderUserId,
  busy,
  onApply,
  onCard,
  onGoalkeeper,
  onEligibility,
}: SoccerShootoutWorkspaceProps) {
  const projection = state.sportGameState?.sportId === 'soccer' ? state.sportGameState.projection : null
  const shootout = projection?.shootout ?? null
  const [trackedKickerId, setTrackedKickerId] = useState('')
  const [opponentMode, setOpponentMode] = useState<'known' | 'unknown' | 'team'>('unknown')
  const [opponentLabel, setOpponentLabel] = useState('')
  const [anonymousSlot, setAnonymousSlot] = useState(1)
  const [editingKick, setEditingKick] = useState<SoccerShootoutKickEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const trackedLabel = gameSideDisplayName(state.gameInfo, 'tracked')
  const opponentTeamLabel = gameSideDisplayName(state.gameInfo, 'opponent')

  const pendingRetake = shootout ? soccerShootoutPendingRetake(shootout) : null
  const usedTracked = useMemo(
    () => shootout ? soccerShootoutUsedKickerKeys(shootout, 'tracked') : new Set<string>(),
    [shootout]
  )
  const eligibleTracked = shootout && projection
    ? shootout.trackedEligibleParticipantIds.map(id => projection.participants[id]).filter(Boolean)
    : []
  const pendingEvent = pendingRetake
    ? inspection.activeEvents.find(event => event.id === pendingRetake.eventId) as SoccerShootoutKickEvent | undefined
    : undefined

  useEffect(() => {
    if (!shootout) return
    setAnonymousSlot(soccerNextAnonymousKickerSlot(shootout, shootout.nextSide))
    if (pendingEvent?.teamSide === 'tracked') {
      setTrackedKickerId(pendingEvent.actors.find(actor => actor.role === 'kicker')?.participantId ?? '__unknown__')
      return
    }
    const first = shootout.trackedEligibleParticipantIds.find(id => !usedTracked.has(`participant:${id}`))
      ?? shootout.trackedEligibleParticipantIds[0]
      ?? '__unknown__'
    setTrackedKickerId(first)
  }, [pendingEvent, shootout, usedTracked])

  if (!projection || !shootout) return null
  const nextSide = shootout.nextSide
  const rawKicks = inspection.activeEvents.filter(event => event.eventType === 'soccer.shootout_kick') as SoccerShootoutKickEvent[]
  const goalkeeperSelection = selectionFromGoalkeeperKey(
    shootout.currentGoalkeepers[nextSide === 'tracked' ? 'opponent' : 'tracked']
  )
  const defendingSide = nextSide === 'tracked' ? 'opponent' : 'tracked'
  const goalkeeperNeedsReplacement = isShootoutActorSentOff(
    inspection,
    defendingSide,
    shootout.currentGoalkeepers[defendingSide]
  )
  const pendingKicker = pendingEvent?.actors.find(actor => actor.role === 'kicker') ?? null
  const usedNextSide = soccerShootoutUsedKickerKeys(shootout, nextSide)

  const recordKick = (outcome: SoccerShootoutKickOutcome) => {
    let kicker: SoccerCaptureActorSelection
    let slot: number | null = null
    if (pendingKicker) {
      kicker = selectionFromActor(pendingKicker)
      slot = pendingEvent?.payload.anonymousKickerSlot ?? null
    } else if (nextSide === 'tracked') {
      kicker = trackedKickerId === '__team__'
        ? { kind: 'team', label: trackedLabel }
        : trackedKickerId === '__unknown__'
          ? { kind: 'unknown', label: 'Unknown' }
          : { kind: 'participant', participantId: trackedKickerId }
      if (trackedKickerId === '__team__' || trackedKickerId === '__unknown__') slot = anonymousSlot
    } else if (opponentMode === 'known') {
      kicker = { kind: 'unknown', label: opponentLabel.trim() || 'Unknown opponent' }
    } else {
      kicker = opponentMode === 'team'
        ? { kind: 'team', label: opponentTeamLabel }
        : { kind: 'unknown', label: 'Unknown' }
      slot = anonymousSlot
    }
    const result = recordSoccerShootoutKick(state, {
      outcome,
      kicker,
      goalkeeper: goalkeeperSelection,
      anonymousKickerSlot: slot,
    }, { recorderUserId })
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (onApply(result)) setError(null)
  }

  return (
    <div className="space-y-5">
      <section className="border-y border-slate-200 bg-white py-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 text-center">
          <Score name={trackedLabel} normal={projection.sideTotals.tracked.score} shootout={shootout.score.tracked} />
          <div className="pb-1 text-xs font-bold uppercase text-slate-400">Shootout</div>
          <Score name={opponentTeamLabel} normal={projection.sideTotals.opponent.score} shootout={shootout.score.opponent} />
        </div>
        <p className="mt-3 text-center text-xs font-semibold text-slate-500">
          {shootout.decided
            ? `${shootout.winner === 'tracked' ? trackedLabel : opponentTeamLabel} wins the shootout`
            : shootout.suddenDeathRound
              ? `Sudden death, round ${shootout.suddenDeathRound}`
              : `Initial series, ${shootout.initialKicksPerSide} kicks per side`}
        </p>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase text-slate-500">Kick sequence</h2>
          <span className="text-xs text-slate-400">{shootout.attempts.tracked}-{shootout.attempts.opponent} attempts</span>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-2">
            {rawKicks.map((event, index) => (
              <button key={event.id} type="button" onClick={() => setEditingKick(event)} className={`min-w-24 rounded-md border px-3 py-2 text-left ${event.payload.outcome === 'retake' ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                <p className="max-w-20 truncate text-[10px] font-bold uppercase text-slate-400" title={event.teamSide === 'tracked' ? trackedLabel : opponentTeamLabel}>{event.teamSide === 'tracked' ? trackedLabel : opponentTeamLabel} {index + 1}</p>
                <p className="mt-0.5 text-sm font-bold capitalize text-slate-800">{event.payload.outcome}</p>
                <p className="mt-0.5 max-w-20 truncate text-[11px] text-slate-500">{event.actors.find(actor => actor.role === 'kicker')?.label ?? 'Unknown'}</p>
              </button>
            ))}
            {rawKicks.length === 0 && <p className="py-4 text-sm text-slate-500">No kicks recorded.</p>}
          </div>
        </div>
      </section>

      {!shootout.decided && (
        <section className="space-y-4 border-y border-slate-200 bg-white py-4">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Next kick</p>
            <p className="mt-1 truncate text-xl font-bold text-slate-900" title={nextSide === 'tracked' ? trackedLabel : opponentTeamLabel}>{nextSide === 'tracked' ? trackedLabel : opponentTeamLabel}</p>
            <p className="text-xs text-slate-500">Defending goalkeeper: {goalkeeperLabel(shootout.currentGoalkeepers[nextSide === 'tracked' ? 'opponent' : 'tracked'], projection)}</p>
          </div>

          {goalkeeperNeedsReplacement && (
            <button type="button" onClick={onGoalkeeper} className="flex min-h-12 w-full items-center gap-3 rounded-md border border-red-300 bg-red-50 px-3 text-left text-sm font-bold text-red-800">
              <BadgeAlert size={18} className="shrink-0" />
              Change the sent-off goalkeeper before the next kick
            </button>
          )}

          {pendingKicker ? (
            <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-3">
              <p className="text-xs font-bold uppercase text-violet-700">Retake required</p>
              <p className="mt-1 text-sm font-semibold text-violet-900">{pendingKicker.label}</p>
            </div>
          ) : nextSide === 'tracked' ? (
            <label className="block text-xs font-bold uppercase text-slate-500">Kicker
              <select value={trackedKickerId} onChange={event => setTrackedKickerId(event.target.value)} className="input-field mt-1 normal-case">
                {eligibleTracked.map(participant => <option key={participant.participantId} value={participant.participantId} disabled={usedTracked.has(`participant:${participant.participantId}`)}>{participant.number ? `#${participant.number} ` : ''}{participant.displayName}</option>)}
                <option value="__team__">Team / anonymous slot</option>
                <option value="__unknown__">Unknown / anonymous slot</option>
              </select>
            </label>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 rounded-md bg-slate-200 p-1">
                <Choice active={opponentMode === 'known'} label="Known" onClick={() => setOpponentMode('known')} />
                <Choice active={opponentMode === 'unknown'} label="Unknown" onClick={() => setOpponentMode('unknown')} />
                <Choice active={opponentMode === 'team'} label="Team" onClick={() => setOpponentMode('team')} />
              </div>
              {opponentMode === 'known' && <input value={opponentLabel} onChange={event => setOpponentLabel(event.target.value)} placeholder="Opponent kicker" className="input-field" />}
            </div>
          )}

          {!pendingKicker && ((nextSide === 'opponent' && opponentMode !== 'known') || (nextSide === 'tracked' && (trackedKickerId === '__team__' || trackedKickerId === '__unknown__'))) && (
            <label className="block text-xs font-bold uppercase text-slate-500">Anonymous slot
              <select value={anonymousSlot} onChange={event => setAnonymousSlot(Number(event.target.value))} className="input-field mt-1 normal-case">
                {Array.from({ length: nextSide === 'tracked' ? shootout.trackedEligibleParticipantIds.length : shootout.opponentEligibleCount }, (_, index) => index + 1).map(slot => <option key={slot} value={slot} disabled={usedNextSide.has(`anonymous:${slot}`)}>Slot {slot}</option>)}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map(outcome => <button key={outcome.value} type="button" disabled={busy || goalkeeperNeedsReplacement} onClick={() => recordKick(outcome.value)} className={`min-h-12 rounded-md px-3 text-sm font-bold disabled:opacity-40 ${outcome.tone}`}>{outcome.label}</button>)}
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-2">
        <ToolButton icon={<BadgeAlert size={18} />} label="Card" onClick={onCard} disabled={busy || shootout.decided} />
        <ToolButton icon={<Repeat2 size={18} />} label="Goalkeeper" onClick={onGoalkeeper} disabled={busy || shootout.decided} />
        <ToolButton icon={<Settings2 size={18} />} label="Eligibility" onClick={onEligibility} disabled={busy || shootout.decided} />
      </div>

      {shootout.decided && <button type="button" disabled={busy} onClick={() => onApply(endSoccerMatch(state, 'completed', { recorderUserId }))} className="min-h-12 w-full rounded-md bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">Complete Match</button>}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {editingKick && <KickCorrectionDialog event={editingKick} state={state} busy={busy} onClose={() => setEditingKick(null)} onSave={result => { if (onApply(result)) setEditingKick(null) }} />}
    </div>
  )
}

function KickCorrectionDialog({ event, state, busy, onClose, onSave }: { event: SoccerShootoutKickEvent; state: GameState; busy: boolean; onClose: () => void; onSave: (result: SoccerLiveResult) => void }) {
  const [outcome, setOutcome] = useState(event.payload.outcome)
  const [error, setError] = useState<string | null>(null)
  const kicker = event.actors.find(actor => actor.role === 'kicker')
  const goalkeeper = event.actors.find(actor => actor.role === 'goalkeeper')
  const submit = () => {
    if (!kicker || !goalkeeper) return setError('Kick actors are unavailable.')
    const result = reviseSoccerShootoutKick(state, event.id, event.teamSide, {
      outcome,
      kicker: selectionFromActor(kicker),
      goalkeeper: selectionFromActor(goalkeeper),
      anonymousKickerSlot: event.payload.anonymousKickerSlot,
    })
    if (!result.ok) return setError(result.message)
    onSave(result)
  }
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}><div role="dialog" aria-modal="true" aria-label="Correct shootout kick" className="w-full rounded-t-lg bg-white p-4 sm:max-w-md sm:rounded-lg" onClick={click => click.stopPropagation()}><div className="mb-4 flex items-center gap-3"><Pencil size={18} /><h2 className="flex-1 font-bold text-slate-900">Correct Kick</h2><button type="button" onClick={onClose} className="text-sm font-bold text-slate-500">Close</button></div><p className="mb-3 text-sm text-slate-600">{kicker?.label ?? 'Unknown kicker'}</p><div className="grid grid-cols-2 gap-2">{OUTCOMES.map(option => <button key={option.value} type="button" onClick={() => setOutcome(option.value)} className={`min-h-11 rounded-md px-3 text-sm font-bold ${outcome === option.value ? 'bg-emerald-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>{option.label}</button>)}</div>{error && <p className="mt-3 text-sm text-red-700">{error}</p>}<button type="button" disabled={busy} onClick={submit} className="mt-4 min-h-12 w-full rounded-md bg-emerald-700 text-sm font-bold text-white disabled:opacity-40">Save Correction</button></div></div>
}

function Score({ name, normal, shootout }: { name: string; normal: number; shootout: number }) { return <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-500">{name}</p><p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{shootout}</p><p className="text-[11px] text-slate-400">Normal {normal}</p></div> }
function Choice({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`h-9 rounded text-xs font-bold ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{label}</button> }
function ToolButton({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled: boolean }) { return <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-1 text-[11px] font-bold text-slate-700 disabled:opacity-40">{icon}<span>{label}</span></button> }

function selectionFromActor(actor: GameEventActor): SoccerCaptureActorSelection {
  if (actor.participantId) return { kind: 'participant', participantId: actor.participantId }
  if (actor.kind === 'team') return { kind: 'team', label: actor.label ?? 'Team' }
  return { kind: 'unknown', label: actor.label ?? 'Unknown' }
}

function selectionFromGoalkeeperKey(key: string): SoccerCaptureActorSelection {
  if (key.startsWith('participant:')) return { kind: 'participant', participantId: key.slice('participant:'.length) }
  const separator = key.indexOf(':')
  return { kind: 'unknown', label: separator >= 0 ? key.slice(separator + 1) : 'Unknown' }
}

function goalkeeperLabel(key: string, projection: NonNullable<GameState['sportGameState']>['projection']): string {
  if (key.startsWith('participant:')) return projection.participants[key.slice('participant:'.length)]?.displayName ?? 'Unknown'
  const separator = key.indexOf(':')
  return separator >= 0 ? key.slice(separator + 1) : 'Unknown'
}

function isShootoutActorSentOff(
  inspection: GameEventInspection,
  side: 'tracked' | 'opponent',
  actorKey: string
): boolean {
  return inspection.activeEvents.some(event => {
    if (
      event.eventType !== 'soccer.card' ||
      event.period.id !== 'shootout' ||
      event.teamSide !== side ||
      (event.payload.sanction !== 'straight_red' && event.payload.sanction !== 'second_yellow_red')
    ) return false
    const recipient = event.actors.find(actor => actor.role === 'recipient')
    if (!recipient) return false
    const recipientKey = recipient.participantId
      ? `participant:${recipient.participantId}`
      : `${recipient.kind}:${(recipient.label ?? recipient.kind).trim().toLowerCase()}`
    return recipientKey === actorKey
  })
}

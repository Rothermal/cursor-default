import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import SoccerLineupManager from './SoccerLineupManager'
import type { GameState } from '../../types'
import {
  addSoccerMatchParticipant,
  adjustSoccerClock,
  createSoccerUuid,
  endSoccerMatch,
  soccerLifecycleAction,
  formatSoccerInputTime,
  parseSoccerInputTime,
  recordSoccerRulesChange,
  resolveSoccerParticipant,
  soccerClockDisplayValue,
  soccerTieResolutionFromAvailability,
  withSoccerTieResolution,
  type SoccerLiveOptions,
  type SoccerLiveResult,
  type SoccerMatchParticipant,
  type SoccerRole,
  type SoccerRoleGroup,
} from '../../lib/soccer'

export type SoccerLiveDialogKind =
  | 'substitution'
  | 'roles'
  | 'clock'
  | 'participant'
  | 'resolve'
  | 'rules'
  | 'end'

interface SoccerLiveActionDialogProps {
  kind: SoccerLiveDialogKind | null
  state: GameState
  recorderUserId: string | null
  initialParticipantId?: string | null
  busy: boolean
  lineupDisabled?: boolean
  onApply: (result: SoccerLiveResult) => boolean
  onClose: () => void
}


const ROLE_OPTIONS: Array<{ value: SoccerRoleGroup; label: string }> = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
  { value: 'custom', label: 'Custom' },
]

export default function SoccerLiveActionDialog({
  kind,
  state,
  recorderUserId,
  initialParticipantId = null,
  busy,
  lineupDisabled = false,
  onApply,
  onClose,
}: SoccerLiveActionDialogProps) {
  const [mutationError, setMutationError] = useState<string | null>(null)
  useEffect(() => setMutationError(null), [kind])
  if (!kind || state.sportGameState?.sportId !== 'soccer') return null
  if (kind === 'substitution' || kind === 'roles') return <SoccerLineupManager
    state={state} recorderUserId={recorderUserId} initialParticipantId={initialParticipantId}
    busy={busy || lineupDisabled} onApply={onApply} onClose={onClose} />
  const options: SoccerLiveOptions = { recorderUserId }
  const apply = (result: SoccerLiveResult) => {
    if (!result.ok) {
      setMutationError(result.message)
      return
    }
    onApply(result)
  }
  const titles: Record<SoccerLiveDialogKind, string> = {
    substitution: 'Substitution Window',
    roles: 'Change Roles',
    clock: 'Correct Match Clock',
    participant: 'Add Match Participant',
    resolve: 'Resolve Participant',
    rules: 'Match Rule Override',
    end: 'End Match',
  }

  return (
    <Dialog title={titles[kind]} onClose={onClose}>
      <fieldset disabled={busy} className={busy ? 'contents opacity-60' : 'contents'}>
      {kind === 'clock' && (
        <ClockCorrectionForm state={state} options={options} onApply={apply} />
      )}
      {kind === 'participant' && (
        <ParticipantForm state={state} options={options} onApply={apply} />
      )}
      {kind === 'resolve' && (
        <ResolveParticipantForm
          state={state}
          options={options}
          initialParticipantId={initialParticipantId}
          onApply={apply}
        />
      )}
      {kind === 'rules' && (
        <RulesForm state={state} options={options} onApply={apply} />
      )}
      {kind === 'end' && (
        <EndMatchForm state={state} options={options} onApply={apply} />
      )}
      <FormError message={mutationError} />
      </fieldset>
    </Dialog>
  )
}


function ClockCorrectionForm({ state, options, onApply }: FormProps) {
  const projection = soccerProjection(state)
  const displayValue = soccerClockDisplayValue(state)
  const [value, setValue] = useState(formatSoccerInputTime(
    displayValue?.canonicalElapsedMs ?? projection.clock.elapsedMs
  ))
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const elapsedMs = parseSoccerInputTime(value)
    if (elapsedMs === null) {
      setError('Enter time as minutes and seconds, for example 45:30.')
      return
    }
    onApply(adjustSoccerClock(state, elapsedMs, options))
  }
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-slate-700">
        Corrected match time
        <input value={value} onChange={event => setValue(event.target.value)} inputMode="numeric" placeholder="MM:SS" className="input-field mt-1 text-center text-xl tabular-nums" />
      </label>
      {projection.currentRules.clockDisplay === 'per_period' && (
        <p className="text-xs text-slate-500">
          Enter cumulative match time. The tracker currently displays {displayValue?.primary ?? '00:00'} for this period.
        </p>
      )}
      <FormError message={error} />
      <SubmitButton label="Apply Correction" onClick={submit} />
    </div>
  )
}

function ParticipantForm({ state, options, onApply }: FormProps) {
  const projection = soccerProjection(state)
  const representedPlayerIds = new Set(Object.values(projection.participants).map(item => item.playerId).filter(Boolean))
  const availablePlayers = state.players.filter(player => !representedPlayerIds.has(player.id))
  const [source, setSource] = useState<'roster' | 'anonymous'>(availablePlayers.length ? 'roster' : 'anonymous')
  const [playerId, setPlayerId] = useState(availablePlayers[0]?.id ?? '')
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [destination, setDestination] = useState<'bench' | 'on_field'>('bench')
  const [role, setRole] = useState<SoccerRole>(defaultRole())
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const player = availablePlayers.find(item => item.id === playerId)
    const displayName = source === 'roster' ? player?.name.trim() ?? '' : name.trim()
    if (!displayName) {
      setError('Choose a roster player or enter a participant name.')
      return
    }
    if (role.group === 'custom' && !role.label?.trim()) {
      setError('Enter a label for the custom role.')
      return
    }
    const participant: SoccerMatchParticipant = {
      id: `soccer-${source}:${createSoccerUuid()}`,
      kind: source === 'roster' ? 'player' : 'anonymous',
      playerId: source === 'roster' ? player!.id : null,
      displayName,
      number: source === 'roster' ? player!.number || null : number.trim() || null,
      initialStatus: 'bench',
      initialRole: role,
    }
    onApply(addSoccerMatchParticipant(state, participant, destination, options))
  }

  return (
    <div className="space-y-4">
      {availablePlayers.length > 0 && (
        <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1">
          <ModeButton active={source === 'roster'} label="Roster player" onClick={() => setSource('roster')} />
          <ModeButton active={source === 'anonymous'} label="Game only" onClick={() => setSource('anonymous')} />
        </div>
      )}
      {source === 'roster' ? (
        <label className="block text-sm font-medium text-slate-700">
          Player
          <select value={playerId} onChange={event => setPlayerId(event.target.value)} className="input-field mt-1">
            {availablePlayers.map(player => <option key={player.id} value={player.id}>{player.number ? `#${player.number} ` : ''}{player.name}</option>)}
          </select>
        </label>
      ) : (
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <label className="block text-sm font-medium text-slate-700">Number<input value={number} onChange={event => setNumber(event.target.value)} className="input-field mt-1" /></label>
          <label className="block text-sm font-medium text-slate-700">Name<input value={name} onChange={event => setName(event.target.value)} className="input-field mt-1" /></label>
        </div>
      )}
      <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1">
        <ModeButton active={destination === 'bench'} label="Add to bench" onClick={() => setDestination('bench')} />
        <ModeButton active={destination === 'on_field'} label="Enter field" onClick={() => setDestination('on_field')} />
      </div>
      <RoleFields role={role} onChange={setRole} />
      <FormError message={error} />
      <SubmitButton label="Add Participant" onClick={submit} />
    </div>
  )
}

function RulesForm({ state, options, onApply }: FormProps) {
  const current = soccerProjection(state).currentRules
  const [maxPlayers, setMaxPlayers] = useState(current.maxOnFieldPlayers)
  const [subLimit, setSubLimit] = useState<number | null>(current.substitutionLimit)
  const [windowLimit, setWindowLimit] = useState<number | null>(current.substitutionWindowLimit)
  const [allowReturns, setAllowReturns] = useState(current.allowReturnSubstitutions)
  const [extraTime, setExtraTime] = useState(current.extraTimeAvailable)
  const [shootout, setShootout] = useState(current.shootoutAvailable)
  const rules = withSoccerTieResolution({
    ...current,
    maxOnFieldPlayers: maxPlayers,
    substitutionLimit: subLimit,
    substitutionWindowLimit: windowLimit,
    allowReturnSubstitutions: allowReturns,
    extraTimeAvailable: extraTime,
    shootoutAvailable: shootout,
  }, soccerTieResolutionFromAvailability(extraTime, shootout))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Players" value={maxPlayers} min={1} onChange={setMaxPlayers} />
        <NullableField label="Subs" value={subLimit} onChange={setSubLimit} />
        <NullableField label="Windows" value={windowLimit} onChange={setWindowLimit} />
      </div>
      <Toggle label="Allow return substitutions" checked={allowReturns} onChange={setAllowReturns} />
      <Toggle label="Extra time available" checked={extraTime} onChange={setExtraTime} />
      <Toggle label="Shootout available" checked={shootout} onChange={setShootout} />
      <SubmitButton label="Record Rule Change" onClick={() => onApply(recordSoccerRulesChange(state, rules, options))} />
    </div>
  )
}

function ResolveParticipantForm({ state, options, initialParticipantId, onApply }: FormProps & { initialParticipantId: string | null }) {
  const projection = soccerProjection(state)
  const anonymous = Object.values(projection.participants).filter(item => item.playerId === null)
  const represented = new Set(Object.values(projection.participants).map(item => item.playerId).filter(Boolean))
  const players = state.players.filter(player => !represented.has(player.id))
  const [participantId, setParticipantId] = useState(
    anonymous.find(item => item.participantId === initialParticipantId)?.participantId
      ?? anonymous[0]?.participantId
      ?? ''
  )
  const [playerId, setPlayerId] = useState(players[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const player = players.find(item => item.id === playerId)
    if (!participantId || !player) {
      setError('Choose an anonymous participant and an unused roster player.')
      return
    }
    onApply(resolveSoccerParticipant(
      state,
      participantId,
      player.id,
      player.name,
      player.number || null,
      options
    ))
  }

  return (
    <div className="space-y-4">
      <ParticipantSelect label="Game-only participant" value={participantId} participants={anonymous} onChange={setParticipantId} />
      <label className="block text-sm font-medium text-slate-700">
        Roster player
        <select value={playerId} onChange={event => setPlayerId(event.target.value)} className="input-field mt-1">
          {players.map(player => <option key={player.id} value={player.id}>{player.number ? `#${player.number} ` : ''}{player.name}</option>)}
        </select>
      </label>
      <FormError message={error} />
      <SubmitButton label="Resolve Participant" onClick={submit} />
    </div>
  )
}

function EndMatchForm({ state, options, onApply }: FormProps) {
  const projection = soccerProjection(state)
  const canComplete = soccerLifecycleAction(projection).kind === 'complete'
  const canSuspend = projection.status === 'in_progress' || projection.status === 'period_break'
  const [reason, setReason] = useState<'completed' | 'suspended' | 'abandoned'>(
    projection.status === 'suspended' ? 'abandoned' : canComplete ? 'completed' : canSuspend ? 'suspended' : 'abandoned'
  )
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-slate-700 mb-2">Result</legend>
        <div className="space-y-2">
          {([
            ['completed', 'Completed'],
            ['suspended', 'Suspended'],
            ['abandoned', 'Abandoned'],
          ] as const).map(([value, label]) => (
            <label key={value} className={`flex items-center gap-3 border border-slate-200 rounded-md px-3 py-3 text-sm font-medium text-slate-700 ${(value === 'completed' && !canComplete) || (value === 'suspended' && !canSuspend) ? 'opacity-45' : ''}`}>
              <input type="radio" name="end-reason" checked={reason === value} disabled={(value === 'completed' && !canComplete) || (value === 'suspended' && !canSuspend)} onChange={() => setReason(value)} className="h-4 w-4 accent-emerald-600" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton label="End Match" danger onClick={() => onApply(endSoccerMatch(state, reason, options))} />
    </div>
  )
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-lg sm:rounded-lg shadow-xl" onClick={event => event.stopPropagation()}>
        <header className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 z-10">
          <h2 className="font-bold text-slate-800 flex-1">{title}</h2>
          <button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

interface FormProps {
  state: GameState
  options: SoccerLiveOptions
  onApply: (result: SoccerLiveResult) => void
}

function soccerProjection(state: GameState) {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') throw new Error('Soccer projection unavailable')
  return sportState.projection
}

function ParticipantSelect({ label, value, participants, emptyLabel, onChange }: {
  label: string
  value: string
  participants: Array<{ participantId: string; displayName: string; number: string | null }>
  emptyLabel?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <select value={value} onChange={event => onChange(event.target.value)} className="input-field mt-1 py-2 px-2 text-sm">
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {participants.map(participant => (
          <option key={participant.participantId} value={participant.participantId}>
            {participant.number ? `#${participant.number} ` : ''}{participant.displayName}
          </option>
        ))}
      </select>
    </label>
  )
}

function RoleFields({ role, onChange }: { role: SoccerRole; onChange: (role: SoccerRole) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block text-xs font-medium text-slate-600">
        Role
        <select value={role.group} onChange={event => {
          const group = event.target.value as SoccerRoleGroup
          onChange({ group, label: group === 'custom' ? role.label ?? 'Custom' : null })
        }} className="input-field mt-1 py-2 px-2 text-sm">
          {ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {role.group === 'custom' ? (
        <label className="block text-xs font-medium text-slate-600">
          Label
          <input value={role.label ?? ''} onChange={event => onChange({ group: 'custom', label: event.target.value })} className="input-field mt-1 py-2 px-2 text-sm" />
        </label>
      ) : <span />}
    </div>
  )
}


function SubmitButton({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" onClick={onClick} className={`w-full rounded-md px-4 py-3 text-sm font-bold text-white ${danger ? 'bg-red-600' : 'bg-emerald-700'}`}>{label}</button>
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`h-9 rounded text-xs font-semibold ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{label}</button>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between text-sm font-medium text-slate-700 min-h-10">{label}<input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-5 w-5 accent-emerald-600" /></label>
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (value: number) => void }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<input type="number" min={min} value={value} onChange={event => onChange(Math.max(min, Number(event.target.value) || min))} className="input-field mt-1 px-2" /></label>
}

function NullableField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<input type="number" min={0} value={value ?? ''} placeholder="Any" onChange={event => onChange(event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0))} className="input-field mt-1 px-2" /></label>
}

function FormError({ message }: { message: string | null }) {
  return message ? <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{message}</p> : null
}

function defaultRole(): SoccerRole {
  return { group: 'midfielder', label: null }
}

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, Plus, Shield, UserPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { parseSoccerRosterRole } from '../lib/soccer/rosterRole'
import {
  createSoccerSportGameState,
  createSoccerUuid,
  prepareSoccerKickoff,
  validateSoccerMatchSetup,
  type SoccerMatchParticipant,
  type SoccerRoleGroup,
  type SoccerRosterStatus,
} from '../lib/soccer'

interface ParticipantDraft extends SoccerMatchParticipant {
  selected: boolean
}

type ParticipantDraftPatch = Partial<Pick<
  ParticipantDraft,
  'selected' | 'initialStatus' | 'initialRole' | 'displayName' | 'number'
>>

const ROLE_OPTIONS: Array<{ value: SoccerRoleGroup; label: string }> = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
  { value: 'custom', label: 'Custom' },
]

export default function SoccerPlayerSetup() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const soccerState = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState
    : null
  const setup = soccerState?.setup ?? null
  const [step, setStep] = useState<'roster' | 'lineup'>('roster')
  const hadSavedSelection = useRef(Boolean(setup?.participants.length))
  const [drafts, setDrafts] = useState<ParticipantDraft[]>(() =>
    (setup?.participants ?? []).map(participant => ({ ...structuredClone(participant), selected: true }))
  )
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [rosterLoading, setRosterLoading] = useState(
    Boolean(setup?.sourceTeamId && state.players.length === 0)
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmShortHanded, setConfirmShortHanded] = useState(false)
  const cloudRosterLoaded = useRef(false)
  const rosterRolesByPlayerId = useRef<Record<string, SoccerMatchParticipant['initialRole']>>({})

  useEffect(() => {
    if (state.eventStream?.events.length) navigate('/game', { replace: true })
  }, [navigate, state.eventStream?.events.length])

  const invalidRoute = !state.sport || state.sport.id !== 'soccer' || !state.gameInfo || !setup
  useEffect(() => {
    if (invalidRoute) navigate(state.sport?.id === 'soccer' ? '/setup' : '/', { replace: true })
  }, [invalidRoute, navigate, state.sport?.id])

  useEffect(() => {
    if (!setup?.sourceTeamId || !supabase || cloudRosterLoaded.current) return
    let cancelled = false
    const loadRoster = async () => {
      setRosterLoading(true)
      setError(null)
      const { data, error: loadError } = await supabase!
        .from('team_players')
        .select('player_id,jersey_number,position,players!inner(id,first_name,last_name)')
        .eq('team_id', setup.sourceTeamId)
        .eq('is_active', true)
        .order('joined_at', { ascending: true })
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setRosterLoading(false)
        return
      }
      type RosterRow = {
        player_id: string
        jersey_number: string | null
        position: string | null
        players: { id: string; first_name: string; last_name: string | null }
      }
      const rows = (data ?? []) as unknown as RosterRow[]
      rosterRolesByPlayerId.current = Object.fromEntries(
        rows.map(row => [row.player_id, parseSoccerRosterRole(row.position)])
      )
      dispatch({
        type: 'SET_PLAYERS',
        players: rows.map(row => ({
          id: row.player_id,
          name: `${row.players.first_name} ${row.players.last_name ?? ''}`.trim(),
          number: row.jersey_number ?? '',
          stats: {},
        })),
      })
      cloudRosterLoaded.current = true
      setRosterLoading(false)
    }
    void loadRoster()
    return () => { cancelled = true }
  }, [dispatch, setup?.sourceTeamId, state.players.length])

  useEffect(() => {
    if (setup?.sourceTeamId && !cloudRosterLoaded.current) return
    setDrafts(current => {
      const next = [...current]
      let changed = false
      for (const player of state.players) {
        if (next.some(draft => draft.playerId === player.id)) continue
        next.push({
          id: `soccer-player:${player.id}`,
          kind: 'player',
          playerId: player.id,
          displayName: player.name,
          number: player.number || null,
          initialStatus: 'bench',
          initialRole: rosterRolesByPlayerId.current[player.id]
            ?? { group: 'midfielder', label: null },
          selected: !hadSavedSelection.current,
        })
        changed = true
      }
      return changed ? next : current
    })
  }, [setup?.sourceTeamId, state.players])

  useEffect(() => {
    if (!setup || state.eventStream?.events.length) return
    const participants = selectedParticipants(drafts)
    if (JSON.stringify(participants) === JSON.stringify(setup.participants)) return
    const nextSetup = { ...setup, participants }
    if (validateSoccerMatchSetup(nextSetup)) return
    dispatch({
      type: 'SET_SPORT_GAME_STATE',
      sportGameState: createSoccerSportGameState(nextSetup),
    })
  }, [dispatch, drafts, setup, state.eventStream?.events.length])

  if (invalidRoute || !state.gameInfo || !setup) return null

  const selected = drafts.filter(draft => draft.selected)
  const starters = selected.filter(draft => draft.initialStatus === 'starter')
  const startingGoalkeepers = starters.filter(draft => draft.initialRole.group === 'goalkeeper')
  const maxPlayers = setup.rulesSnapshot.maxOnFieldPlayers

  const addParticipant = () => {
    if (!name.trim()) return
    const gameOnly = Boolean(setup.sourceTeamId)
    const id = createSoccerUuid()
    if (!gameOnly) {
      dispatch({
        type: 'ADD_PLAYER',
        player: { id, name: name.trim(), number: number.trim(), stats: {} },
      })
    }
    setDrafts(current => [...current, {
      id: gameOnly ? `soccer-anonymous:${id}` : `soccer-player:${id}`,
      kind: gameOnly ? 'anonymous' : 'player',
      playerId: gameOnly ? null : id,
      displayName: name.trim(),
      number: number.trim() || null,
      initialStatus: 'bench',
      initialRole: { group: 'midfielder', label: null },
      selected: true,
    }])
    setName('')
    setNumber('')
  }

  const addUnknownGoalkeeper = () => {
    const existing = drafts.find(draft => draft.kind === 'anonymous' && draft.displayName === 'Goalkeeper unknown')
    if (existing) {
      updateDraft(existing.id, {
        selected: true,
        initialStatus: 'starter',
        initialRole: { group: 'goalkeeper', label: null },
      })
      return
    }
    setDrafts(current => [...current, {
      id: `soccer-anonymous:${createSoccerUuid()}`,
      kind: 'anonymous',
      playerId: null,
      displayName: 'Goalkeeper unknown',
      number: null,
      initialStatus: 'starter',
      initialRole: { group: 'goalkeeper', label: null },
      selected: true,
    }])
  }

  function updateDraft(id: string, patch: ParticipantDraftPatch) {
    setDrafts(current => current.map(draft => draft.id === id
      ? {
          ...draft,
          selected: patch.selected ?? draft.selected,
          initialStatus: patch.initialStatus ?? draft.initialStatus,
          initialRole: patch.initialRole ?? draft.initialRole,
          displayName: patch.displayName ?? draft.displayName,
          number: patch.number === undefined ? draft.number : patch.number,
        }
      : draft
    ))
  }

  const continueToLineup = () => {
    if (selected.length === 0) {
      setError('Select at least one match participant.')
      return
    }
    setError(null)
    setStep('lineup')
  }

  const validateLineup = (): string | null => {
    if (starters.length === 0) return 'Select at least one starter.'
    if (starters.length > maxPlayers) return `The lineup can have at most ${maxPlayers} starters.`
    if (startingGoalkeepers.length !== 1) return 'The opening lineup requires exactly one goalkeeper.'
    if (selected.some(draft => draft.initialRole.group === 'custom' && !draft.initialRole.label?.trim())) {
      return 'Enter a label for every custom role.'
    }
    return null
  }

  const requestKickoff = () => {
    const lineupError = validateLineup()
    if (lineupError) {
      setError(lineupError)
      return
    }
    setError(null)
    if (starters.length < maxPlayers) {
      setConfirmShortHanded(true)
      return
    }
    startMatch()
  }

  const startMatch = () => {
    setConfirmShortHanded(false)
    const kickoff = prepareSoccerKickoff(
      state,
      {
        ...setup,
        participants: selectedParticipants(selected),
      },
      { recorderUserId: user?.id ?? null }
    )
    if (!kickoff.ok) {
      setError(kickoff.message)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: kickoff.state })
    navigate('/game')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-700 text-white px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => step === 'lineup' ? setStep('roster') : navigate('/setup')}
            className="h-9 w-9 grid place-items-center rounded-md bg-white/15 hover:bg-white/20"
            aria-label={step === 'lineup' ? 'Back to match roster' : 'Back to match setup'}
            title="Back"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold">{step === 'roster' ? 'Match Roster' : 'Opening Lineup'}</h1>
            <p className="text-sm text-emerald-100 truncate">
              {state.gameInfo.teamName} vs {state.gameInfo.opponentName}
            </p>
          </div>
          <span className="ml-auto text-xs font-semibold bg-white/15 rounded px-2 py-1">
            {step === 'roster' ? '1 of 2' : '2 of 2'}
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === 'roster' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">Available players</p>
                <p className="text-xs text-slate-500">{selected.length} selected</p>
              </div>
              {setup.sourceTeamId && (
                <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  <Shield size={14} /> Cloud roster
                </span>
              )}
            </div>

            {rosterLoading ? (
              <div className="py-10 text-center text-sm text-slate-500 animate-pulse">Loading roster...</div>
            ) : drafts.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No players available.</div>
            ) : (
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {drafts.map(draft => (
                  <label key={draft.id} className="min-h-14 flex items-center gap-3 py-2 cursor-pointer">
                    <input type="checkbox" checked={draft.selected} onChange={event => updateDraft(draft.id, { selected: event.target.checked })} className="h-5 w-5 accent-emerald-600" />
                    <span className="w-9 text-center text-sm font-bold text-slate-500">{draft.number ?? '-'}</span>
                    <span className="min-w-0 flex-1 font-medium text-slate-800 truncate">{draft.displayName}</span>
                    {draft.kind === 'anonymous' && <span className="text-xs text-slate-400">Game only</span>}
                  </label>
                ))}
              </div>
            )}

            <section className="border-t border-slate-200 pt-4 space-y-3">
              <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <UserPlus size={17} /> {setup.sourceTeamId ? 'Game-only participant' : 'Local roster player'}
              </h2>
              <div className="grid grid-cols-[5rem_1fr_auto] gap-2">
                <input value={number} onChange={event => setNumber(event.target.value)} placeholder="#" className="input-field px-3" />
                <input value={name} onChange={event => setName(event.target.value)} placeholder="Name" className="input-field px-3" />
                <button type="button" onClick={addParticipant} disabled={!name.trim()} className="h-12 w-12 grid place-items-center rounded-md bg-emerald-600 text-white disabled:opacity-40" aria-label="Add participant" title="Add participant">
                  <Plus size={20} />
                </button>
              </div>
            </section>

            <button type="button" onClick={continueToLineup} disabled={selected.length === 0 || rosterLoading} className="btn-primary w-full">
              Continue to Lineup ({selected.length})
            </button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Selected" value={selected.length} />
              <Metric label="Starters" value={`${starters.length}/${maxPlayers}`} />
              <Metric label="Goalkeepers" value={startingGoalkeepers.length} alert={startingGoalkeepers.length !== 1} />
            </div>

            <div className="space-y-2">
              {selected.map(draft => (
                <div key={draft.id} className="rounded-md border border-slate-200 bg-white p-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 text-center text-sm font-bold text-slate-500">{draft.number ?? '-'}</span>
                    <span className="min-w-0 flex-1 font-semibold text-slate-800 truncate">{draft.displayName}</span>
                    {draft.initialRole.group === 'goalkeeper' && <Shield size={17} className="text-emerald-700" />}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1">
                      {(['starter', 'bench'] as SoccerRosterStatus[]).map(status => (
                        <button key={status} type="button" onClick={() => updateDraft(draft.id, { initialStatus: status })} className={`h-9 rounded text-xs font-semibold capitalize ${draft.initialStatus === status ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
                          {status}
                        </button>
                      ))}
                    </div>
                    <select value={draft.initialRole.group} onChange={event => updateDraft(draft.id, { initialRole: { group: event.target.value as SoccerRoleGroup, label: event.target.value === 'custom' ? 'Custom' : null } })} className="input-field py-2 px-3 text-sm">
                      {ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                  </div>
                  {draft.initialRole.group === 'custom' && (
                    <input value={draft.initialRole.label ?? ''} onChange={event => updateDraft(draft.id, { initialRole: { group: 'custom', label: event.target.value } })} placeholder="Role label" className="input-field py-2 px-3 text-sm" />
                  )}
                </div>
              ))}
            </div>

            {startingGoalkeepers.length === 0 && (
              <button type="button" onClick={addUnknownGoalkeeper} className="btn-secondary w-full flex items-center justify-center gap-2">
                <Shield size={17} /> Use Goalkeeper unknown
              </button>
            )}

            <button type="button" onClick={requestKickoff} className="btn-primary w-full flex items-center justify-center gap-2">
              <Check size={18} /> Start Match
            </button>
          </>
        )}
      </main>

      <ConfirmDialog
        open={confirmShortHanded}
        title="Start short-handed?"
        message={`The lineup has ${starters.length} of ${maxPlayers} allowed players.`}
        confirmLabel="Start Match"
        cancelLabel="Review Lineup"
        destructive={false}
        onConfirm={startMatch}
        onCancel={() => setConfirmShortHanded(false)}
      />
    </div>
  )
}

function Metric({ label, value, alert = false }: {
  label: string
  value: string | number
  alert?: boolean
}) {
  return (
    <div className={`rounded-md border px-2 py-2 ${alert ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className={`text-lg font-bold tabular-nums ${alert ? 'text-amber-800' : 'text-slate-800'}`}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  )
}

function selectedParticipants(drafts: ParticipantDraft[]): SoccerMatchParticipant[] {
  return drafts.filter(draft => draft.selected).map(draft => ({
    id: draft.id,
    kind: draft.kind,
    playerId: draft.playerId,
    displayName: draft.displayName,
    number: draft.number,
    initialStatus: draft.initialStatus,
    initialRole: draft.initialRole,
  }))
}

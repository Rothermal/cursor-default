import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, Cloud, Laptop } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import {
  createSoccerSportGameState,
  detectRegulationPreset,
  regulationSegmentsForPreset,
  reorderSoccerSegments,
  resizeSoccerSegments,
  resolveSoccerMatchRules,
  validateSoccerMatchRules,
  type SoccerMatchRules,
  type SoccerRegulationPreset,
} from '../lib/soccer'
import { sportDashboardPath } from '../lib/sportNavigation'
import {
  acceptedTeamRole,
  canTrackGames,
  type TeamRole,
} from '../lib/teamPermissions'

interface SoccerCloudTeam {
  id: string
  owner_id: string
  name: string
  season_id: string
  accessRole: TeamRole
  seasons: { id: string; name: string; sport: string }
}

type TeamSource = 'local' | 'cloud'

export default function SoccerGameSetup() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedTeamId = searchParams.get('teamId')
  const { state, dispatch, parkingError } = useGame()
  const { user, isConfigured } = useAuth()
  const soccerState = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState
    : null
  const existingSetup = soccerState?.setup ?? null
  const cloudAvailable = Boolean(isConfigured && user && supabase)

  const [teamName, setTeamName] = useState(state.gameInfo?.teamName ?? '')
  const [opponentName, setOpponentName] = useState(state.gameInfo?.opponentName ?? '')
  const [competitionName, setCompetitionName] = useState(state.gameInfo?.tournamentName ?? '')
  const [date, setDate] = useState(
    state.gameInfo?.date ?? new Date().toISOString().slice(0, 10)
  )
  const [teamSource, setTeamSource] = useState<TeamSource>(
    requestedTeamId || existingSetup?.sourceTeamId ? 'cloud' : 'local'
  )
  const [teams, setTeams] = useState<SoccerCloudTeam[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState(
    requestedTeamId ?? existingSetup?.sourceTeamId ?? ''
  )
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamsError, setTeamsError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [designation, setDesignation] = useState(
    existingSetup?.trackedTeamDesignation ?? 'home'
  )
  const [direction, setDirection] = useState(
    existingSetup?.firstPeriodAttackingDirection ?? 'left_to_right'
  )
  const [rules, setRules] = useState<SoccerMatchRules>(() =>
    structuredClone(existingSetup?.rulesSnapshot ?? resolveSoccerMatchRules())
  )

  useEffect(() => {
    if (state.eventStream?.events.length) navigate('/game', { replace: true })
  }, [navigate, state.eventStream?.events.length])

  useEffect(() => {
    if (!cloudAvailable || !user || !supabase) return
    let cancelled = false

    const loadTeams = async () => {
      setLoadingTeams(true)
      setTeamsError(null)
      const [{ data, error }, { data: memberships, error: membershipError }] = await Promise.all([
        supabase!
          .from('teams')
          .select('id,owner_id,name,season_id,seasons!inner(id,name,sport)')
          .eq('seasons.sport', 'soccer')
          .order('created_at', { ascending: false }),
        supabase!
          .from('team_members')
          .select('team_id,role,accepted_at')
          .eq('user_id', user.id)
          .not('accepted_at', 'is', null),
      ])
      if (cancelled) return
      if (error || membershipError) {
        setTeamsError(error?.message ?? membershipError?.message ?? 'Unable to load soccer teams.')
        setLoadingTeams(false)
        return
      }

      const roleByTeam = new Map<string, TeamRole>()
      for (const membership of (memberships ?? []) as Array<{
        team_id: string
        role: string
        accepted_at: string | null
      }>) {
        const role = acceptedTeamRole(membership.role, membership.accepted_at)
        if (role) roleByTeam.set(membership.team_id, role)
      }
      type TeamRow = Omit<SoccerCloudTeam, 'accessRole'>
      const available = ((data ?? []) as unknown as TeamRow[]).flatMap(team => {
        const accessRole = team.owner_id === user.id
          ? 'owner'
          : roleByTeam.get(team.id) ?? null
        return accessRole && canTrackGames(accessRole) ? [{ ...team, accessRole }] : []
      })
      setTeams(available)

      const preferred = available.find(
        team => team.id === (requestedTeamId ?? existingSetup?.sourceTeamId)
      )
        ?? available[0]
      if (preferred) {
        setSelectedTeamId(preferred.id)
        if (teamSource === 'cloud') setTeamName(preferred.name)
      } else if (requestedTeamId) {
        setTeamsError('That soccer team is unavailable for tracking.')
      }
      setLoadingTeams(false)
    }

    void loadTeams()
    return () => { cancelled = true }
  }, [cloudAvailable, existingSetup?.sourceTeamId, requestedTeamId, teamSource, user])

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams]
  )
  const regulationPreset = detectRegulationPreset(rules)

  if (!state.sport || state.sport.id !== 'soccer') {
    navigate('/')
    return null
  }

  const updateRules = (update: (current: SoccerMatchRules) => SoccerMatchRules) => {
    setRules(current => reorderSoccerSegments(update(current)))
  }

  const applyPreset = (preset: SoccerRegulationPreset) => {
    if (preset === 'custom') return
    updateRules(current => ({
      ...current,
      regulationSegments: regulationSegmentsForPreset(preset),
    }))
  }

  const handleContinue = () => {
    const resolvedTeam = teamSource === 'cloud' ? selectedTeam?.name.trim() ?? '' : teamName.trim()
    if (!resolvedTeam || !opponentName.trim()) {
      setFormError('Team and opponent are required.')
      return
    }
    if (teamSource === 'cloud' && !selectedTeam) {
      setFormError('Choose an available soccer team.')
      return
    }
    const normalizedRules = reorderSoccerSegments(rules)
    const rulesError = validateSoccerMatchRules(normalizedRules)
    if (rulesError) {
      setFormError(rulesError)
      return
    }

    const sourceTeamId = teamSource === 'cloud' ? selectedTeam!.id : null
    const sourceChanged = Boolean(existingSetup && existingSetup.sourceTeamId !== sourceTeamId)
    if (sourceChanged) dispatch({ type: 'SET_PLAYERS', players: [] })
    dispatch({
      type: 'SET_CLOUD_SYNC_STATE',
      cloudSync: {
        seasonId: null,
        teamId: null,
        gameId: null,
        gameStatus: null,
        playerIdMap: {},
        lastSyncedAt: null,
        lastSyncedGameFingerprint: null,
      },
    })
    dispatch({
      type: 'SET_GAME_INFO',
      gameInfo: {
        teamName: resolvedTeam,
        opponentName: opponentName.trim(),
        tournamentName: competitionName.trim(),
        tournamentId: null,
        date,
      },
    })
    dispatch({
      type: 'SET_SPORT_GAME_STATE',
      sportGameState: createSoccerSportGameState({
        version: 1,
        trackedTeamDesignation: designation,
        firstPeriodAttackingDirection: direction,
        sourceTeamId,
        sourceSeasonId: teamSource === 'cloud' ? selectedTeam!.season_id : null,
        rulesSnapshot: normalizedRules,
        participants: sourceChanged ? [] : structuredClone(existingSetup?.participants ?? []),
      }),
    })
    navigate('/players')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-700 text-white px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(sportDashboardPath('soccer'))}
            className="h-9 w-9 grid place-items-center rounded-md bg-white/15 hover:bg-white/20"
            aria-label="Back to soccer dashboard"
            title="Back"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold">Soccer Match Setup</h1>
            <p className="text-sm text-emerald-100">Match and competition rules</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-6">
        {(formError || teamsError || parkingError) && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError ?? teamsError ?? parkingError}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase text-slate-500">Team Source</h2>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Team source">
            <ModeButton
              active={teamSource === 'local'}
              onClick={() => setTeamSource('local')}
              icon={<Laptop size={17} />}
              label="Local"
            />
            <ModeButton
              active={teamSource === 'cloud'}
              onClick={() => setTeamSource('cloud')}
              icon={<Cloud size={17} />}
              label="Cloud roster"
              disabled={!cloudAvailable}
            />
          </div>
          {teamSource === 'cloud' ? (
            <label className="block text-sm font-medium text-slate-700">
              Soccer team
              <select
                value={selectedTeamId}
                onChange={event => {
                  const id = event.target.value
                  setSelectedTeamId(id)
                  const team = teams.find(item => item.id === id)
                  if (team) setTeamName(team.name)
                }}
                disabled={loadingTeams || teams.length === 0}
                className="input-field mt-1"
              >
                {teams.length === 0 && <option value="">No teams available</option>}
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.seasons.name})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <TextField label="Team" value={teamName} onChange={setTeamName} required />
          )}
        </section>

        <section className="border-t border-slate-200 pt-5 space-y-3">
          <h2 className="text-sm font-bold uppercase text-slate-500">Match</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField label="Opponent" value={opponentName} onChange={setOpponentName} required />
            <label className="block text-sm font-medium text-slate-700">
              Date
              <input type="date" value={date} onChange={event => setDate(event.target.value)} className="input-field mt-1" />
            </label>
          </div>
          <TextField label="Competition" value={competitionName} onChange={setCompetitionName} />
          <Segmented
            label="Tracked team"
            value={designation}
            options={[
              { value: 'home', label: 'Home' },
              { value: 'away', label: 'Away' },
              { value: 'neutral', label: 'Neutral' },
            ]}
            onChange={setDesignation}
          />
          <Segmented
            label="First-period attack"
            value={direction}
            options={[
              { value: 'left_to_right', label: 'Left to right' },
              { value: 'right_to_left', label: 'Right to left' },
            ]}
            onChange={setDirection}
          />
        </section>

        <section className="border-t border-slate-200 pt-5 space-y-4">
          <h2 className="text-sm font-bold uppercase text-slate-500">Regulation</h2>
          <label className="block text-sm font-medium text-slate-700">
            Format
            <select value={regulationPreset} onChange={event => applyPreset(event.target.value as SoccerRegulationPreset)} className="input-field mt-1">
              <option value="standard">2 x 45 minutes</option>
              <option value="youth">2 x 30 minutes</option>
              <option value="quarters">4 x 15 minutes</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <NumberField
            label="Periods"
            value={rules.regulationSegments.length}
            min={1}
            max={8}
            onChange={count => updateRules(current => ({
              ...current,
              regulationSegments: resizeSoccerSegments(current.regulationSegments, 'regulation', count, 45),
            }))}
          />
          <SegmentEditor
            segments={rules.regulationSegments}
            onChange={segments => updateRules(current => ({ ...current, regulationSegments: segments }))}
          />
        </section>

        <section className="border-t border-slate-200 pt-5 space-y-4">
          <h2 className="text-sm font-bold uppercase text-slate-500">Clock and Lineup</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Segmented
              label="Clock"
              value={rules.clockDirection}
              options={[{ value: 'count_up', label: 'Count up' }, { value: 'count_down', label: 'Count down' }]}
              onChange={value => updateRules(current => ({ ...current, clockDirection: value }))}
            />
            <Segmented
              label="Display"
              value={rules.clockDisplay}
              options={[{ value: 'continuous', label: 'Continuous' }, { value: 'per_period', label: 'Per period' }]}
              onChange={value => updateRules(current => ({ ...current, clockDisplay: value }))}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumberField label="Players" value={rules.maxOnFieldPlayers} min={1} max={18} onChange={value => updateRules(current => ({ ...current, maxOnFieldPlayers: value }))} />
            <NullableNumberField label="Substitutions" value={rules.substitutionLimit} onChange={value => updateRules(current => ({ ...current, substitutionLimit: value }))} />
            <NullableNumberField label="Windows" value={rules.substitutionWindowLimit} onChange={value => updateRules(current => ({ ...current, substitutionWindowLimit: value }))} />
            <NumberField label="Max assists" value={rules.maxAssistsPerGoal} min={0} max={2} onChange={value => updateRules(current => ({ ...current, maxAssistsPerGoal: value }))} />
          </div>
          <Toggle label="Allow return substitutions" checked={rules.allowReturnSubstitutions} onChange={checked => updateRules(current => ({ ...current, allowReturnSubstitutions: checked }))} />
        </section>

        <section className="border-t border-slate-200 pt-5 space-y-4">
          <h2 className="text-sm font-bold uppercase text-slate-500">Extra Time</h2>
          <Toggle label="Extra time available" checked={rules.extraTimeAvailable} onChange={checked => updateRules(current => ({ ...current, extraTimeAvailable: checked }))} />
          {rules.extraTimeAvailable && (
            <>
              <NumberField label="Extra-time periods" value={rules.extraTimeSegments.length} min={1} max={4} onChange={count => updateRules(current => ({
                ...current,
                extraTimeSegments: resizeSoccerSegments(current.extraTimeSegments, 'extra_time', count, 15, current.regulationSegments.length),
              }))} />
              <SegmentEditor segments={rules.extraTimeSegments} onChange={segments => updateRules(current => ({ ...current, extraTimeSegments: segments }))} />
            </>
          )}
          <Toggle label="Shootout available" checked={rules.shootoutAvailable} onChange={checked => updateRules(current => ({ ...current, shootoutAvailable: checked }))} />
        </section>

        <button type="button" onClick={handleContinue} className="btn-primary w-full">
          Continue to Match Roster
        </button>
      </main>
    </div>
  )
}

function ModeButton({ active, onClick, icon, label, disabled = false }: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-10 rounded-md border text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40 ${
        active ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'
      }`}
    >
      {icon}{label}
    </button>
  )
}

function TextField({ label, value, onChange, required = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}{required ? ' *' : ''}
      <input value={value} onChange={event => onChange(event.target.value)} className="input-field mt-1" />
    </label>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700 mb-1">{label}</legend>
      <div className="grid gap-1 rounded-md bg-slate-200 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(option => (
          <button key={option.value} type="button" onClick={() => onChange(option.value)} className={`min-h-9 rounded text-xs font-semibold px-2 ${value === option.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function NumberField({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input type="number" value={value} min={min} max={max} onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} className="input-field mt-1 px-3" />
    </label>
  )
}

function NullableNumberField({ label, value, onChange }: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input type="number" value={value ?? ''} min={0} placeholder="Unlimited" onChange={event => onChange(event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0))} className="input-field mt-1 px-3" />
    </label>
  )
}

function Toggle({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 min-h-10 text-sm font-medium text-slate-700">
      {label}
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-5 w-5 accent-emerald-600" />
    </label>
  )
}

function SegmentEditor({ segments, onChange }: {
  segments: SoccerMatchRules['regulationSegments']
  onChange: (segments: SoccerMatchRules['regulationSegments']) => void
}) {
  return (
    <div className="space-y-2">
      {segments.map((segment, index) => (
        <div key={segment.id} className="grid grid-cols-[1fr_7rem] gap-2">
          <label className="text-xs font-medium text-slate-500">
            Label
            <input value={segment.label} onChange={event => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} className="input-field mt-1 py-2 px-3 text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Minutes
            <input type="number" min={1} max={240} value={Math.round(segment.durationMs / 60_000)} onChange={event => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, durationMs: Math.max(1, Number(event.target.value) || 1) * 60_000 } : item))} className="input-field mt-1 py-2 px-3 text-sm" />
          </label>
        </div>
      ))}
    </div>
  )
}

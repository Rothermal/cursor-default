import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, Cloud, Laptop } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useSettings } from '../context/SettingsContext'
import { useSoccerTeamSettings } from '../hooks/useSoccerTeamSettings'
import { supabase } from '../lib/supabase'
import {
  createSoccerSportGameState,
  reorderSoccerSegments,
  validateSoccerMatchRules,
} from '../lib/soccer'
import type { SoccerRuleSource } from '../lib/soccer/settings'
import type { SoccerMatchRulesOverride } from '../lib/soccer/rules'
import { resolveSoccerSetupRuleState } from '../lib/soccer/setupSettings'
import { sportDashboardPath } from '../lib/sportNavigation'
import {
  acceptedTeamRole,
  canTrackGames,
  type TeamRole,
} from '../lib/teamPermissions'
import SoccerRulesOverrideEditor from '../components/soccer/SoccerRulesOverrideEditor'

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
  const { soccerSettings } = useSettings()
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
  const [preservedSnapshot, setPreservedSnapshot] = useState(
    existingSetup?.rulesSnapshot
      ? structuredClone(existingSetup.rulesSnapshot)
      : null
  )
  const [matchOverrides, setMatchOverrides] = useState<SoccerMatchRulesOverride>({})
  const teamSettings = useSoccerTeamSettings(
    teamSource === 'cloud' && selectedTeamId ? selectedTeamId : null,
    teamSource === 'cloud'
  )
  const selectedTeamSettings = teamSettings.scopeTeamId === selectedTeamId
    ? teamSettings.settings.rules
    : undefined

  useEffect(() => {
    if (state.eventStream?.events.length) navigate('/game', { replace: true })
  }, [navigate, state.eventStream?.events.length])

  const invalidRoute = !state.sport || state.sport.id !== 'soccer'
  useEffect(() => {
    if (invalidRoute) navigate('/', { replace: true })
  }, [invalidRoute, navigate])

  useEffect(() => {
    if (invalidRoute || !cloudAvailable || !user || !supabase) return
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
  }, [cloudAvailable, existingSetup?.sourceTeamId, invalidRoute, requestedTeamId, teamSource, user])

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams]
  )
  const setupRules = useMemo(
    () => resolveSoccerSetupRuleState({
      personalDefaults: soccerSettings.rules,
      teamDefaults: teamSource === 'cloud' ? selectedTeamSettings : undefined,
      matchOverrides,
      preservedSnapshot,
    }),
    [
      matchOverrides,
      preservedSnapshot,
      soccerSettings.rules,
      selectedTeamSettings,
      teamSource,
    ]
  )
  const inheritedHierarchy = setupRules.inherited
  const effectiveHierarchy = setupRules.effective
  const rules = setupRules.rules
  const displayedOverrides = setupRules.displayedOverrides

  if (invalidRoute) return null

  const updateMatchOverrides = (next: SoccerMatchRulesOverride) => {
    setPreservedSnapshot(null)
    setMatchOverrides(next)
  }

  const releasePreservedSnapshot = () => {
    if (!preservedSnapshot) return
    setPreservedSnapshot(null)
    setMatchOverrides({})
  }

  const handleContinue = () => {
    if (
      teamSource === 'cloud' &&
      (
        teamSettings.scopeTeamId !== selectedTeamId ||
        teamSettings.status === 'idle' ||
        teamSettings.status === 'loading'
      )
    ) {
      setFormError('Wait for the selected team defaults to load.')
      return
    }
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
              onClick={() => {
                releasePreservedSnapshot()
                setTeamSource('local')
              }}
              icon={<Laptop size={17} />}
              label="Local"
            />
            <ModeButton
              active={teamSource === 'cloud'}
              onClick={() => {
                releasePreservedSnapshot()
                setTeamSource('cloud')
              }}
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
                  if (id !== selectedTeamId) releasePreservedSnapshot()
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
          <div>
            <h2 className="text-sm font-bold uppercase text-slate-500">Competition Rules</h2>
            <p className="mt-1 text-xs text-slate-500">
              {formatSourceSummary(effectiveHierarchy.sources)}
            </p>
          </div>

          {preservedSnapshot && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              This setup's saved rule snapshot is retained. Editing a rule or choosing Inherit
              creates a new snapshot from current defaults.
            </div>
          )}

          {teamSource === 'cloud' &&
            (teamSettings.status === 'cached' ||
              teamSettings.status === 'backend_update_required' ||
              teamSettings.status === 'error') && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {teamSettings.status === 'cached'
                  ? 'Using the last synced team defaults while cloud refresh is unavailable.'
                  : teamSettings.error ?? 'Shared team defaults are unavailable.'}
              </div>
            )}

          {effectiveHierarchy.diagnostics.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {effectiveHierarchy.diagnostics.map(item => item.message).join(' ')}
            </div>
          )}

          <SoccerRulesOverrideEditor
            inherited={inheritedHierarchy.rules}
            inheritedSources={inheritedHierarchy.sources}
            override={displayedOverrides}
            overrideLabel="Match override"
            onChange={updateMatchOverrides}
          />
        </section>

        <button
          type="button"
          onClick={handleContinue}
          disabled={teamSource === 'cloud' && (
            teamSettings.scopeTeamId !== selectedTeamId ||
            teamSettings.status === 'idle' ||
            teamSettings.status === 'loading'
          )}
          className="btn-primary w-full disabled:opacity-50"
        >
          {teamSource === 'cloud' && (
            teamSettings.scopeTeamId !== selectedTeamId ||
            teamSettings.status === 'idle' ||
            teamSettings.status === 'loading'
          )
            ? 'Loading Team Defaults...'
            : 'Continue to Match Roster'}
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

function formatSourceSummary(
  sources: Record<string, SoccerRuleSource>
): string {
  const unique = new Set(Object.values(sources))
  const labels = [
    unique.has('personal') ? 'personal' : null,
    unique.has('team') ? 'team' : null,
    unique.has('match') ? 'match overrides' : null,
  ].filter((value): value is string => Boolean(value))
  return labels.length > 0
    ? `Effective rules include ${labels.join(', ')}.`
    : 'Using built-in soccer defaults.'
}

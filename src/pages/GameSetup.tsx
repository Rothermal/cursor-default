import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

interface CloudTeam {
  id: string
  name: string
  sport: string
  season: string | null
}

interface TournamentOption {
  id: string
  name: string
}

export default function GameSetup() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const sport = state.sport
  const isCloudFlow = Boolean(isConfigured && user && supabase)

  const [teamName, setTeamName] = useState(state.gameInfo?.teamName || '')
  const [opponentName, setOpponentName] = useState(state.gameInfo?.opponentName || '')
  const [tournamentName, setTournamentName] = useState(state.gameInfo?.tournamentName || '')
  const [date, setDate] = useState(
    state.gameInfo?.date || new Date().toISOString().split('T')[0]
  )
  const [teamMode, setTeamMode] = useState<'existing' | 'new'>(
    state.cloudSync.teamId ? 'existing' : 'new'
  )
  const [teams, setTeams] = useState<CloudTeam[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState(state.cloudSync.teamId || '')
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamsError, setTeamsError] = useState<string | null>(null)

  // Tournament state (cloud + existing-team flow only)
  const [tournaments, setTournaments] = useState<TournamentOption[]>([])
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(
    state.gameInfo?.tournamentId ?? ''
  )
  const [newTournamentName, setNewTournamentName] = useState('')
  const [loadingTournaments, setLoadingTournaments] = useState(false)
  const [creatingTournament, setCreatingTournament] = useState(false)

  useEffect(() => {
    if (!sport || !isCloudFlow || !userId) return

    let isCancelled = false
    const loadTeams = async () => {
      setLoadingTeams(true)
      setTeamsError(null)
      const { data, error } = await supabase!
        .from('teams')
        .select('id,name,sport,season')
        .eq('sport', sport.id)
        .order('created_at', { ascending: false })

      if (isCancelled) return
      if (error) {
        setTeamsError(error.message)
        setLoadingTeams(false)
        return
      }

      const loadedTeams = (data ?? []) as CloudTeam[]
      setTeams(loadedTeams)
      if (loadedTeams.length === 0) {
        setTeamMode('new')
        setSelectedTeamId('')
        setLoadingTeams(false)
        return
      }

      const matchedById = state.cloudSync.teamId
        ? loadedTeams.find(team => team.id === state.cloudSync.teamId)
        : null
      const matchedByName = state.gameInfo?.teamName
        ? loadedTeams.find(team => team.name === state.gameInfo?.teamName)
        : null
      const preferredTeam = matchedById || matchedByName || loadedTeams[0]

      setTeamMode('existing')
      setSelectedTeamId(preferredTeam.id)
      setTeamName(preferredTeam.name)
      setLoadingTeams(false)
    }

    void loadTeams()
    return () => {
      isCancelled = true
    }
  }, [isCloudFlow, sport, state.cloudSync.teamId, state.gameInfo?.teamName, userId])

  // Stable snapshot of the current tournament selection (avoids effect dep on full gameInfo object)
  const existingTournamentId = state.gameInfo?.tournamentId ?? null

  // Load tournaments for the currently selected cloud team
  useEffect(() => {
    if (!isCloudFlow || teamMode !== 'existing' || !selectedTeamId || !supabase) {
      setTournaments([])
      return
    }

    let cancelled = false
    const loadTournaments = async () => {
      setLoadingTournaments(true)
      const { data, error } = await supabase!
        .from('tournaments')
        .select('id,name')
        .eq('team_id', selectedTeamId)
        .order('name', { ascending: true })

      if (cancelled) return
      if (!error) {
        const loaded = (data ?? []) as TournamentOption[]
        setTournaments(loaded)
        // Restore prior selection if the tournament still exists for this team
        if (existingTournamentId && loaded.some(t => t.id === existingTournamentId)) {
          setSelectedTournamentId(existingTournamentId)
        }
      }
      setLoadingTournaments(false)
    }

    void loadTournaments()
    return () => { cancelled = true }
  }, [isCloudFlow, teamMode, selectedTeamId, existingTournamentId])

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )
  const resolvedTeamName = teamMode === 'existing'
    ? selectedTeam?.name ?? ''
    : teamName.trim()
  const canProceed = Boolean(resolvedTeamName && opponentName.trim())

  if (!sport) {
    navigate('/')
    return null
  }

  const handleNext = async () => {
    if (!canProceed) return

    // Resolve tournament: existing selection, create new, or free-text
    let resolvedTournamentId: string | null = null
    let resolvedTournamentName = tournamentName.trim()

    if (isCloudFlow && teamMode === 'existing' && selectedTeamId) {
      if (selectedTournamentId === '__new__') {
        // Create (or find) tournament in Supabase
        const trimmed = newTournamentName.trim()
        if (trimmed && supabase) {
          setCreatingTournament(true)
          const { data, error } = await supabase
            .from('tournaments')
            .upsert({ team_id: selectedTeamId, name: trimmed }, { onConflict: 'team_id,name' })
            .select('id')
            .single()
          setCreatingTournament(false)
          if (!error && data) {
            resolvedTournamentId = data.id as string
            resolvedTournamentName = trimmed
          }
        }
      } else if (selectedTournamentId) {
        const found = tournaments.find(t => t.id === selectedTournamentId)
        resolvedTournamentId = selectedTournamentId
        resolvedTournamentName = found?.name ?? ''
      }
      // selectedTournamentId === '' means no tournament — both stay null/empty
    }

    dispatch({
      type: 'SET_CLOUD_SYNC_STATE',
      cloudSync: {
        teamId: teamMode === 'existing' ? selectedTeamId || null : null,
        gameId: null,
        gameStatus: null,
        playerIdMap: {},
        lastSyncedAt: null,
        lastError: null,
      },
    })
    dispatch({
      type: 'SET_GAME_INFO',
      gameInfo: {
        teamName: resolvedTeamName,
        opponentName: opponentName.trim(),
        tournamentName: resolvedTournamentName,
        tournamentId: resolvedTournamentId,
        date,
      },
    })
    navigate('/players')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-4`}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">{sport.icon} {sport.name}</h1>
            <p className="text-sm opacity-80">Game Setup</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <div className="space-y-4">
          {isCloudFlow ? (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">Team Source</p>
                <button
                  type="button"
                  onClick={() => navigate('/teams')}
                  className="text-xs text-blue-600 font-medium underline"
                >
                  Manage Teams
                </button>
              </div>

              {teamsError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  {teamsError}
                </p>
              )}

              {teams.length > 0 && (
                <div className="flex rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setTeamMode('existing')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      teamMode === 'existing' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
                    }`}
                  >
                    Existing Team
                  </button>
                  <button
                    type="button"
                    onClick={() => setTeamMode('new')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      teamMode === 'new' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
                    }`}
                  >
                    New Team
                  </button>
                </div>
              )}

              {loadingTeams ? (
                <p className="text-sm text-slate-500 animate-pulse">Loading teams...</p>
              ) : teamMode === 'existing' && teams.length > 0 ? (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Select Team *
                  </label>
                  <select
                    value={selectedTeamId}
                    onChange={e => {
                      const nextTeamId = e.target.value
                      setSelectedTeamId(nextTeamId)
                      const team = teams.find(item => item.id === nextTeamId)
                      if (team) setTeamName(team.name)
                    }}
                    className="input-field"
                  >
                    {teams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name}{team.season ? ` (${team.season})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Your Team Name *
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                    placeholder="e.g., Eagles"
                    className="input-field"
                    autoFocus
                  />
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Your Team Name *
              </label>
              <input
                type="text"
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                placeholder="e.g., Eagles"
                className="input-field"
                autoFocus
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Opponent *
            </label>
            <input
              type="text"
              value={opponentName}
              onChange={e => setOpponentName(e.target.value)}
              placeholder="e.g., Tigers"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Tournament / League
            </label>
            {isCloudFlow && teamMode === 'existing' && selectedTeamId ? (
              <div className="space-y-2">
                {loadingTournaments ? (
                  <p className="text-xs text-slate-400 animate-pulse">Loading tournaments...</p>
                ) : (
                  <select
                    value={selectedTournamentId}
                    onChange={e => {
                      setSelectedTournamentId(e.target.value)
                      if (e.target.value !== '__new__') setNewTournamentName('')
                    }}
                    className="input-field"
                  >
                    <option value="">No tournament</option>
                    {tournaments.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                    <option value="__new__">+ Add new tournament…</option>
                  </select>
                )}
                {selectedTournamentId === '__new__' && (
                  <input
                    type="text"
                    value={newTournamentName}
                    onChange={e => setNewTournamentName(e.target.value)}
                    placeholder="Tournament name"
                    className="input-field"
                    autoFocus
                  />
                )}
              </div>
            ) : (
              <input
                type="text"
                value={tournamentName}
                onChange={e => setTournamentName(e.target.value)}
                placeholder="e.g., Spring League 2026"
                className="input-field"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="input-field"
            />
          </div>
        </div>

        <button
          onClick={() => { void handleNext() }}
          disabled={!canProceed || creatingTournament}
          className="btn-primary w-full mt-8"
        >
          {creatingTournament ? 'Creating tournament...' : 'Next: Add Players →'}
        </button>
      </div>
    </div>
  )
}

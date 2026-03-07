import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ConfirmDialog from '../components/ConfirmDialog'

interface CloudTeam {
  id: string
  name: string
  season_id: string
  seasons: {
    id: string
    name: string
    sport: string
  }
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
  const [seasonFilter, setSeasonFilter] = useState<string>('')
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
  const [confirmDeleteTournament, setConfirmDeleteTournament] = useState<TournamentOption | null>(null)
  const [deletingTournamentId, setDeletingTournamentId] = useState<string | null>(null)

  useEffect(() => {
    if (!sport || !isCloudFlow || !userId) return

    let isCancelled = false
    const loadTeams = async () => {
      setLoadingTeams(true)
      setTeamsError(null)
      const { data, error } = await supabase!
        .from('teams')
        .select('id,name,season_id,seasons!inner(id,name,sport)')
        .eq('seasons.sport', sport.id)
        .order('created_at', { ascending: false })

      if (isCancelled) return
      if (error) {
        setTeamsError(error.message)
        setLoadingTeams(false)
        return
      }

      const loadedTeams = (data ?? []) as unknown as CloudTeam[]
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

  const handleDeleteTournament = async (tournament: TournamentOption) => {
    if (!supabase) return
    setDeletingTournamentId(tournament.id)
    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournament.id)
    setDeletingTournamentId(null)
    if (error) return
    setTournaments(prev => prev.filter(t => t.id !== tournament.id))
    if (selectedTournamentId === tournament.id) {
      setSelectedTournamentId('')
    }
  }

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )
  const availableSeasons = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of teams) {
      if (t.seasons && !map.has(t.seasons.id)) {
        map.set(t.seasons.id, t.seasons.name)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [teams])
  const filteredTeams = useMemo(
    () => seasonFilter ? teams.filter(t => t.season_id === seasonFilter) : teams,
    [teams, seasonFilter]
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
        seasonId: teamMode === 'existing' && selectedTeam ? selectedTeam.season_id : null,
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
                <div className="space-y-2">
                  {availableSeasons.length > 1 && (
                    <>
                      <label className="block text-sm font-medium text-slate-600 mb-1">
                        Season
                      </label>
                      <select
                        value={seasonFilter}
                        onChange={e => {
                          const nextFilter = e.target.value
                          setSeasonFilter(nextFilter)
                          const filtered = nextFilter ? teams.filter(t => t.season_id === nextFilter) : teams
                          if (filtered.length > 0 && !filtered.some(t => t.id === selectedTeamId)) {
                            setSelectedTeamId(filtered[0].id)
                            setTeamName(filtered[0].name)
                          }
                        }}
                        className="input-field"
                      >
                        <option value="">All seasons</option>
                        {availableSeasons.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </>
                  )}
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
                    {filteredTeams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name}{team.seasons?.name ? ` (${team.seasons.name})` : ''}
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
                  <>
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
                    {selectedTournamentId && selectedTournamentId !== '__new__' && (
                      <button
                        type="button"
                        onClick={() => {
                          const t = tournaments.find(item => item.id === selectedTournamentId)
                          if (t) setConfirmDeleteTournament(t)
                        }}
                        disabled={deletingTournamentId === selectedTournamentId}
                        className="text-xs text-red-600 underline disabled:opacity-40"
                      >
                        {deletingTournamentId === selectedTournamentId ? 'Deleting...' : 'Delete this tournament'}
                      </button>
                    )}
                  </>
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

                <ConfirmDialog
                  open={confirmDeleteTournament !== null}
                  title="Delete Tournament"
                  message={
                    confirmDeleteTournament
                      ? `Delete "${confirmDeleteTournament.name}"? Games linked to this tournament will keep their data but lose the tournament association.`
                      : ''
                  }
                  confirmLabel="Yes, Delete"
                  onConfirm={() => {
                    if (confirmDeleteTournament) void handleDeleteTournament(confirmDeleteTournament)
                    setConfirmDeleteTournament(null)
                  }}
                  onCancel={() => setConfirmDeleteTournament(null)}
                />
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

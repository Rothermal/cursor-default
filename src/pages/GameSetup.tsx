import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ConfirmDialog from '../components/ConfirmDialog'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface CloudTeam {
  id: string
  name: string
  season_id: string
  seasons: {
    id: string
    name: string
    sport: string
    team_stats_config?: unknown
  }
}

interface TournamentOption {
  id: string
  name: string
  url: string | null
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
  const [newTournamentUrl, setNewTournamentUrl] = useState('')
  /** Draft URL when an existing tournament is selected (saved on Next if changed). */
  const [existingTournamentUrlDraft, setExistingTournamentUrlDraft] = useState('')
  const [loadingTournaments, setLoadingTournaments] = useState(false)
  const [creatingTournament, setCreatingTournament] = useState(false)
  const [confirmDeleteTournament, setConfirmDeleteTournament] = useState<TournamentOption | null>(null)
  const [deletingTournamentId, setDeletingTournamentId] = useState<string | null>(null)

  /** When creating a new cloud team from setup, optional season to attach (else sync uses year-from-date). */
  const [seasonsForNewTeam, setSeasonsForNewTeam] = useState<
    Array<{ id: string; name: string; team_stats_config?: unknown }>
  >([])
  const [loadingSeasonsForNewTeam, setLoadingSeasonsForNewTeam] = useState(false)
  const [selectedNewTeamSeasonId, setSelectedNewTeamSeasonId] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)

  useEffect(() => {
    if (!sport || !isCloudFlow || !userId) return

    let isCancelled = false
    const loadTeams = async () => {
      setLoadingTeams(true)
      setTeamsError(null)
      const { data, error } = await supabase!
        .from('teams')
        .select('id,name,season_id,seasons!inner(id,name,sport,team_stats_config)')
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

  useEffect(() => {
    if (!isCloudFlow || !userId || !sport || !supabase) return
    const client = supabase
    let cancelled = false
    const load = async () => {
      setLoadingSeasonsForNewTeam(true)
      const { data, error } = await client
        .from('seasons')
        .select('id,name,team_stats_config')
        .eq('owner_id', userId)
        .eq('sport', sport.id)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (!error) {
        setSeasonsForNewTeam(
          (data ?? []) as Array<{ id: string; name: string; team_stats_config?: unknown }>
        )
      }
      setLoadingSeasonsForNewTeam(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isCloudFlow, userId, sport])

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )
  const selectedNewTeamSeasonRow = useMemo(
    () => seasonsForNewTeam.find(s => s.id === selectedNewTeamSeasonId) ?? null,
    [seasonsForNewTeam, selectedNewTeamSeasonId]
  )

  // Push raw `seasons.team_stats_config` into game state for resolveTeamStatsConfig (e.g. GameTracker).
  useEffect(() => {
    if (!isCloudFlow) {
      dispatch({ type: 'SET_TEAM_STATS_CONFIG', config: null })
      return
    }
    let raw: unknown = null
    if (teamMode === 'existing' && selectedTeam?.seasons) {
      raw = selectedTeam.seasons.team_stats_config
    } else if (teamMode === 'new' && selectedNewTeamSeasonId) {
      raw = selectedNewTeamSeasonRow?.team_stats_config
    }
    const next =
      raw != null && isRecord(raw) && Object.keys(raw).length > 0 ? raw : null
    dispatch({ type: 'SET_TEAM_STATS_CONFIG', config: next })
  }, [
    dispatch,
    isCloudFlow,
    teamMode,
    selectedTeam,
    selectedNewTeamSeasonId,
    selectedNewTeamSeasonRow,
  ])

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
        .select('id,name,url')
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

  // Keep URL draft in sync when user picks a different existing tournament
  useEffect(() => {
    if (selectedTournamentId === '' || selectedTournamentId === '__new__') {
      setExistingTournamentUrlDraft('')
      return
    }
    const t = tournaments.find(x => x.id === selectedTournamentId)
    setExistingTournamentUrlDraft(t?.url?.trim() ? t.url : '')
  }, [selectedTournamentId, tournaments])

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
    setSetupError(null)

    // Resolve tournament: existing selection, create new, or free-text
    let resolvedTournamentId: string | null = null
    let resolvedTournamentName = tournamentName.trim()

    if (isCloudFlow && teamMode === 'existing' && selectedTeamId) {
      if (selectedTournamentId === '__new__') {
        // Create (or find) tournament in Supabase
        const trimmed = newTournamentName.trim()
        if (!trimmed) {
          setSetupError('Enter a tournament name or choose another option.')
          return
        }
        if (supabase) {
          setCreatingTournament(true)
          const urlTrimmed = newTournamentUrl.trim()
          const { data, error } = await supabase
            .from('tournaments')
            .upsert(
              {
                team_id: selectedTeamId,
                name: trimmed,
                url: urlTrimmed === '' ? null : urlTrimmed,
              },
              { onConflict: 'team_id,name' }
            )
            .select('id')
            .single()
          setCreatingTournament(false)
          if (error) {
            setSetupError(error.message)
            return
          }
          if (data) {
            resolvedTournamentId = data.id as string
            resolvedTournamentName = trimmed
          }
        }
      } else if (selectedTournamentId) {
        const found = tournaments.find(t => t.id === selectedTournamentId)
        resolvedTournamentId = selectedTournamentId
        resolvedTournamentName = found?.name ?? ''
        if (supabase) {
          const canonical = (found?.url ?? '').trim()
          const draft = existingTournamentUrlDraft.trim()
          if (draft !== canonical) {
            setCreatingTournament(true)
            const { error: urlErr } = await supabase
              .from('tournaments')
              .update({ url: draft === '' ? null : draft })
              .eq('id', selectedTournamentId)
            setCreatingTournament(false)
            if (urlErr) {
              setSetupError(urlErr.message)
              return
            }
            setTournaments(prev =>
              prev.map(row =>
                row.id === selectedTournamentId ? { ...row, url: draft === '' ? null : draft } : row
              )
            )
          }
        }
      }
      // selectedTournamentId === '' means no tournament — both stay null/empty
    }

    const resolvedSeasonIdForSync =
      teamMode === 'existing' && selectedTeam
        ? selectedTeam.season_id
        : teamMode === 'new' && selectedNewTeamSeasonId
          ? selectedNewTeamSeasonId
          : null

    dispatch({
      type: 'SET_CLOUD_SYNC_STATE',
      cloudSync: {
        seasonId: resolvedSeasonIdForSync,
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
              {setupError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  {setupError}
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
                <div className="space-y-2">
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
                  {loadingSeasonsForNewTeam ? (
                    <p className="text-xs text-slate-400 animate-pulse">Loading seasons...</p>
                  ) : seasonsForNewTeam.length > 0 ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">
                        Season for new team
                      </label>
                      <select
                        value={selectedNewTeamSeasonId}
                        onChange={e => setSelectedNewTeamSeasonId(e.target.value)}
                        className="input-field"
                      >
                        <option value="">Auto (use year from game date)</option>
                        {seasonsForNewTeam.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 mt-1">
                        Pick an existing season to match Teams you already created, or leave on Auto.
                      </p>
                    </div>
                  ) : null}
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
                        if (e.target.value !== '__new__') {
                          setNewTournamentName('')
                          setNewTournamentUrl('')
                        }
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
                      <>
                        <div>
                          <label
                            htmlFor="existing-tournament-url"
                            className="block text-xs font-medium text-slate-500 mb-1"
                          >
                            Tournament URL (optional)
                          </label>
                          <input
                            id="existing-tournament-url"
                            type="url"
                            inputMode="url"
                            value={existingTournamentUrlDraft}
                            onChange={e => setExistingTournamentUrlDraft(e.target.value)}
                            placeholder="https://…"
                            className="input-field"
                            autoComplete="off"
                          />
                          <p className="text-xs text-slate-400 mt-1">
                            Saved when you continue to add players.
                          </p>
                        </div>
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
                      </>
                    )}
                  </>
                )}
                {selectedTournamentId === '__new__' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newTournamentName}
                      onChange={e => setNewTournamentName(e.target.value)}
                      placeholder="Tournament name"
                      className="input-field"
                      autoFocus
                    />
                    <input
                      type="url"
                      inputMode="url"
                      value={newTournamentUrl}
                      onChange={e => setNewTournamentUrl(e.target.value)}
                      placeholder="Tournament URL (optional)"
                      className="input-field"
                      autoComplete="off"
                    />
                  </div>
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
          {creatingTournament
            ? 'Saving tournament...'
            : 'Next: Add Players →'}
        </button>
      </div>
    </div>
  )
}

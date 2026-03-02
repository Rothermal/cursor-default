import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

interface TeamRow {
  id: string
  name: string
  nickname: string | null
  sport: string
  season: string | null
}

interface PlayerRow {
  id: string
  first_name: string
  last_name: string | null
  jersey_number: string | null
  nickname: string | null
}

function teamDisplayName(team: TeamRow): string {
  const n = team.nickname?.trim()
  return n ? n : team.name
}

function playerDisplayName(player: PlayerRow): string {
  const n = player.nickname?.trim()
  if (n) return n
  return [player.first_name, player.last_name].filter(Boolean).join(' ').trim() || 'Player'
}

export default function Teams() {
  const navigate = useNavigate()
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const supabaseClient = supabase

  const [teams, setTeams] = useState<TeamRow[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [players, setPlayers] = useState<PlayerRow[]>([])

  const [loadingTeams, setLoadingTeams] = useState(false)
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [savingPlayer, setSavingPlayer] = useState(false)
  const [deletingPlayerId, setDeletingPlayerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamSport, setNewTeamSport] = useState('basketball')
  const [newTeamSeason, setNewTeamSeason] = useState(new Date().getFullYear().toString())

  const [newPlayerFirst, setNewPlayerFirst] = useState('')
  const [newPlayerLast, setNewPlayerLast] = useState('')
  const [newPlayerNumber, setNewPlayerNumber] = useState('')

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [editingTeamNickname, setEditingTeamNickname] = useState('')
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null)
  const [editingPlayerNickname, setEditingPlayerNickname] = useState('')
  const [savingNickname, setSavingNickname] = useState(false)

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )

  useEffect(() => {
    if (!isConfigured || !userId || !supabaseClient) return

    let cancelled = false
    const loadTeams = async () => {
      setLoadingTeams(true)
      setError(null)
      const { data, error: queryError } = await supabaseClient
        .from('teams')
        .select('id,name,nickname,sport,season')
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (queryError) {
        setError(queryError.message)
        setLoadingTeams(false)
        return
      }

      const loadedTeams = (data ?? []) as TeamRow[]
      setTeams(loadedTeams)
      setSelectedTeamId(prev => {
        if (prev && loadedTeams.some(team => team.id === prev)) return prev
        return loadedTeams[0]?.id ?? ''
      })
      setLoadingTeams(false)
    }

    void loadTeams()
    return () => {
      cancelled = true
    }
  }, [isConfigured, supabaseClient, userId])

  useEffect(() => {
    if (!selectedTeamId || !isConfigured || !userId || !supabaseClient) {
      setPlayers([])
      return
    }

    let cancelled = false
    const loadPlayers = async () => {
      setLoadingPlayers(true)
      setError(null)
      const { data, error: queryError } = await supabaseClient
        .from('players')
        .select('id,first_name,last_name,jersey_number,nickname')
        .eq('team_id', selectedTeamId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (cancelled) return
      if (queryError) {
        setError(queryError.message)
        setLoadingPlayers(false)
        return
      }

      setPlayers((data ?? []) as PlayerRow[])
      setLoadingPlayers(false)
    }

    void loadPlayers()
    return () => {
      cancelled = true
    }
  }, [isConfigured, selectedTeamId, supabaseClient, userId])

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase credentials to manage cloud teams and rosters.
          </p>
          <button onClick={() => navigate('/admin')} className="btn-primary w-full">
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  const handleCreateTeam = async () => {
    if (!userId || !supabaseClient || !newTeamName.trim()) return
    setError(null)
    setCreatingTeam(true)

    const { data, error: createError } = await supabaseClient
      .from('teams')
      .insert({
        owner_id: userId,
        name: newTeamName.trim(),
        sport: newTeamSport,
        season: newTeamSeason.trim() || null,
      })
      .select('id,name,nickname,sport,season')
      .single()

    setCreatingTeam(false)
    if (createError || !data) {
      setError(createError?.message ?? 'Could not create team')
      return
    }

    const createdTeam = { ...data, nickname: (data as TeamRow).nickname ?? null } as TeamRow
    setTeams(prev => [createdTeam, ...prev])
    setSelectedTeamId(createdTeam.id)
    setNewTeamName('')
    setNewPlayerFirst('')
    setNewPlayerLast('')
    setNewPlayerNumber('')
  }

  const handleAddPlayer = async () => {
    if (!supabaseClient || !selectedTeamId || !newPlayerFirst.trim()) return
    setError(null)
    setSavingPlayer(true)

    const { data, error: insertError } = await supabaseClient
      .from('players')
      .insert({
        team_id: selectedTeamId,
        first_name: newPlayerFirst.trim(),
        last_name: newPlayerLast.trim() || null,
        jersey_number: newPlayerNumber.trim() || null,
        is_active: true,
      })
      .select('id,first_name,last_name,jersey_number,nickname')
      .single()

    setSavingPlayer(false)
    if (insertError || !data) {
      setError(insertError?.message ?? 'Could not add player')
      return
    }

    setPlayers(prev => [...prev, { ...data, nickname: (data as PlayerRow).nickname ?? null } as PlayerRow])
    setNewPlayerFirst('')
    setNewPlayerLast('')
    setNewPlayerNumber('')
  }

  const handleDeactivatePlayer = async (playerId: string) => {
    if (!supabaseClient) return
    setError(null)
    setDeletingPlayerId(playerId)

    const { error: updateError } = await supabaseClient
      .from('players')
      .update({ is_active: false })
      .eq('id', playerId)

    setDeletingPlayerId(null)
    if (updateError) {
      setError(updateError.message)
      return
    }

    setPlayers(prev => prev.filter(player => player.id !== playerId))
  }

  const startEditTeamNickname = (team: TeamRow) => {
    setEditingTeamId(team.id)
    setEditingTeamNickname(team.nickname?.trim() ?? '')
  }

  const cancelEditTeamNickname = () => {
    setEditingTeamId(null)
    setEditingTeamNickname('')
  }

  const handleSaveTeamNickname = async () => {
    if (!supabaseClient || !editingTeamId) return
    setError(null)
    setSavingNickname(true)
    const value = editingTeamNickname.trim() || null
    const { error: updateError } = await supabaseClient
      .from('teams')
      .update({ nickname: value })
      .eq('id', editingTeamId)
    setSavingNickname(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setTeams(prev =>
      prev.map(t => (t.id === editingTeamId ? { ...t, nickname: value } : t))
    )
    cancelEditTeamNickname()
  }

  const startEditPlayerNickname = (player: PlayerRow) => {
    setEditingPlayerId(player.id)
    setEditingPlayerNickname(player.nickname?.trim() ?? '')
  }

  const cancelEditPlayerNickname = () => {
    setEditingPlayerId(null)
    setEditingPlayerNickname('')
  }

  const handleSavePlayerNickname = async () => {
    if (!supabaseClient || !editingPlayerId) return
    setError(null)
    setSavingNickname(true)
    const value = editingPlayerNickname.trim() || null
    const { error: updateError } = await supabaseClient
      .from('players')
      .update({ nickname: value })
      .eq('id', editingPlayerId)
    setSavingNickname(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setPlayers(prev =>
      prev.map(p => (p.id === editingPlayerId ? { ...p, nickname: value } : p))
    )
    cancelEditPlayerNickname()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/admin')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">Cloud Teams</h1>
            <p className="text-sm opacity-80">Create teams and manage rosters</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {error && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Create Team</h2>
          <input
            type="text"
            value={newTeamName}
            onChange={e => setNewTeamName(e.target.value)}
            placeholder="Team name"
            className="input-field"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newTeamSport}
              onChange={e => setNewTeamSport(e.target.value)}
              className="input-field"
            >
              {sports.map(sport => (
                <option key={sport.id} value={sport.id}>
                  {sport.icon} {sport.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newTeamSeason}
              onChange={e => setNewTeamSeason(e.target.value)}
              placeholder="Season"
              className="input-field"
            />
          </div>
          <button
            type="button"
            onClick={() => { void handleCreateTeam() }}
            disabled={!newTeamName.trim() || creatingTeam}
            className="btn-primary w-full"
          >
            {creatingTeam ? 'Creating...' : 'Create Team'}
          </button>
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Teams</h2>
            {loadingTeams && <span className="text-xs text-slate-400 animate-pulse">Loading...</span>}
          </div>

          {teams.length === 0 && !loadingTeams ? (
            <p className="text-sm text-slate-500">No teams yet. Create one above.</p>
          ) : (
            <div className="space-y-2">
              {teams.map(team => {
                const sport = sports.find(item => item.id === team.sport)
                const isEditing = editingTeamId === team.id
                return (
                  <div
                    key={team.id}
                    className={`rounded-xl border px-3 py-2 transition-colors ${
                      team.id === selectedTeamId
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={editingTeamNickname}
                          onChange={e => setEditingTeamNickname(e.target.value)}
                          placeholder={`Display name (optional, default: ${team.name})`}
                          className="input-field text-sm"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { void handleSaveTeamNickname() }}
                            disabled={savingNickname}
                            className="btn-primary flex-1 text-sm py-1"
                          >
                            {savingNickname ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditTeamNickname}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedTeamId(team.id)}
                          className="flex-1 text-left"
                        >
                          <p className="font-medium text-slate-700">
                            {sport?.icon ?? '🏟️'} {teamDisplayName(team)}
                            {team.nickname?.trim() && (
                              <span className="text-slate-400 font-normal text-xs ml-1">
                                ({team.name})
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">
                            {sport?.name ?? team.sport}{team.season ? ` • ${team.season}` : ''}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); startEditTeamNickname(team) }}
                          className="text-slate-400 hover:text-slate-600 p-1 shrink-0"
                          title="Edit display name"
                          aria-label="Edit display name"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Roster</h2>
            <div className="flex items-center gap-2">
              {selectedTeam && (
                <button
                  type="button"
                  onClick={() => navigate(`/leaderboard?teamId=${selectedTeam.id}`)}
                  className="text-xs text-blue-600 font-medium hover:underline"
                >
                  Season Stats
                </button>
              )}
              <span className="text-xs text-slate-400">
                {selectedTeam ? teamDisplayName(selectedTeam) : 'Select a team'}
              </span>
            </div>
          </div>

          {selectedTeam ? (
            <>
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="text"
                  value={newPlayerNumber}
                  onChange={e => setNewPlayerNumber(e.target.value)}
                  placeholder="#"
                  className="input-field col-span-2 text-center"
                />
                <input
                  type="text"
                  value={newPlayerFirst}
                  onChange={e => setNewPlayerFirst(e.target.value)}
                  placeholder="First name"
                  className="input-field col-span-5"
                />
                <input
                  type="text"
                  value={newPlayerLast}
                  onChange={e => setNewPlayerLast(e.target.value)}
                  placeholder="Last name"
                  className="input-field col-span-5"
                />
              </div>
              <button
                type="button"
                onClick={() => { void handleAddPlayer() }}
                disabled={!newPlayerFirst.trim() || savingPlayer}
                className="btn-primary w-full"
              >
                {savingPlayer ? 'Saving...' : 'Add Player'}
              </button>

              {loadingPlayers ? (
                <p className="text-sm text-slate-500 animate-pulse">Loading roster...</p>
              ) : players.length === 0 ? (
                <p className="text-sm text-slate-500">No active players yet.</p>
              ) : (
                <div className="space-y-2">
                  {players.map(player => {
                    const isEditing = editingPlayerId === player.id
                    return (
                      <div key={player.id} className="border border-slate-100 rounded-xl px-3 py-2">
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <input
                              type="text"
                              value={editingPlayerNickname}
                              onChange={e => setEditingPlayerNickname(e.target.value)}
                              placeholder={`Display name (optional)`}
                              className="input-field text-sm"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => { void handleSavePlayerNickname() }}
                                disabled={savingNickname}
                                className="btn-primary flex-1 text-sm py-1"
                              >
                                {savingNickname ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditPlayerNickname}
                                className="border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-500 shrink-0">
                                #{player.jersey_number || '—'}
                              </span>
                              <p className="font-medium text-slate-700 truncate">
                                {playerDisplayName(player)}
                                {player.nickname?.trim() && (
                                  <span className="text-slate-400 font-normal text-xs ml-1">
                                    ({[player.first_name, player.last_name].filter(Boolean).join(' ')})
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => startEditPlayerNickname(player)}
                                className="text-slate-400 hover:text-slate-600 p-1"
                                title="Edit display name"
                                aria-label="Edit display name"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                onClick={() => { void handleDeactivatePlayer(player.id) }}
                                disabled={deletingPlayerId === player.id}
                                className="text-xs text-red-600 underline disabled:opacity-40"
                              >
                                {deletingPlayerId === player.id ? 'Removing...' : 'Remove'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">Select a team to manage its roster.</p>
          )}
        </section>
      </div>
    </div>
  )
}

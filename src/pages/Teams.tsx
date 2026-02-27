import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

interface TeamRow {
  id: string
  name: string
  sport: string
  season: string | null
}

interface PlayerRow {
  id: string
  first_name: string
  last_name: string | null
  jersey_number: string | null
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
        .select('id,name,sport,season')
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
        .select('id,first_name,last_name,jersey_number')
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
      .select('id,name,sport,season')
      .single()

    setCreatingTeam(false)
    if (createError || !data) {
      setError(createError?.message ?? 'Could not create team')
      return
    }

    const createdTeam = data as TeamRow
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
      .select('id,first_name,last_name,jersey_number')
      .single()

    setSavingPlayer(false)
    if (insertError || !data) {
      setError(insertError?.message ?? 'Could not add player')
      return
    }

    setPlayers(prev => [...prev, data as PlayerRow])
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
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                      team.id === selectedTeamId
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-medium text-slate-700">
                      {sport?.icon ?? '🏟️'} {team.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {sport?.name ?? team.sport}{team.season ? ` • ${team.season}` : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Roster</h2>
            <span className="text-xs text-slate-400">
              {selectedTeam ? selectedTeam.name : 'Select a team'}
            </span>
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
                  {players.map(player => (
                    <div key={player.id} className="flex items-center justify-between border border-slate-100 rounded-xl px-3 py-2">
                      <div>
                        <p className="font-medium text-slate-700">
                          #{player.jersey_number || '—'} {player.first_name} {player.last_name || ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { void handleDeactivatePlayer(player.id) }}
                        disabled={deletingPlayerId === player.id}
                        className="text-xs text-red-600 underline disabled:opacity-40"
                      >
                        {deletingPlayerId === player.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  ))}
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

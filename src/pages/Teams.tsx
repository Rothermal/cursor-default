import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { teamDisplayName, playerDisplayName } from '../lib/display'

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

interface TeamMemberRow {
  id: string
  team_id?: string
  user_id: string
  role: string
  accepted_at: string | null
  display_name: string | null
  email: string | null
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

  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([])
  const [pendingInvitesList, setPendingInvitesList] = useState<Array<{ id: string; team_id: string }>>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'scorer' | 'admin'>('scorer')
  const [inviting, setInviting] = useState(false)
  const [lookupResult, setLookupResult] = useState<{ id: string; display_name: string } | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [acceptingTeamId, setAcceptingTeamId] = useState<string | null>(null)
  const [decliningTeamId, setDecliningTeamId] = useState<string | null>(null)

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

  const myRole = useMemo(
    () => teamMembers.find(m => m.user_id === userId)?.role ?? null,
    [teamMembers, userId]
  )
  const canManageMembers = myRole === 'owner' || myRole === 'admin'

  useEffect(() => {
    if (!supabaseClient || !userId) {
      setPendingInvitesList([])
      return
    }
    let cancelled = false
    const load = async () => {
      const { data } = await supabaseClient
        .from('team_members')
        .select('id, team_id')
        .eq('user_id', userId)
        .is('accepted_at', null)
      if (cancelled) return
      setPendingInvitesList((data ?? []) as Array<{ id: string; team_id: string }>)
    }
    void load()
    return () => { cancelled = true }
  }, [supabaseClient, userId])

  useEffect(() => {
    if (!selectedTeamId || !supabaseClient || !userId) {
      setTeamMembers([])
      return
    }

    let cancelled = false
    const loadMembers = async () => {
      setLoadingMembers(true)
      setError(null)
      setLookupResult(null)

      const { data, error: rpcError } = await supabaseClient.rpc('get_team_members_with_profiles', {
        p_team_id: selectedTeamId,
      })

      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        setLoadingMembers(false)
        return
      }

      const rows = (data ?? []) as Array<TeamMemberRow & { team_id?: string }>
      setTeamMembers(rows.map(r => ({ ...r, team_id: r.team_id ?? selectedTeamId })))
      setLoadingMembers(false)
    }

    void loadMembers()
    return () => { cancelled = true }
  }, [selectedTeamId, supabaseClient, userId])

  const handleLookupInvitee = async () => {
    if (!supabaseClient || !selectedTeamId || !inviteEmail.trim()) return
    setError(null)
    setLookupResult(null)
    const { data, error: rpcError } = await supabaseClient.rpc('lookup_user_by_email', {
      p_team_id: selectedTeamId,
      p_email: inviteEmail.trim(),
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const rows = (data ?? []) as { id: string; display_name: string }[]
    if (rows.length === 0) {
      setError('No user found with that email.')
      return
    }
    setLookupResult(rows[0])
  }

  const handleInvite = async () => {
    if (!supabaseClient || !selectedTeamId || !lookupResult) return
    setError(null)
    setInviting(true)
    const { error: rpcError } = await supabaseClient.rpc('invite_team_member', {
      p_team_id: selectedTeamId,
      p_user_id: lookupResult.id,
      p_role: inviteRole,
    })
    setInviting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setInviteEmail('')
    setLookupResult(null)
    setInviteRole('scorer')
    const { data } = await supabaseClient.rpc('get_team_members_with_profiles', {
      p_team_id: selectedTeamId,
    })
    const rows = (data ?? []) as Array<TeamMemberRow & { team_id?: string }>
    setTeamMembers(rows.map(r => ({ ...r, team_id: r.team_id ?? selectedTeamId })))
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!supabaseClient) return
    setError(null)
    setRemovingMemberId(memberId)
    const { error: delError } = await supabaseClient
      .from('team_members')
      .delete()
      .eq('id', memberId)
    setRemovingMemberId(null)
    if (delError) {
      setError(delError.message)
      return
    }
    setTeamMembers(prev => prev.filter(m => m.id !== memberId))
  }

  const handleAcceptInvite = async (teamId: string) => {
    if (!supabaseClient) return
    setError(null)
    setAcceptingTeamId(teamId)
    const pending = pendingInvitesList.find(p => p.team_id === teamId)
    if (!pending) {
      setAcceptingTeamId(null)
      return
    }
    const { error: updError } = await supabaseClient
      .from('team_members')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', pending.id)
    setAcceptingTeamId(null)
    if (updError) {
      setError(updError.message)
      return
    }
    setPendingInvitesList(prev => prev.filter(p => p.id !== pending.id))
    if (selectedTeamId === teamId) {
      const { data } = await supabaseClient.rpc('get_team_members_with_profiles', {
        p_team_id: teamId,
      })
      const rows = (data ?? []) as Array<TeamMemberRow & { team_id?: string }>
      setTeamMembers(rows.map(r => ({ ...r, team_id: r.team_id ?? teamId })))
    }
  }

  const handleDeclineInvite = async (teamId: string) => {
    if (!supabaseClient) return
    setError(null)
    setDecliningTeamId(teamId)
    const pending = pendingInvitesList.find(p => p.team_id === teamId)
    if (!pending) {
      setDecliningTeamId(null)
      return
    }
    const { error: delError } = await supabaseClient.from('team_members').delete().eq('id', pending.id)
    setDecliningTeamId(null)
    if (delError) {
      setError(delError.message)
      return
    }
    setPendingInvitesList(prev => prev.filter(p => p.id !== pending.id))
    if (selectedTeamId === teamId) {
      setTeams(prev => {
        const next = prev.filter(t => t.id !== teamId)
        setSelectedTeamId(next[0]?.id ?? '')
        return next
      })
    } else {
      setTeams(prev => prev.filter(t => t.id !== teamId))
    }
  }

  function memberDisplayName(m: TeamMemberRow): string {
    if (m.display_name?.trim()) return m.display_name.trim()
    if (m.email) return m.email
    return 'Unknown'
  }

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
        {pendingInvitesList.length > 0 && (
          <div className="card bg-blue-50 border-blue-200 space-y-2">
            <p className="font-semibold text-blue-800">Pending invites</p>
            {pendingInvitesList.map(inv => {
              const team = teams.find(t => t.id === inv.team_id)
              return (
                <div key={inv.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-blue-700">{team ? teamDisplayName(team) : 'Team'}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleAcceptInvite(inv.team_id)}
                      disabled={acceptingTeamId === inv.team_id}
                      className="btn-primary py-1 px-3 text-xs"
                    >
                      {acceptingTeamId === inv.team_id ? 'Accepting...' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeclineInvite(inv.team_id)}
                      disabled={decliningTeamId === inv.team_id}
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-600"
                    >
                      {decliningTeamId === inv.team_id ? 'Declining...' : 'Decline'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

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

        {selectedTeam && (
          <section className="card space-y-3">
            <h2 className="font-semibold text-slate-700">Team Members</h2>
            {loadingMembers ? (
              <p className="text-sm text-slate-500 animate-pulse">Loading...</p>
            ) : (
              <>
                <div className="space-y-2">
                  {teamMembers.map(m => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium text-slate-700">
                          {memberDisplayName(m)}
                          {m.user_id === userId && (
                            <span className="text-slate-400 font-normal text-xs ml-1">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {m.role}
                          {m.accepted_at ? ' · Accepted' : ' · Pending'}
                        </p>
                      </div>
                      {canManageMembers && m.user_id !== userId && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.id)}
                          disabled={removingMemberId === m.id}
                          className="text-xs text-red-600 underline disabled:opacity-40"
                        >
                          {removingMemberId === m.id ? 'Removing...' : 'Remove'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {canManageMembers && (
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <p className="text-sm font-medium text-slate-600">Invite by email</p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={e => { setInviteEmail(e.target.value); setLookupResult(null) }}
                        placeholder="Email address"
                        className="input-field flex-1 text-sm py-2"
                      />
                      <button
                        type="button"
                        onClick={() => void handleLookupInvitee()}
                        disabled={!inviteEmail.trim()}
                        className="btn-secondary py-2 px-3 text-sm"
                      >
                        Lookup
                      </button>
                    </div>
                    {lookupResult && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
                        <p className="text-sm text-slate-700">
                          Invite <strong>{lookupResult.display_name || inviteEmail}</strong> as
                        </p>
                        <div className="flex gap-2 items-center">
                          <select
                            value={inviteRole}
                            onChange={e => setInviteRole(e.target.value as 'scorer' | 'admin')}
                            className="input-field text-sm py-2 w-auto"
                          >
                            <option value="scorer">Scorer</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleInvite()}
                            disabled={inviting}
                            className="btn-primary py-2 px-4 text-sm"
                          >
                            {inviting ? 'Sending...' : 'Send Invite'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
